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
 * Confirmed generation modes (docs verified 2026-05-08):
 *   "normal"                   — Standard video generation
 *   "extremely-crazy"          — Wild and unpredictable
 *   "extremely-spicy-or-crazy" — Maximum creativity and chaos
 *   "custom"                   — Custom generation settings
 *
 * Aspect ratios: portrait (9:16), landscape (16:9), square (1:1), vertical (2:3), horizontal (3:2)
 * Resolutions  : 480p (default), 720p
 * Durations    : 6, 10, 15 (seconds, integer)
 * Reference img: file_urls[] (priority 2 of 3) — one method per request only
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
 * Generate a FRESH clip from a text prompt, optionally with reference images.
 *
 * @param {string}   prompt        - The text prompt for the clip
 * @param {string}   mode          - Generation mode: normal | extremely-crazy | extremely-spicy-or-crazy | custom
 * @param {string[]} imageUrls     - Array of public CDN URLs sent as file_urls[] (GeminiGen param)
 * @param {string}   aspectRatio   - portrait | landscape | square | vertical | horizontal (default: portrait)
 * @param {string}   resolution    - 480p | 720p (default: 480p per GeminiGen docs)
 * @param {number}   clipDuration  - 6 | 10 | 15 seconds (default: 10)
 *
 * Returns { uuid } immediately (async job).
 */
async function generateFirstClip({
  prompt,
  mode,
  imageUrls = [],
  aspectRatio = 'portrait',
  resolution = '720p',
  clipDuration = 10,
}) {
  // Log full prompt for debugging
  console.log(`[GeminiGen] generateFirstClip →`);
  console.log(`  aspect_ratio: ${aspectRatio} | resolution: ${resolution} | duration: ${clipDuration}s | mode: ${mode}`);
  console.log(`  file_urls: ${imageUrls.length > 0 ? imageUrls.map(u => u.slice(0, 80)).join(', ') : '(none)'}`);
  console.log(`  prompt (${prompt.length} chars): ${prompt.slice(0, 500)}${prompt.length > 500 ? '…' : ''}`);

  const form = new FormData();
  form.append('prompt', prompt);
  form.append('model', 'grok-3');
  form.append('aspect_ratio', aspectRatio);
  form.append('resolution', resolution);
  form.append('duration', clipDuration);          // integer, not string
  if (mode) form.append('mode', mode);
  // Reference images — GeminiGen matches @image1, @image2 etc. in prompt text
  // Use file_urls[] (confirmed param name from docs — NOT image_urls[])
  imageUrls.forEach(url => form.append('file_urls[]', url));

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
 * Per GeminiGen docs: extend only supports prompt + ref_history.
 * No image refs, no resolution/duration overrides on extend.
 *
 * @param {string} prompt   - continuation prompt
 * @param {string} refUuid  - UUID of the clip to extend from
 * Returns { uuid } immediately.
 */
async function extendClip({ prompt, refUuid }) {
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('ref_history', refUuid);

  const { data } = await axios.post(`${BASE_URL}/uapi/v1/video-extend/grok`, form, {
    headers: { ...apiHeaders(), ...form.getHeaders() },
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: 5,
  });

  if (!data.uuid) throw new Error('No UUID returned from GeminiGen extend');
  return { uuid: data.uuid };
}

module.exports = { generateFirstClip, extendClip, pollUntilComplete };
