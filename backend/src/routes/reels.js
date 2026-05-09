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
const { generateSceneImages, generateSceneImage } = require('../services/sceneImageService');
const {
  cleanupAll, sweepExpiredMerged,
} = require('../services/reelsMerger');
const { runGeneration } = require('../services/reelsGenerator');
const { scrapeProduct } = require('../services/productScraper');
const { generateSRT } = require('../services/subtitleService');
const { reviewGeneratedClips } = require('../services/reviewAgent');
const { chatCompletion } = require('../services/apimart');
const { VOICES: TTS_VOICES } = require('../services/ttsService');

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
const VALID_EXPORT_RESOLUTIONS = ['720p', '1080p', '4k'];
const VALID_TRANSITIONS = ['cut', 'fade', 'dissolve', 'wipeleft', 'zoom'];

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
    // Feature 4 — pin first reference as main character (frontend sends index)
    pinnedCharacterIndex = null,
    // Feature 7 — TTS dub config
    enableTTS = false,
    ttsVoice = 'nova',
    // Feature 9 — export resolution
    exportResolution = '720p',
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
  const expRes = VALID_EXPORT_RESOLUTIONS.includes(exportResolution) ? exportResolution : '720p';
  const tts = !!enableTTS;
  const ttsVoiceClean = (TTS_VOICES.includes(ttsVoice)) ? ttsVoice : 'nova';

  // Validate referenceImages count upfront
  if (!Array.isArray(rawRefImages)) {
    return res.status(400).json({ error: 'referenceImages must be an array' });
  }
  if (rawRefImages.length > MAX_REFERENCE_IMAGES) {
    return res.status(400).json({
      error: `Maximum ${MAX_REFERENCE_IMAGES} reference images allowed (you sent ${rawRefImages.length})`,
    });
  }

  const session = createSession({
    prompt: prompt.trim(), mode, duration: dur,
    aspectRatio: ar, resolution: res_, clipDuration: clipDur,
    voType: vt, visualStyle: vs, projectType: pt, outputLanguage: lang,
    scriptText: st,
    enableTTS: tts, ttsVoice: ttsVoiceClean,
    exportResolution: expRes,
  });
  auditLog(session, 'info', 'SESSION_CREATED', {
    prompt: prompt.trim(), mode, duration: dur, aspectRatio: ar, resolution: res_,
    clipDuration: clipDur, voType: vt, visualStyle: vs, projectType: pt,
    outputLanguage: lang, hasScript: !!st, enableTTS: tts, ttsVoice: ttsVoiceClean,
    exportResolution: expRes,
  });

  // Save session immediately so crash recovery can find it
  await saveSession(session);

  try {
    // Save reference images to disk
    let savedRefs = [];
    if (rawRefImages.length > 0) {
      auditLog(session, 'info', 'REF_IMAGES_SAVE_START', { count: rawRefImages.length });
      savedRefs = saveReferenceImages(session.sessionId, rawRefImages);
      session.referenceImageUrls = savedRefs;
      // Feature 4: pin one of the uploaded refs as main character
      if (typeof pinnedCharacterIndex === 'number'
          && pinnedCharacterIndex >= 0
          && pinnedCharacterIndex < savedRefs.length) {
        session.pinnedCharacterImageUrl = savedRefs[pinnedCharacterIndex].url;
      }
      auditLog(session, 'info', 'REF_IMAGES_SAVED', {
        count: savedRefs.length,
        tags: savedRefs.map(r => r.tag),
        pinnedCharacterIndex: typeof pinnedCharacterIndex === 'number' ? pinnedCharacterIndex : null,
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
      pinnedCharacterImageUrl: session.pinnedCharacterImageUrl || null,
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

// ── FEATURE 3 — POST /scrape-product ─────────────────────────────────────────
// Paste product URL → auto-fill ad brief + product image
router.post('/scrape-product', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url is required' });
  try {
    const result = await scrapeProduct(url);
    res.json(result);
  } catch (e) {
    console.error('[reels/scrape-product]', e.message);
    res.status(500).json({ error: `Scraping failed: ${e.message}` });
  }
});

// ── FEATURE 5 — POST /expand-script ──────────────────────────────────────────
// Take a brief logline and expand it into a full scene-by-scene script.
router.post('/expand-script', async (req, res) => {
  const { brief, projectType = 'product_promo', clipCount = 5, outputLanguage = 'en' } = req.body || {};
  if (!brief || typeof brief !== 'string') return res.status(400).json({ error: 'brief is required' });

  const langName = {
    en: 'English', id: 'Bahasa Indonesia', th: 'Thai', vi: 'Vietnamese',
    zh: 'Mandarin Chinese', es: 'Spanish', pt: 'Portuguese', ar: 'Arabic',
    ko: 'Korean', ja: 'Japanese', hi: 'Hindi',
  }[outputLanguage] || 'English';

  const cc = Math.max(2, Math.min(12, parseInt(clipCount) || 5));

  try {
    const response = await chatCompletion({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a professional screenwriter specializing in short-form video ads.' },
        {
          role: 'user',
          content: `Write the script in ${langName}.
Expand this brief into a ${cc}-scene video ad script.
Brief: "${brief}"
Project type: ${projectType}

For each scene return EXACTLY this format:
SCENE [N]:
Setting: [location + atmosphere]
Action: [what happens visually]
VO/Dialogue: [what is said — max 2 sentences]
Camera: [shot type: close-up/wide/medium/drone]
Emotion: [dominant emotion for viewer]

Make scene 1 a strong hook. Make last scene a clear CTA.`,
        },
      ],
      maxTokens: 1500,
      temperature: 0.8,
    });
    res.json({ expandedScript: response, clipCount: cc });
  } catch (e) {
    console.error('[reels/expand-script]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── FEATURE 6 — GET /:sessionId/subtitles ────────────────────────────────────
// Generate SRT subtitle download from session storyboard's voScripts.
router.get('/:sessionId/subtitles', async (req, res) => {
  const session = await getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const clipDur = session.clipDuration || 10;
  const clipsForSrt = (session.storyboard || []).map(c => ({
    voScript: c.voScript || c.technicalConfig?.voScript || '',
    clipDuration: clipDur,
  }));
  const srt = generateSRT(clipsForSrt);

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="reel-${req.params.sessionId.slice(0, 8)}.srt"`);
  res.send(srt);
});

// ── FEATURE 8 — POST /build-storyboard-variants ──────────────────────────────
// Generate 3 storyboard variants with different creative angles.
router.post('/build-storyboard-variants', async (req, res) => {
  const {
    prompt, mode = 'normal', duration = 30,
    aspectRatio = 'portrait', resolution = '720p', clipDuration = 10,
    voType = 'narration', visualStyle = 'premium_3d',
    projectType = 'default', outputLanguage = 'id',
    scriptText = null, referenceImages: rawRefImages = [],
  } = req.body || {};

  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'prompt is required' });

  const angles = [
    { label: 'Emotional Story',   key: 'emotional', angleInstruction: 'Focus on emotional connection and storytelling. Use personal transformation narrative. Make viewers feel something.' },
    { label: 'Benefits & Features', key: 'benefits', angleInstruction: 'Focus on product features, specs, and measurable benefits. Lead with the #1 unique benefit. Use numbers and facts.' },
    { label: 'Social Proof',      key: 'social',   angleInstruction: 'Focus on credibility: testimonials, user count, reviews, awards, before/after results. Build trust first.' },
  ];

  // Normalise scalar params
  const dur = VALID_DURATIONS.includes(Number(duration)) ? Number(duration) : 30;
  const clipDur = VALID_CLIP_DURATIONS.includes(Number(clipDuration)) ? Number(clipDuration) : 10;
  const ar = VALID_ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : 'portrait';
  const res_ = VALID_RESOLUTIONS.includes(resolution) ? resolution : '720p';
  const vt = VALID_VO_TYPES.includes(voType) ? voType : 'narration';
  const vs = VALID_VISUAL_STYLES.includes(visualStyle) ? visualStyle : 'premium_3d';
  const pt = VALID_PROJECT_TYPES.includes(projectType) ? projectType : 'default';
  const lang = VALID_OUTPUT_LANGUAGES.includes(outputLanguage) ? outputLanguage : 'id';

  // Build all 3 variants in parallel — each gets its own session so user can pick one to proceed
  const built = await Promise.allSettled(angles.map(async (angle) => {
    const session = createSession({
      prompt: prompt.trim(), mode, duration: dur,
      aspectRatio: ar, resolution: res_, clipDuration: clipDur,
      voType: vt, visualStyle: vs, projectType: pt, outputLanguage: lang,
      scriptText: (scriptText && scriptText.trim()) || null,
    });
    auditLog(session, 'info', 'VARIANT_SESSION_CREATED', { angle: angle.key });

    let savedRefs = [];
    if (Array.isArray(rawRefImages) && rawRefImages.length > 0) {
      try { savedRefs = saveReferenceImages(session.sessionId, rawRefImages); session.referenceImageUrls = savedRefs; } catch {}
    }

    const storyboard = await buildStoryboard({
      prompt: prompt.trim(), mode, duration: dur, referenceImages: savedRefs,
      aspectRatio: ar, clipDuration: clipDur, voType: vt, visualStyle: vs,
      projectType: pt, outputLanguage: lang,
      scriptText: (scriptText && scriptText.trim()) || null,
      additionalInstruction: angle.angleInstruction,
    });
    session.storyboard = storyboard;
    session.status = 'reviewing';
    await saveSession(session);

    return {
      label: angle.label,
      key: angle.key,
      sessionId: session.sessionId,
      storyboard: storyboard.map(c => ({
        clipNumber: c.clipNumber,
        visualSummary: c.visualSummary,
        voScript: c.voScript,
        grokPrompt: c.grokPrompt,
        sceneImageUrl: c.sceneImageUrl,
        technicalConfig: c.technicalConfig,
      })),
    };
  }));

  const variants = built
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
  const errors = built
    .filter(r => r.status === 'rejected')
    .map(r => ({ error: r.reason?.message || 'Unknown error' }));

  if (variants.length === 0) {
    return res.status(500).json({ error: 'All variants failed to build', errors });
  }
  res.json({ variants, errors });
});

// ── FEATURE 10 — POST /:sessionId/clip-references ────────────────────────────
// Override reference images for a specific clip index.
router.post('/:sessionId/clip-references', async (req, res) => {
  const { clipIndex, imageUrls } = req.body || {};
  if (typeof clipIndex !== 'number' || clipIndex < 0) {
    return res.status(400).json({ error: 'clipIndex must be a non-negative number' });
  }
  if (!Array.isArray(imageUrls)) {
    return res.status(400).json({ error: 'imageUrls must be an array of strings' });
  }
  const session = await getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (!session.clipReferenceOverrides) session.clipReferenceOverrides = {};
  if (imageUrls.length === 0) {
    delete session.clipReferenceOverrides[clipIndex];
  } else {
    session.clipReferenceOverrides[clipIndex] = imageUrls.filter(u => typeof u === 'string' && u);
  }
  auditLog(session, 'info', `CLIP_${clipIndex + 1}_REFS_OVERRIDE`, { count: imageUrls.length });
  await saveSession(session);
  res.json({ ok: true, clipReferenceOverrides: session.clipReferenceOverrides });
});

// ── FEATURE 11 — POST /:sessionId/review ─────────────────────────────────────
// Run self-review agent on generated clips → returns issues + score.
router.post('/:sessionId/review', async (req, res) => {
  const session = await getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const clipsForReview = (session.clips || []).map((c, i) => ({
    clipIndex: c.index ?? i,
    thumbnailUrl: c.thumbnailUrl || null,
    voScript: session.storyboard?.[c.index ?? i]?.voScript || '',
  }));

  try {
    const review = await reviewGeneratedClips(clipsForReview, session.prompt || '');
    session.review = { ...review, reviewedAt: new Date().toISOString() };
    auditLog(session, 'info', 'REVIEW_DONE', {
      score: review.overallScore,
      issueCount: (review.issues || []).length,
    });
    await saveSession(session);
    res.json(review);
  } catch (e) {
    console.error('[reels/review]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── FEATURE 12 — POST /:sessionId/edit-clip-ai ───────────────────────────────
// Conversational shot editing — natural language modifies a clip's prompt+config.
// Note: distinct path from existing POST /edit-clip (which is plain inline text edit).
router.post('/:sessionId/edit-clip-ai', async (req, res) => {
  const { clipIndex, instruction } = req.body || {};
  if (typeof clipIndex !== 'number' || clipIndex < 0) {
    return res.status(400).json({ error: 'clipIndex must be a non-negative number' });
  }
  if (!instruction || typeof instruction !== 'string') {
    return res.status(400).json({ error: 'instruction is required' });
  }

  const session = await getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const clip = session.storyboard?.[clipIndex];
  if (!clip) return res.status(404).json({ error: `Clip ${clipIndex} not found` });

  try {
    const response = await chatCompletion({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a video director. Modify the given clip spec based on the instruction. Return the FULL updated clip as JSON only (no markdown), preserving all fields not mentioned in the instruction.',
        },
        {
          role: 'user',
          content: `Current clip spec:
${JSON.stringify(clip, null, 2)}

User instruction: "${instruction}"

Return the updated clip JSON only. Preserve structure. Update grokPrompt, voScript, visualSummary, and technicalConfig fields to reflect the instruction.`,
        },
      ],
      maxTokens: 2000,
      temperature: 0.7,
    });

    let updatedClip = clip;
    try {
      const match = response.match(/\{[\s\S]*\}/);
      if (match) updatedClip = { ...clip, ...JSON.parse(match[0]) };
    } catch (e) {
      console.warn('[reels/edit-clip-ai] parse failed, keeping original:', e.message);
    }

    // Regenerate scene image (non-blocking)
    try {
      const sceneImageUrl = await generateSceneImage(updatedClip.grokPrompt || '');
      if (sceneImageUrl) updatedClip.sceneImageUrl = sceneImageUrl;
    } catch {}

    session.storyboard[clipIndex] = updatedClip;
    auditLog(session, 'info', `CLIP_${clipIndex + 1}_EDIT_AI`, { instruction: instruction.slice(0, 100) });
    await saveSession(session);

    res.json({ clip: updatedClip, clipIndex });
  } catch (e) {
    console.error('[reels/edit-clip-ai]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── FEATURE 13 — POST /:sessionId/transitions ────────────────────────────────
// Set per-position transition types between clips (cut/fade/dissolve/etc).
router.post('/:sessionId/transitions', async (req, res) => {
  const { transitions } = req.body || {};
  if (!transitions || typeof transitions !== 'object') {
    return res.status(400).json({ error: 'transitions object required' });
  }
  const session = await getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const cleaned = {};
  for (const [k, v] of Object.entries(transitions)) {
    if (VALID_TRANSITIONS.includes(v)) cleaned[k] = v;
  }
  session.transitions = cleaned;
  auditLog(session, 'info', 'TRANSITIONS_SET', { count: Object.keys(cleaned).length });
  await saveSession(session);
  res.json({ ok: true, transitions: session.transitions });
});

// ── FEATURE 9 — POST /:sessionId/export-settings ─────────────────────────────
// Update export resolution + TTS toggle without rebuilding storyboard.
router.post('/:sessionId/export-settings', async (req, res) => {
  const { exportResolution, enableTTS, ttsVoice } = req.body || {};
  const session = await getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (exportResolution !== undefined) {
    if (!VALID_EXPORT_RESOLUTIONS.includes(exportResolution)) {
      return res.status(400).json({ error: `exportResolution must be one of ${VALID_EXPORT_RESOLUTIONS.join(', ')}` });
    }
    session.exportResolution = exportResolution;
  }
  if (enableTTS !== undefined) session.enableTTS = !!enableTTS;
  if (ttsVoice !== undefined) {
    if (!TTS_VOICES.includes(ttsVoice)) {
      return res.status(400).json({ error: `ttsVoice must be one of ${TTS_VOICES.join(', ')}` });
    }
    session.ttsVoice = ttsVoice;
  }
  auditLog(session, 'info', 'EXPORT_SETTINGS_UPDATED', {
    exportResolution: session.exportResolution,
    enableTTS: session.enableTTS,
    ttsVoice: session.ttsVoice,
  });
  await saveSession(session);
  res.json({
    exportResolution: session.exportResolution,
    enableTTS: session.enableTTS,
    ttsVoice: session.ttsVoice,
  });
});

// ── FEATURE A — POST /:sessionId/merge-custom (Timeline Editor) ──────────────
// Re-merges existing downloaded clips in a custom order (drag-drop reorder).
// Uses SSE so the frontend can stream merge progress back to the user.
router.post('/:sessionId/merge-custom', async (req, res) => {
  const { sessionId } = req.params;
  const { clipOrder, exportResolution } = req.body || {};

  const session = await getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!session.downloadReady && !(session.clips && session.clips.length)) {
    return res.status(400).json({ error: 'Clips not generated yet' });
  }

  const clipCount = (session.storyboard && session.storyboard.length) || (session.clips && session.clips.length) || 0;
  if (!clipCount) return res.status(400).json({ error: 'No clips found' });

  // Validate clipOrder — must be a permutation of [0..clipCount-1]
  let order = Array.from({ length: clipCount }, (_, i) => i);
  if (Array.isArray(clipOrder) && clipOrder.length === clipCount) {
    const valid = clipOrder.every(n => Number.isInteger(n) && n >= 0 && n < clipCount)
      && new Set(clipOrder).size === clipCount;
    if (valid) order = clipOrder;
  }

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      if (typeof res.flush === 'function') res.flush();
    }
  };
  const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 20_000);

  try {
    send({ type: 'merge_start', clipCount, order });
    const { mergeClips, getMergedPath } = require('../services/reelsMerger');
    const fs = require('fs');
    const crypto = require('crypto');

    const expRes = ['720p', '1080p', '4k'].includes(exportResolution)
      ? exportResolution
      : (session.exportResolution || '720p');

    await mergeClips(
      sessionId,
      clipCount,
      ({ phase, progress }) => send({ type: 'merge_progress', phase, progress: Math.round(progress || 0) }),
      {
        clipOrder: order,
        exportResolution: expRes,
        transitions: session.transitions || {},
        clipDuration: session.clipDuration || 10,
        // TTS already mixed during initial merge — don't re-mix on re-order
        ttsAudioPaths: null,
      }
    );

    const mergedFilePath = getMergedPath(sessionId);
    if (!fs.existsSync(mergedFilePath)) throw new Error('Merged file missing after re-merge');

    const stat = fs.statSync(mergedFilePath);
    const buf = fs.readFileSync(mergedFilePath);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');

    session.downloadReady = true;
    session.mergedPath = mergedFilePath;
    session.mergedHash = hash;
    session.sizeBytes = stat.size;
    session.clipOrder = order;
    session.exportResolution = expRes;
    auditLog(session, 'info', 'CUSTOM_MERGE_DONE', { order, exportResolution: expRes, sizeBytes: stat.size });
    await saveSession(session);

    send({
      type: 'ready',
      sessionId,
      downloadUrl: `/api/reels/download/${sessionId}`,
      sizeBytes: stat.size,
      mergedHash: hash,
    });
    res.end();
  } catch (e) {
    console.error('[reels/merge-custom]', e.message);
    send({ type: 'error', message: e.message, resumable: true });
    res.end();
  } finally {
    clearInterval(ping);
  }
});

module.exports = router;
