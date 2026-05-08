/**
 * GeminiGen Service — Grok video generation via GeminiGen API
 *
 * Confirmed endpoints (tested 2026-05-08):
 *   Generate : POST https://api.geminigen.ai/uapi/v1/video-gen/grok
 *   Extend   : POST https://api.geminigen.ai/uapi/v1/video-extend/grok  (ref_history = UUID)
 *   Poll     : GET  https://api.geminigen.ai/uapi/v1/history/{uuid}
 *   Auth     : x-api-key header
 *
 * Status codes: 1 = processing, 2 = completed, 3 = failed
 *
 * Confirmed generation modes (tested 2026-05-08):
 *   "normal"                   — Standard video generation
 *   "extremely-crazy"          — Wild and unpredictable
 *   "extremely-spicy-or-crazy" — Maximum creativity and chaos
 *   "custom"                   — Custom generation settings
 */

const axios = require('axios');
const FormData = require('form-data');

const BASE_URL = 'https://api.geminigen.ai';

// Read dynamically so Railway env vars are always current (not frozen at module load)
function apiKey() { return process.env.GEMINIGEN_API_KEY || ''; }

// How often to poll, and max wait time per clip
const POLL_INTERVAL_MS = 8_000;
const POLL_TIMEOUT_MS = 5 * 60_000; // 5 minutes per clip
const REQUEST_TIMEOUT_MS = 30_000;  // 30s for generate/extend calls

// ─── helpers ────────────────────────────────────────────────────────────────

function apiHeaders() {
  return { 'x-api-key': apiKey() };
}

/**
 * Poll until status 2 (completed) or 3 (failed), or timeout.
 * Resolves with the history record on success.
 */
async function pollUntilComplete(uuid, onProgress) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const { data } = await axios.get(`${BASE_URL}/uapi/v1/history/${uuid}`, {
      headers: apiHeaders(),
      timeout: REQUEST_TIMEOUT_MS,
      maxRedirects: 5,
    });

    const pct = data.status_percentage || 0;
    onProgress && onProgress(pct);

    if (data.status === 2) {
      // completed
      const videoUrl =
        data.generated_video?.[0]?.video_url ||
        data.generated_video?.[data.generated_video.length - 1]?.video_url ||
        null;
      return { uuid, videoUrl, thumbnailUrl: data.thumbnail_url || null };
    }

    if (data.status === 3) {
      throw new Error(`Clip generation failed: ${data.error_message || 'Unknown error'}`);
    }
  }

  throw new Error(`Clip timed out after ${POLL_TIMEOUT_MS / 1000}s (uuid: ${uuid})`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Generate the FIRST clip from a text prompt.
 * Returns { uuid } immediately (async job).
 */
async function generateFirstClip({ prompt, mode }) {
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('model', 'grok-video');
  form.append('aspect_ratio', 'portrait');
  form.append('resolution', '720p');
  form.append('duration', '10');
  if (mode) form.append('mode', mode);

  const { data } = await axios.post(`${BASE_URL}/uapi/v1/video-gen/grok`, form, {
    headers: { ...apiHeaders(), ...form.getHeaders() },
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: 5,
  });

  if (!data.uuid) throw new Error('No UUID returned from GeminiGen generate');
  return { uuid: data.uuid };
}

/**
 * Extend from a previous clip UUID.
 * prompt   — continuation prompt (can be same as original)
 * refUuid  — UUID of the clip to extend from
 * Returns { uuid } immediately.
 */
async function extendClip({ prompt, refUuid }) {
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('ref_history', refUuid);
  form.append('resolution', '720p');
  form.append('duration', '10');

  const { data } = await axios.post(`${BASE_URL}/uapi/v1/video-extend/grok`, form, {
    headers: { ...apiHeaders(), ...form.getHeaders() },
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: 5,
  });

  if (!data.uuid) throw new Error('No UUID returned from GeminiGen extend');
  return { uuid: data.uuid };
}

/**
 * High-level: generate a full reel by chaining clips.
 *
 * @param {string}   prompt         — video prompt
 * @param {number}   targetDuration — total desired duration in seconds (30–120)
 * @param {string}   [mode]         — generation mode (optional)
 * @param {Function} onClipProgress — (clipIndex, pct, totalClips) callback
 * @param {Function} onClipDone     — (clipIndex, { uuid, videoUrl, thumbnailUrl }) callback
 *
 * @returns {Promise<Array<{uuid, videoUrl, thumbnailUrl}>>}
 */
async function generateReel({ prompt, targetDuration = 30, mode, onClipProgress, onClipDone }) {
  const totalClips = Math.ceil(targetDuration / 10);
  const clips = [];

  for (let i = 0; i < totalClips; i++) {
    const isFirst = i === 0;

    // Start the generation/extension
    let result;
    if (isFirst) {
      result = await generateFirstClip({ prompt, mode });
    } else {
      result = await extendClip({ prompt, refUuid: clips[i - 1].uuid });
    }

    const { uuid } = result;

    // Poll until complete
    const clip = await pollUntilComplete(uuid, (pct) => {
      onClipProgress && onClipProgress(i, pct, totalClips);
    });

    clips.push(clip);
    onClipDone && onClipDone(i, clip);
  }

  return clips;
}

/**
 * Generate a reel from an explicit array of per-clip prompts.
 * Clip 0 is generated fresh; clips 1+ extend from the previous UUID.
 *
 * @param {string[]}  clipPrompts     — per-clip prompt strings
 * @param {string}    [mode]          — generation mode
 * @param {Function}  onClipProgress  — (clipIndex, pct, totalClips)
 * @param {Function}  onClipDone      — (clipIndex, clip)
 */
async function generateReelFromPrompts({ clipPrompts, mode, onClipProgress, onClipDone }) {
  const totalClips = clipPrompts.length;
  const clips = [];

  for (let i = 0; i < totalClips; i++) {
    const prompt = clipPrompts[i];
    const isFirst = i === 0;

    let result;
    if (isFirst) {
      result = await generateFirstClip({ prompt, mode });
    } else {
      result = await extendClip({ prompt, refUuid: clips[i - 1].uuid });
    }

    const { uuid } = result;

    const clip = await pollUntilComplete(uuid, (pct) => {
      onClipProgress && onClipProgress(i, pct, totalClips);
    });

    clips.push(clip);
    onClipDone && onClipDone(i, clip);
  }

  return clips;
}

module.exports = { generateFirstClip, extendClip, pollUntilComplete, generateReel, generateReelFromPrompts };
