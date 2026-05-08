/**
 * POST /api/reels/generate-stream
 *   SSE endpoint — starts a reel generation job and streams per-clip progress.
 *   Body (JSON):
 *     prompt         — required
 *     targetDuration — 30 | 45 | 60 | 90 | 120  (default 30)
 *     mode           — optional generation mode string
 *
 * SSE events emitted:
 *   { type: "start",    totalClips, targetDuration }
 *   { type: "clip_start", clipIndex, totalClips }
 *   { type: "clip_progress", clipIndex, pct, totalClips }
 *   { type: "clip_done",  clipIndex, clip: { uuid, videoUrl, thumbnailUrl } }
 *   { type: "done",     clips: [...] }
 *   { type: "error",    message }
 */

const express = require('express');
const router = express.Router();
const { generateReel } = require('../services/geminiGenService');

// Allowed target durations
const VALID_DURATIONS = [30, 45, 60, 90, 120];

function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

router.post('/generate-stream', async (req, res) => {
  const { prompt, targetDuration = 30, mode } = req.body;

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const duration = VALID_DURATIONS.includes(Number(targetDuration))
    ? Number(targetDuration)
    : 30;

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const totalClips = Math.ceil(duration / 10);
  sendSSE(res, { type: 'start', totalClips, targetDuration: duration });

  // Keep-alive ping every 15s
  const ping = setInterval(() => {
    res.write(': ping\n\n');
  }, 15_000);

  try {
    if (!process.env.GEMINIGEN_API_KEY) {
      throw new Error('GEMINIGEN_API_KEY is not configured on the server');
    }

    const clips = await generateReel({
      prompt: prompt.trim(),
      targetDuration: duration,
      mode: mode || undefined,

      onClipProgress(clipIndex, pct) {
        sendSSE(res, { type: 'clip_progress', clipIndex, pct, totalClips });
      },

      onClipDone(clipIndex, clip) {
        sendSSE(res, { type: 'clip_done', clipIndex, clip, totalClips });
      },
    });

    sendSSE(res, { type: 'done', clips });
  } catch (err) {
    console.error('[reels] generation error:', err.message);
    sendSSE(res, { type: 'error', message: err.message });
  } finally {
    clearInterval(ping);
    res.end();
  }
});

module.exports = router;
