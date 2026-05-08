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

const {
  createSession, saveSession, getSession, auditLog, cleanupOldSessions,
} = require('../services/sessionStore');
const { buildStoryboard, refreshFromIndex } = require('../services/storyboardBuilder');
const { generateFirstClip, extendClip, pollUntilComplete } = require('../services/geminiGenService');
const {
  downloadClips, verifyClips, mergeClips, verifyMerged, cleanupClips, cleanupAll,
} = require('../services/reelsMerger');

// Run session cleanup on startup
cleanupOldSessions().catch(() => {});

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
  const { prompt, mode = 'normal', duration = 30 } = req.body;

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }
  const dur = VALID_DURATIONS.includes(Number(duration)) ? Number(duration) : 30;

  try {
    const session = createSession({ prompt: prompt.trim(), mode, duration: dur });
    auditLog(session, 'info', 'SESSION_CREATED', { prompt: prompt.trim(), mode, duration: dur });

    // Build storyboard via GPT-4o
    auditLog(session, 'info', 'STORYBOARD_BUILD_START', {});
    const storyboard = await buildStoryboard({ prompt: prompt.trim(), mode, duration: dur });

    session.storyboard = storyboard;
    session.status = 'reviewing';
    auditLog(session, 'info', 'STORYBOARD_BUILT', { clipCount: storyboard.length });

    await saveSession(session);

    const publicStoryboard = storyboard.map(c => ({
      clipNumber: c.clipNumber,
      visualSummary: c.visualSummary,
      voScript: c.voScript,
      grokPrompt: c.grokPrompt,
      technicalConfig: c.technicalConfig,
    }));

    return res.json({ sessionId: session.sessionId, storyboard: publicStoryboard });
  } catch (err) {
    console.error('[reels/build-storyboard]', err.message);
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

      for (let attempt = 1; attempt <= MAX_CLIP_ATTEMPTS; attempt++) {
        clipRecord.attempts = attempt;
        auditLog(session, 'info', `CLIP_${i + 1}_ATTEMPT_${attempt}`, { prompt: grokPrompt.slice(0, 80) });

        try {
          // Generate or extend
          let result;
          if (i === 0) {
            result = await generateFirstClip({ prompt: grokPrompt, mode });
          } else {
            const prevClip = session.clips.find(c => c.index === i - 1 && c.status === 'done');
            if (!prevClip?.uuid) throw new Error(`Previous clip UUID not found for extend`);
            result = await extendClip({ prompt: grokPrompt, refUuid: prevClip.uuid });
          }

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
    // After download complete — cleanup everything
    session.downloadedAt = new Date().toISOString();
    auditLog(session, 'info', 'DOWNLOAD_COMPLETE', { filename, sizeBytes: stat.size });
    await saveSession(session);

    // Delete files
    cleanupAll(req.params.sessionId);
    auditLog(session, 'info', 'ALL_FILES_CLEANED', {});
    await saveSession(session);

    console.info(`[reels/download] Session ${req.params.sessionId} — files cleaned after download`);
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
