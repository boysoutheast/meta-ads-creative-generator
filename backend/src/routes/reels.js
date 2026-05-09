/**
 * Reels API Routes
 *
 * POST /api/reels/build-storyboard
 *   Body: { prompt, mode, duration }
 *   → GPT-4o generates storyboard, creates session
 *   → Returns: { sessionId, storyboard: [{ clipNumber, visualSummary, voScript }] }
 *
 * POST /api/reels/refresh-clips
 *   Body: { sessionId, fromIndex, hint? }
 *   → Regenerates clips fromIndex..N, keeps 0..fromIndex-1
 *   → Returns: { storyboard: [...] }
 *
 * POST /api/reels/generate-stream
 *   Body: { sessionId }
 *   → SSE: generates clips (resume-aware, retry 3x), merges, download-ready
 *   SSE events: clip_start | clip_progress | clip_done | merge_start | merge_progress
 *              | merge_done | ready | error
 *
 * GET  /api/reels/session/:sessionId
 *   → Returns full session state (for resume on page load)
 *
 * GET  /api/reels/download/:sessionId
 *   → Streams merged.mp4, triggers cleanup after complete
 *
 * GET  /api/reels/audit/:sessionId
 *   → Returns audit log array
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const config = require('../config');

// Max reference images per session — GeminiGen supports @image1..@image6; match their max
const MAX_REFERENCE_IMAGES = 6;
const MAX_REF_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB per image

/**
 * Save base64 reference images to disk under uploads/reels-refs/{sessionId}-{i}.{ext}
 * Returns array of { tag, label, url } or throws on validation error.
 */
function saveReferenceImages(sessionId, rawImages) {
  if (!Array.isArray(rawImages) || rawImages.length === 0) return [];
  const capped = rawImages.slice(0, MAX_REFERENCE_IMAGES);

  const refDir = path.join(path.resolve(config.upload.uploadDir), 'reels-refs');
  if (!fs.existsSync(refDir)) fs.mkdirSync(refDir, { recursive: true });

  return capped.map(({ label, dataUrl }, i) => {
    if (!dataUrl || typeof dataUrl !== 'string') {
      throw new Error(`Reference image ${i + 1}: missing dataUrl`);
    }
    const matches = dataUrl.match(/^data:image\/([\w+]+);base64,(.+)$/);
    if (!matches) throw new Error(`Reference image ${i + 1}: invalid dataUrl format (must be data:image/...;base64,...)`);

    const ext = matches[1].replace('jpeg', 'jpg').replace('+xml', '') || 'jpg';
    const buffer = Buffer.from(matches[2], 'base64');

    if (buffer.length > MAX_REF_IMAGE_SIZE_BYTES) {
      throw new Error(`Reference image ${i + 1} exceeds 5 MB limit (${Math.round(buffer.length / 1024)}KB)`);
    }
    if (buffer.length < 100) {
      throw new Error(`Reference image ${i + 1} is too small — likely corrupt`);
    }

    const filename = `${sessionId}-ref-${i}.${ext}`;
    fs.writeFileSync(path.join(refDir, filename), buffer);

    const tag = `@image${i + 1}`;
    const url = `${config.backendPublicUrl}/uploads/reels-refs/${filename}`;
    return { tag, label: label || `Reference ${i + 1}`, url };
  });
}

const {
  createSession, saveSession, getSession, auditLog, cleanupOldSessions,
} = require('../services/sessionStore');
const { buildStoryboard, refreshFromIndex, generateHookVariants } = require('../services/storyboardBuilder');
const { generateSceneImages } = require('../services/sceneImageService');
const {
  cleanupAll, sweepExpiredMerged,
} = require('../services/reelsMerger');
const { runGeneration } = require('../services/reelsGenerator');

// Run session cleanup + merged-file sweep on startup
cleanupOldSessions().catch(() => {});
sweepExpiredMerged();

// Periodic sweep every 6 hours (catches missed deletes across restarts)
setInterval(() => sweepExpiredMerged(), 6 * 60 * 60 * 1000);

