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
const { buildStoryboard, refreshFromIndex } = require('../services/storyboardBuilder');
const { generateFirstClip, pollUntilComplete } = require('../services/geminiGenService');
const { generateSceneImages, generateSingleSceneImage } = require('../services/sceneImageService');
const {
  downloadClips, verifyClips, mergeClips, verifyMerged, cleanupClips, cleanupAll,
  sweepExpiredMerged,
} = require('../services/reelsMerger');

// Run session cleanup + merged-file sweep on startup
cleanupOldSessions().catch(() => {});
sweepExpiredMerged();

// Periodic sweep every 6 hours (catches missed deletes across restarts)
setInterval(() => sweepExpiredMerged(), 6 * 60 * 60 * 1000);

const VALID_DURATIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
const MAX_CLIP_ATTEMPTS = 3;

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
  const { prompt, mode = 'normal', duration = 30, referenceImages: rawRefImages = [] } = req.body;

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }
  const dur = VALID_DURATIONS.includes(Number(duration)) ? Number(duration) : 30;

  // Validate referenceImages count upfront
  if (!Array.isArray(rawRefImages)) {
    return res.status(400).json({ error: 'referenceImages must be an array' });
  }
  if (rawRefImages.length > MAX_REFERENCE_IMAGES) {
    return res.status(400).json({
      error: `Maximum ${MAX_REFERENCE_IMAGES} reference images allowed (you sent ${rawRefImages.length})`,
    });
  }

  const session = createSession({ prompt: prompt.trim(), mode, duration: dur });
  auditLog(session, 'info', 'SESSION_CREATED', { prompt: prompt.trim(), mode, duration: dur });

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
    const { totalClips, storyboard, mode } = session;

    session.status = 'generating';
    auditLog(session, 'info', 'GENERATION_START', { totalClips });
    await saveSession(session);

    sse(res, { type: 'start', totalClips, sessionId });

    // ── generate each clip (resume-aware) ────────────────────────────────────
    for (let i = 0; i < totalClips; i++) {
      const existingClip = session.clips.find(c => c.index === i && c.status === 'done');

      if (existingClip) {
        // Already done — skip (resume mode)
        sse(res, { type: 'clip_skip', clipIndex: i, totalClips, uuid: existingClip.uuid });
        auditLog(session, 'info', `CLIP_${i + 1}_SKIPPED_RESUME`, { uuid: existingClip.uuid });
        continue;
      }

      sse(res, { type: 'clip_start', clipIndex: i, totalClips });

      // Find or init clip record
      let clipRecord = session.clips.find(c => c.index === i);
      if (!clipRecord) {
        clipRecord = { index: i, status: 'pending', uuid: null, videoUrl: null, sha256: null, attempts: 0, error: null };
        session.clips.push(clipRecord);
      }

      const grokPrompt = storyboard[i]?.grokPrompt;
      if (!grokPrompt) {
        const err = `Storyboard missing grokPrompt for clip ${i + 1}`;
        sse(res, { type: 'error', message: err });
        auditLog(session, 'error', `CLIP_${i + 1}_NO_PROMPT`, { error: err });
        session.status = 'error';
        await saveSession(session);
        cleanup();
        return res.end();
      }

      let clipDone = false;

      // All clips are independently generated (no extend chain)
      // image_urls[] = [sceneImageUrl, ...userRefImageUrls] for visual reference
      const clipMeta = storyboard[i];

      // Collect image URLs: scene image first, then user-uploaded ref images for this clip
      const imageUrls = [];
      const sceneImageUrl = clipMeta?.sceneImageUrl;
      if (sceneImageUrl) imageUrls.push(sceneImageUrl);

      // User-uploaded reference images (character/product) — kept in session.referenceImageUrls
      // Include all user refs for every clip (AI decides relevance via @imageN in grokPrompt)
      (session.referenceImageUrls || []).forEach(r => {
        if (r.url) imageUrls.push(r.url);
      });

      for (let attempt = 1; attempt <= MAX_CLIP_ATTEMPTS; attempt++) {
        clipRecord.attempts = attempt;
        auditLog(session, 'info', `CLIP_${i + 1}_ATTEMPT_${attempt}`, {
          prompt: grokPrompt.slice(0, 80),
          imageUrls,
        });

        try {
          // Every clip is a fresh generate with its scene image as visual reference
          let result;
          result = await generateFirstClip({ prompt: grokPrompt, mode, imageUrls });

          clipRecord.uuid = result.uuid;
          clipRecord.status = 'polling';
          await saveSession(session);

          // Poll with progress
          const clip = await pollUntilComplete(result.uuid, (pct) => {
            sse(res, { type: 'clip_progress', clipIndex: i, pct, totalClips });
          });

          clipRecord.status = 'done';
          clipRecord.videoUrl = clip.videoUrl;
          clipRecord.thumbnailUrl = clip.thumbnailUrl;
          clipRecord.completedAt = new Date().toISOString();

          auditLog(session, 'info', `CLIP_${i + 1}_DONE`, {
            uuid: result.uuid,
            videoUrl: clip.videoUrl,
            attempt,
          });
          await saveSession(session);

          sse(res, {
            type: 'clip_done',
            clipIndex: i,
            totalClips,
            clip: { uuid: clip.uuid, videoUrl: clip.videoUrl, thumbnailUrl: clip.thumbnailUrl },
          });

          clipDone = true;
          break;

        } catch (err) {
          clipRecord.error = err.message;
          auditLog(session, 'error', `CLIP_${i + 1}_ATTEMPT_${attempt}_FAIL`, { error: err.message });
          await saveSession(session);

          if (attempt < MAX_CLIP_ATTEMPTS) {
            sse(res, { type: 'clip_retry', clipIndex: i, attempt, error: err.message });
            await sleep(3000 * attempt); // backoff
          }
        }
      }

      if (!clipDone) {
        clipRecord.status = 'error';
        session.status = 'partial';
        auditLog(session, 'error', `CLIP_${i + 1}_FAILED_ALL_ATTEMPTS`, { clipIndex: i });
        await saveSession(session);

        sse(res, {
          type: 'error',
          message: `Clip ${i + 1} failed after ${MAX_CLIP_ATTEMPTS} attempts. Session saved — you can resume.`,
          resumable: true,
          failedAtClip: i,
          sessionId,
        });
        cleanup();
        return res.end();
      }
    }

    // ── all clips done — merge ─────────────────────────────────────────────────
    session.status = 'merging';
    auditLog(session, 'info', 'MERGE_START', { clipCount: totalClips });
    await saveSession(session);

    sse(res, { type: 'merge_start', totalClips });

    // Download clips
    sse(res, { type: 'merge_progress', phase: 'downloading', progress: 0 });
    auditLog(session, 'info', 'MERGE_DOWNLOADING', {});

    // Sort by index to guarantee clip-0.mp4, clip-1.mp4 … order matches merge sequence
    const doneClips = session.clips
      .filter(c => c.status === 'done')
      .sort((a, b) => a.index - b.index);
    await downloadClips(sessionId, doneClips, ({ clipIndex, total }) => {
      sse(res, { type: 'merge_progress', phase: 'downloading', clipIndex, total });
    });

    // Verify downloads
    auditLog(session, 'info', 'MERGE_VERIFYING_CLIPS', {});
    const verified = await verifyClips(sessionId, totalClips);
    verified.forEach(v => {
      auditLog(session, 'info', `CLIP_${v.index + 1}_VERIFIED`, { sha256: v.sha256, sizeBytes: v.sizeBytes });
    });

    // FFmpeg merge
    sse(res, { type: 'merge_progress', phase: 'merging', progress: 0 });
    auditLog(session, 'info', 'FFMPEG_START', {});

    await mergeClips(sessionId, totalClips, ({ phase, progress }) => {
      sse(res, { type: 'merge_progress', phase, progress: Math.round(progress) });
    });

    // Verify merged
    const mergedInfo = await verifyMerged(sessionId);
    session.mergedPath = mergedInfo.path;
    session.mergedHash = mergedInfo.sha256;
    session.sizeBytes = mergedInfo.sizeBytes;
    session.status = 'done';
    session.downloadReady = true;

    auditLog(session, 'info', 'MERGE_DONE', {
      mergedPath: mergedInfo.path,
      mergedHash: mergedInfo.sha256,
      sizeBytes: mergedInfo.sizeBytes,
    });

    // Cleanup individual clip files (merged is kept until download)
    cleanupClips(sessionId, totalClips);
    auditLog(session, 'info', 'CLIPS_CLEANED', { count: totalClips });

    await saveSession(session);

    sse(res, {
      type: 'ready',
      sessionId,
      mergedHash: mergedInfo.sha256,
      sizeBytes: mergedInfo.sizeBytes,
      downloadUrl: `/api/reels/download/${sessionId}`,
    });

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

// ── helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = router;