const VALID_DURATIONS = [6, 10, 12, 15, 18, 20, 24, 30, 36, 40, 42, 45, 50, 54, 60, 70, 80, 90, 100, 110, 120];
const VALID_CLIP_DURATIONS = [6, 10, 15];
const VALID_ASPECT_RATIOS = ['portrait', 'landscape', 'square', 'vertical', 'horizontal'];
const VALID_RESOLUTIONS = ['480p', '720p'];
const VALID_VO_TYPES = ['narration', 'dialogue', 'asmr', 'demo', 'story'];
const VALID_VISUAL_STYLES = ['premium_3d', 'realistic', 'anime', 'cinematic', 'cartoon', 'ghibli', 'makoto_shinkai', 'chibi', 'pixel_art', 'chinese_cg'];
const VALID_PROJECT_TYPES = ['default', 'story', 'product_promo', 'digital_human'];
const VALID_OUTPUT_LANGUAGES = ['id', 'en', 'th', 'vi', 'zh', 'hi', 'es', 'pt', 'ar', 'ko', 'ja'];

// ── SSE helper ────────────────────────────────────────────────────────────────

function sse(res, data) {
  if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function setupSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

// ── POST /build-storyboard ────────────────────────────────────────────────────

router.post('/build-storyboard', async (req, res) => {
  const {
    prompt,
    mode = 'normal',
    duration = 30,
    aspectRatio = 'portrait',
    resolution = '720p',
    clipDuration = 10,
    voType = 'narration',
    visualStyle = 'premium_3d',
    projectType = 'default',
    outputLanguage = 'id',
    scriptText = null,
    referenceImages: rawRefImages = [],
  } = req.body;

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const clipDur = VALID_CLIP_DURATIONS.includes(Number(clipDuration)) ? Number(clipDuration) : 10;
  const dur = VALID_DURATIONS.includes(Number(duration)) ? Number(duration) : 30;
  const ar = VALID_ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : 'portrait';
  const res_ = VALID_RESOLUTIONS.includes(resolution) ? resolution : '720p';
  const vt = VALID_VO_TYPES.includes(voType) ? voType : 'narration';
  const vs = VALID_VISUAL_STYLES.includes(visualStyle) ? visualStyle : 'premium_3d';
  const pt = VALID_PROJECT_TYPES.includes(projectType) ? projectType : 'default';
  const lang = VALID_OUTPUT_LANGUAGES.includes(outputLanguage) ? outputLanguage : 'id';
  const st = (scriptText && typeof scriptText === 'string' && scriptText.trim()) ? scriptText.trim() : null;

  // Validate referenceImages count upfront
  if (!Array.isArray(rawRefImages)) {
    return res.status(400).json({ error: 'referenceImages must be an array' });
  }
  if (rawRefImages.length > MAX_REFERENCE_IMAGES) {
    return res.status(400).json({
      error: `Maximum ${MAX_REFERENCE_IMAGES} reference images allowed (you sent ${rawRefImages.length})`,
    });
  }

  const session = createSession({ prompt: prompt.trim(), mode, duration: dur, aspectRatio: ar, resolution: res_, clipDuration: clipDur, voType: vt, visualStyle: vs, projectType: pt, outputLanguage: lang, scriptText: st });
  auditLog(session, 'info', 'SESSION_CREATED', { prompt: prompt.trim(), mode, duration: dur, aspectRatio: ar, resolution: res_, clipDuration: clipDur, voType: vt, visualStyle: vs, projectType: pt, outputLanguage: lang, hasScript: !!st });

  // Save session immediately so crash recovery can find it
  await saveSession(session);

  try {
    // Save reference images to disk
    let savedRefs = [];
    if (rawRefImages.length > 0) {
      auditLog(session, 'info', 'REF_IMAGES_SAVE_START', { count: rawRefImages.length });
      savedRefs = saveReferenceImages(session.sessionId, rawRefImages);
      session.referenceImageUrls = savedRefs;
      auditLog(session, 'info', 'REF_IMAGES_SAVED', {
        count: savedRefs.length,
        tags: savedRefs.map(r => r.tag),
      });
    }

    // Build storyboard via GPT-4o
    auditLog(session, 'info', 'STORYBOARD_BUILD_START', { refImageCount: savedRefs.length });
    const storyboard = await buildStoryboard({
      prompt: prompt.trim(),
      mode,
      duration: dur,
      referenceImages: savedRefs,
      aspectRatio: ar,
      clipDuration: clipDur,
      voType: vt,
      visualStyle: vs,
      projectType: pt,
      outputLanguage: lang,
      scriptText: st,
    });

    session.storyboard = storyboard;
    session.status = 'reviewing';
    auditLog(session, 'info', 'STORYBOARD_BUILT', { clipCount: storyboard.length });

    await saveSession(session);

    const publicStoryboard = storyboard.map(c => ({
      clipNumber: c.clipNumber,
      visualSummary: c.visualSummary,
      voScript: c.voScript,
      grokPrompt: c.grokPrompt,
      sceneImageUrl: c.sceneImageUrl,
      technicalConfig: c.technicalConfig,
    }));

    return res.json({
      sessionId: session.sessionId,
      storyboard: publicStoryboard,
      referenceImageUrls: savedRefs.map(r => ({ tag: r.tag, label: r.label })),
    });
  } catch (err) {
    console.error('[reels/build-storyboard]', err.message);
    auditLog(session, 'error', 'BUILD_STORYBOARD_ERROR', { error: err.message });
    try { await saveSession(session); } catch {}
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /refresh-clips ───────────────────────────────────────────────────────

router.post('/refresh-clips', async (req, res) => {
  const { sessionId, fromIndex, hint } = req.body;

  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  if (typeof fromIndex !== 'number' || fromIndex < 0) {
    return res.status(400).json({ error: 'fromIndex must be a non-negative number' });
  }

  const session = await getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });

  try {
    auditLog(session, 'info', 'REFRESH_START', { fromIndex, hint: hint || null });

    const newStoryboard = await refreshFromIndex({
      prompt: session.prompt,
      mode: session.mode,
      existingClips: session.storyboard,
      fromIndex,
      totalClips: session.totalClips,
      hint: hint || null,
      referenceImages: session.referenceImageUrls || [],
      aspectRatio: session.aspectRatio || 'portrait',
      clipDuration: session.clipDuration || 10,
      voType: session.voType || 'narration',
      visualStyle: session.visualStyle || 'premium_3d',
      projectType: session.projectType || 'default',
      outputLanguage: session.outputLanguage || 'id',
    });

    session.storyboard = newStoryboard;
    session.status = 'reviewing';
    // Clear any generated clips from fromIndex onwards (they're now stale)
    session.clips = session.clips.filter(c => c.index < fromIndex);

    auditLog(session, 'info', 'REFRESH_DONE', { fromIndex, newClipCount: newStoryboard.length - fromIndex });
    await saveSession(session);

    const publicStoryboard = newStoryboard.map(c => ({
      clipNumber: c.clipNumber,
      visualSummary: c.visualSummary,
      voScript: c.voScript,
      grokPrompt: c.grokPrompt,
      sceneImageUrl: c.sceneImageUrl,
      technicalConfig: c.technicalConfig,
    }));

    return res.json({ storyboard: publicStoryboard });
  } catch (err) {
    console.error('[reels/refresh-clips]', err.message);
    auditLog(session, 'error', 'REFRESH_ERROR', { error: err.message });
    await saveSession(session);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /generate-hooks ─────────────────────────────────────────────────────
// Generate 5 A/B hook variants for clip 1 of an ad.

router.post('/generate-hooks', async (req, res) => {
  const { sessionId, brief } = req.body;

  if (!sessionId && !brief) {
    return res.status(400).json({ error: 'sessionId or brief required' });
  }

  let resolvedBrief = brief;
  let sessionParams = { projectType: 'default', voType: 'narration', outputLanguage: 'id', visualStyle: 'premium_3d', clipDuration: 10 };

  // If sessionId provided, pull context from session
  if (sessionId) {
    const session = await getSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    resolvedBrief = resolvedBrief || session.prompt;
    sessionParams = {
      projectType: session.projectType || 'default',
      voType: session.voType || 'narration',
      outputLanguage: session.outputLanguage || 'id',
      visualStyle: session.visualStyle || 'premium_3d',
      clipDuration: session.clipDuration || 10,
    };
  }

  if (!resolvedBrief || !resolvedBrief.trim()) {
    return res.status(400).json({ error: 'brief is required' });
  }

  try {
    const hooks = await generateHookVariants({ brief: resolvedBrief, ...sessionParams });
    return res.json({ hooks });
  } catch (err) {
    console.error('[reels/generate-hooks]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /generate-scene-images ──────────────────────────────────────────────
// Generates one Gemini Image 2.0 preview per storyboard clip.
// Non-blocking: individual clip failures are returned with error field, not 500.
// Stores sceneImageUrl on session.storyboard[i] for use during video generation.

router.post('/generate-scene-images', async (req, res) => {
  const { sessionId, fromIndex } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  const session = await getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
  if (!session.storyboard?.length) {
    return res.status(400).json({ error: 'No storyboard found — build storyboard first' });
  }

  try {
    // fromIndex: regenerate only from that index (used after refresh-clips)
    const startIdx = typeof fromIndex === 'number' ? fromIndex : 0;
    const clipsToProcess = session.storyboard.slice(startIdx);

    auditLog(session, 'info', 'SCENE_IMAGES_START', {
      count: clipsToProcess.length,
      fromIndex: startIdx,
    });

    const results = await generateSceneImages(clipsToProcess);

    // Merge back into session storyboard
    results.forEach(({ clipNumber, sceneImageUrl }) => {
      const clip = session.storyboard.find(c => c.clipNumber === clipNumber);
      if (clip) clip.sceneImageUrl = sceneImageUrl || null;
    });

    auditLog(session, 'info', 'SCENE_IMAGES_DONE', {
      success: results.filter(r => r.sceneImageUrl).length,
      failed: results.filter(r => !r.sceneImageUrl).length,
    });

    await saveSession(session);

    return res.json({
      sceneImages: results.map(r => ({
        clipNumber: r.clipNumber,
        sceneImageUrl: r.sceneImageUrl,
        error: r.error || null,
      })),
    });
  } catch (err) {
    console.error('[reels/generate-scene-images]', err.message);
    auditLog(session, 'error', 'SCENE_IMAGES_ERROR', { error: err.message });
    try { await saveSession(session); } catch {}
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /generate-stream ────────────────────────────────────────────────────

router.post('/generate-stream', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  const session = await getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });

  if (!process.env.GEMINIGEN_API_KEY) {
    return res.status(500).json({ error: 'GEMINIGEN_API_KEY not configured' });
  }

  setupSSE(res);

  // Keep-alive ping every 20s
  const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 20_000);

  const cleanup = () => clearInterval(ping);

  try {
    // Delegate the full generation + merge pipeline to reelsGenerator
    const mergedInfo = await runGeneration(
      session,
      (data) => sse(res, data),   // SSE sender
      saveSession,
    );

    // null means runGeneration already sent an error SSE and session is saved
    if (mergedInfo) {
      sse(res, {
        type: 'ready',
        sessionId,
        mergedHash: mergedInfo.sha256,
        sizeBytes: mergedInfo.sizeBytes,
        downloadUrl: `/api/reels/download/${sessionId}`,
      });
    }

  } catch (err) {
    console.error('[reels/generate-stream]', err.message);
    auditLog(session, 'error', 'FATAL_ERROR', { error: err.message });
    session.status = 'error';
    try { await saveSession(session); } catch (e) {}
    sse(res, { type: 'error', message: err.message, resumable: false });
  } finally {
    cleanup();
    res.end();
  }
});

// ── GET /session/:sessionId ───────────────────────────────────────────────────

router.get('/session/:sessionId', async (req, res) => {
  const session = await getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });

  const publicStoryboard = (session.storyboard || []).map(c => ({
    clipNumber: c.clipNumber,
    visualSummary: c.visualSummary,
    voScript: c.voScript,
    grokPrompt: c.grokPrompt,
    sceneImageUrl: c.sceneImageUrl,
    technicalConfig: c.technicalConfig,
  }));

  return res.json({
    sessionId: session.sessionId,
    status: session.status,
    prompt: session.prompt,
    mode: session.mode,
    duration: session.duration,
    totalClips: session.totalClips,
    aspectRatio: session.aspectRatio || 'portrait',
    resolution: session.resolution || '720p',
    clipDuration: session.clipDuration || 10,
    voType: session.voType || 'narration',
    visualStyle: session.visualStyle || 'premium_3d',
    storyboard: publicStoryboard,
    clips: session.clips.map(c => ({
      index: c.index,
      status: c.status,
      uuid: c.uuid,
      videoUrl: c.videoUrl,
      thumbnailUrl: c.thumbnailUrl,
    })),
    downloadReady: session.downloadReady,
    mergedHash: session.mergedHash,
    sizeBytes: session.sizeBytes ?? null,
    referenceImageUrls: (session.referenceImageUrls || []).map(r => ({ tag: r.tag, label: r.label })),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });
});

// ── GET /download/:sessionId ──────────────────────────────────────────────────

router.get('/download/:sessionId', async (req, res) => {
  const session = await getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
  if (!session.downloadReady || !session.mergedPath) {
    return res.status(409).json({ error: 'Merged video not ready yet' });
  }

  const fp = session.mergedPath;
  if (!fs.existsSync(fp)) {
    return res.status(410).json({ error: 'Merged file no longer exists (already downloaded/cleaned)' });
  }

  const stat = fs.statSync(fp);
  const filename = `reel-${session.sessionId.slice(0, 8)}.mp4`;

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', stat.size);

  const stream = fs.createReadStream(fp);
  stream.pipe(res);

  stream.on('end', async () => {
    // Mark downloaded — individual clips already deleted after merge.
    // Merged file is kept 48h from creation for re-download, then swept by sweepExpiredMerged().
    const alreadyDownloaded = !!session.downloadedAt;
    session.downloadedAt = session.downloadedAt || new Date().toISOString();
    auditLog(session, 'info', 'DOWNLOAD_COMPLETE', {
      filename,
      sizeBytes: stat.size,
      reDownload: alreadyDownloaded,
    });
    await saveSession(session);
    console.info(`[reels/download] ${req.params.sessionId} — download complete (merged kept 48h)`);
  });

  stream.on('error', (err) => {
    console.error('[reels/download] stream error:', err.message);
  });
});

// ── POST /edit-clip ───────────────────────────────────────────────────────────
// Inline edits a storyboard clip's text fields — visualSummary and/or voScript.
// Does NOT regenerate via GPT-4o — just overwrites the stored text in session.

router.post('/edit-clip', async (req, res) => {
  const { sessionId, clipIndex, visualSummary, voScript } = req.body;

  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  if (typeof clipIndex !== 'number' || clipIndex < 0) {
    return res.status(400).json({ error: 'clipIndex must be a non-negative number' });
  }

  const session = await getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });

  const clip = session.storyboard[clipIndex];
  if (!clip) {
    return res.status(404).json({ error: `No clip at index ${clipIndex}` });
  }

  // Apply edits — only update fields that were sent
  if (typeof visualSummary === 'string') clip.visualSummary = visualSummary.trim();
  if (typeof voScript === 'string') clip.voScript = voScript.trim();

  auditLog(session, 'info', `CLIP_${clipIndex + 1}_EDITED`, {
    hasVisualSummary: typeof visualSummary === 'string',
    hasVoScript: typeof voScript === 'string',
  });

  await saveSession(session);

  return res.json({
    clipNumber: clip.clipNumber,
    visualSummary: clip.visualSummary,
    voScript: clip.voScript,
  });
});

// ── GET /audit/:sessionId ────────────────────────────────────────────────────

router.get('/audit/:sessionId', async (req, res) => {
  const session = await getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });

  return res.json({
    sessionId: session.sessionId,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    sessionHash: session._hash,
    audit: session.audit,
  });
});

module.exports = router;
