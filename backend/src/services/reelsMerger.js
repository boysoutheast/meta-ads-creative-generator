/**
 * reelsMerger.js
 *
 * Downloads GeminiGen clip videos to /tmp, verifies SHA256 integrity,
 * merges them with FFmpeg, then provides cleanup.
 *
 * Workflow:
 *   1. downloadClips()   — download all videoUrls → /tmp/reels/{sessionId}/clip-N.mp4
 *   2. verifyClips()     — SHA256 each file, ensure non-zero size
 *   3. mergeClips()      — FFmpeg concat → merged.mp4
 *   4. verifyMerged()    — size check + SHA256
 *   5. cleanupClips()    — delete clip-N.mp4 files (keep merged until downloaded)
 *   6. cleanupAll()      — delete everything including merged.mp4
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegPath);

const TMP_BASE = path.join('/tmp', 'reels');

// ── helpers ───────────────────────────────────────────────────────────────────

function sessionDir(sessionId) {
  return path.join(TMP_BASE, sessionId);
}

function clipPath(sessionId, index) {
  return path.join(sessionDir(sessionId), `clip-${index}.mp4`);
}

function mergedPath(sessionId) {
  return path.join(sessionDir(sessionId), 'merged.mp4');
}

function ensureDir(sessionId) {
  const dir = sessionDir(sessionId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function downloadFile(url, destPath, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, {
        responseType: 'stream',
        timeout: 120_000,
        maxRedirects: 10,   // GeminiGen CDN may redirect
        headers: { 'User-Agent': 'ReelsMerger/1.0' },
      });

      await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(destPath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
      });

      // Verify file has content
      const stat = fs.statSync(destPath);
      if (stat.size < 1000) throw new Error(`Downloaded file too small (${stat.size} bytes)`);

      return;
    } catch (err) {
      if (attempt === retries) throw new Error(`Download failed after ${retries} attempts: ${err.message}`);
      console.warn(`[Merger] Download attempt ${attempt} failed, retrying...`, err.message);
      await sleep(2000 * attempt);
    }
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Download all clips from their CDN URLs.
 * Returns array of { index, localPath, url }
 */
async function downloadClips(sessionId, clips, onProgress) {
  ensureDir(sessionId);
  const results = [];

  for (let i = 0; i < clips.length; i++) {
    const { videoUrl } = clips[i];
    if (!videoUrl) throw new Error(`Clip ${i} has no videoUrl`);

    const dest = clipPath(sessionId, i);
    onProgress && onProgress({ phase: 'downloading', clipIndex: i, total: clips.length });

    await downloadFile(videoUrl, dest);
    results.push({ index: i, localPath: dest, url: videoUrl });
  }

  return results;
}

/**
 * SHA256 verify each downloaded clip.
 * Returns array of { index, localPath, sha256, sizeBytes }
 */
async function verifyClips(sessionId, clipCount) {
  const verified = [];
  for (let i = 0; i < clipCount; i++) {
    const fp = clipPath(sessionId, i);
    if (!fs.existsSync(fp)) throw new Error(`Clip ${i} file not found: ${fp}`);
    const stat = fs.statSync(fp);
    if (stat.size < 1000) throw new Error(`Clip ${i} file too small (${stat.size} bytes) — corrupt?`);
    const hash = await sha256File(fp);
    verified.push({ index: i, localPath: fp, sha256: hash, sizeBytes: stat.size });
  }
  return verified;
}

// Feature 9: resolution scale map
const SCALE_MAP = { '720p': '1280:720', '1080p': '1920:1080', '4k': '3840:2160' };

// Feature 13: transition filters supported via xfade
const VALID_TRANSITIONS = ['cut', 'fade', 'dissolve', 'wipeleft', 'zoom'];

/**
 * Mix per-clip TTS audio onto each clip BEFORE merging.
 * Returns array of dubbed clip paths in the requested order (defaults to natural order).
 *
 * @param {string} sessionId
 * @param {number} clipCount
 * @param {Array<string|null>} ttsAudioPaths — aligned to ORIGINAL clip indices
 * @param {number[]} [clipOrder] — optional rendering order (original indices); defaults [0..clipCount-1]
 */
async function dubClipsWithTTS(sessionId, clipCount, ttsAudioPaths, clipOrder) {
  const order = Array.isArray(clipOrder) && clipOrder.length === clipCount
    ? clipOrder
    : Array.from({ length: clipCount }, (_, i) => i);

  if (!Array.isArray(ttsAudioPaths)) return order.map((i) => clipPath(sessionId, i));

  const dubbedPaths = [];
  for (const i of order) {
    const original = clipPath(sessionId, i);
    const tts = ttsAudioPaths[i];
    if (!tts || !fs.existsSync(tts)) {
      dubbedPaths.push(original);
      continue;
    }
    const dubbed = path.join(sessionDir(sessionId), `clip-${i}-dubbed.mp4`);
    if (!fs.existsSync(dubbed)) {
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(original)
          .input(tts)
          .outputOptions([
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-shortest',
          ])
          .output(dubbed)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
    }
    dubbedPaths.push(dubbed);
  }
  return dubbedPaths;
}

/**
 * FFmpeg concat or xfade all clips → merged.mp4
 *
 * @param {string} sessionId
 * @param {number} clipCount
 * @param {function} onProgress
 * @param {object} options
 * @param {string} options.exportResolution — '720p' | '1080p' | '4k'
 * @param {object} options.transitions — { [afterClipIndex: number]: 'fade'|'dissolve'|... }
 * @param {Array<string|null>} options.ttsAudioPaths — per-clip TTS mp3 paths
 * @param {number} options.clipDuration — seconds per clip (needed for xfade offset calc)
 */
async function mergeClips(sessionId, clipCount, onProgress, options = {}) {
  ensureDir(sessionId);
  const output = mergedPath(sessionId);
  const exportResolution = options.exportResolution || '720p';
  const transitions = options.transitions || {};
  const ttsAudioPaths = options.ttsAudioPaths || null;
  const clipDuration = Number(options.clipDuration) || 10;
  // Feature A: optional custom clip order (Timeline Editor)
  const clipOrder = Array.isArray(options.clipOrder) && options.clipOrder.length === clipCount
    ? options.clipOrder
    : Array.from({ length: clipCount }, (_, i) => i);

  // Step A: dub clips with TTS first if requested (writes clip-N-dubbed.mp4)
  let inputPaths;
  if (ttsAudioPaths && ttsAudioPaths.some((p) => p)) {
    onProgress && onProgress({ phase: 'merging', progress: 5 });
    inputPaths = await dubClipsWithTTS(sessionId, clipCount, ttsAudioPaths, clipOrder);
  } else {
    inputPaths = clipOrder.map((i) => clipPath(sessionId, i));
  }

  // Decide path: any non-cut transition + non-default resolution requires re-encode.
  const hasTransitions = Object.values(transitions).some((t) => t && t !== 'cut' && VALID_TRANSITIONS.includes(t));
  const hasUpscale = exportResolution !== '720p';
  const hasDub = !!(ttsAudioPaths && ttsAudioPaths.some((p) => p));
  const needsReencode = hasTransitions || hasUpscale || hasDub;

  onProgress && onProgress({ phase: 'merging', progress: 10 });

  if (!needsReencode) {
    // Fast path: concat demuxer with stream copy (current behavior)
    const concatFile = path.join(sessionDir(sessionId), 'concat.txt');
    const lines = inputPaths.map((p) => `file '${p}'`);
    fs.writeFileSync(concatFile, lines.join('\n'), 'utf8');

    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatFile)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy'])
        .output(output)
        .on('progress', (info) => {
          onProgress && onProgress({ phase: 'merging', progress: info.percent || 0 });
        })
        .on('end', () => {
          try { fs.unlinkSync(concatFile); } catch (e) {}
          resolve(output);
        })
        .on('error', (err) => reject(new Error(`FFmpeg merge failed: ${err.message}`)))
        .run();
    });
  }

  // Slow path: filter_complex with xfade transitions and/or scale upscale.
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();
    inputPaths.forEach((p) => cmd.input(p));

    const scaleFilter = SCALE_MAP[exportResolution] || SCALE_MAP['720p'];
    const filters = [];

    // Pre-scale every input to target resolution to keep xfade dimensions compatible.
    for (let i = 0; i < clipCount; i++) {
      filters.push(`[${i}:v]scale=${scaleFilter}:force_original_aspect_ratio=decrease,pad=${scaleFilter}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`);
    }

    // Build xfade chain or concat
    let lastVideo = 'v0';
    let cumulativeOffset = clipDuration;
    if (hasTransitions && clipCount > 1) {
      for (let i = 1; i < clipCount; i++) {
        const tType = transitions[i - 1] && transitions[i - 1] !== 'cut' ? transitions[i - 1] : null;
        const outLabel = i === clipCount - 1 ? 'vout' : `vx${i}`;
        if (tType && VALID_TRANSITIONS.includes(tType) && tType !== 'cut') {
          // xfade — overlap the last 0.5s of prev clip with start of next
          const offset = Math.max(0.1, cumulativeOffset - 0.5);
          filters.push(`[${lastVideo}][v${i}]xfade=transition=${tType}:duration=0.5:offset=${offset}[${outLabel}]`);
          cumulativeOffset = cumulativeOffset - 0.5 + clipDuration;
        } else {
          filters.push(`[${lastVideo}][v${i}]concat=n=2:v=1:a=0[${outLabel}]`);
          cumulativeOffset += clipDuration;
        }
        lastVideo = outLabel;
      }
    } else {
      // Pure concat with optional scale only
      const concatInputs = Array.from({ length: clipCount }, (_, i) => `[v${i}]`).join('');
      filters.push(`${concatInputs}concat=n=${clipCount}:v=1:a=0[vout]`);
      lastVideo = 'vout';
    }

    // Audio handling — keep silent unless TTS dub provided
    const audioInputs = Array.from({ length: clipCount }, (_, i) => `[${i}:a]`).join('');
    let mapAudio = false;
    if (hasDub) {
      filters.push(`${audioInputs}concat=n=${clipCount}:v=0:a=1[aout]`);
      mapAudio = true;
    }

    cmd
      .complexFilter(filters)
      .outputOptions([
        '-map', `[${lastVideo}]`,
        ...(mapAudio ? ['-map', '[aout]'] : []),
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        ...(mapAudio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']),
      ])
      .output(output)
      .on('progress', (info) => {
        onProgress && onProgress({ phase: 'merging', progress: info.percent || 0 });
      })
      .on('end', () => resolve(output))
      .on('error', (err) => reject(new Error(`FFmpeg merge (re-encode) failed: ${err.message}`)))
      .run();
  });
}

/**
 * Verify merged output file.
 * Returns { path, sha256, sizeBytes }
 */
async function verifyMerged(sessionId) {
  const fp = mergedPath(sessionId);
  if (!fs.existsSync(fp)) throw new Error('Merged file not found after FFmpeg');
  const stat = fs.statSync(fp);
  if (stat.size < 1000) throw new Error(`Merged file too small (${stat.size} bytes) — FFmpeg failed?`);
  const hash = await sha256File(fp);
  return { path: fp, sha256: hash, sizeBytes: stat.size };
}

/**
 * Delete individual clip files (keep merged.mp4).
 * Called AFTER user downloads the merged file.
 */
function cleanupClips(sessionId, clipCount) {
  for (let i = 0; i < clipCount; i++) {
    const fp = clipPath(sessionId, i);
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) {}
  }
  const concatFile = path.join(sessionDir(sessionId), 'concat.txt');
  try { if (fs.existsSync(concatFile)) fs.unlinkSync(concatFile); } catch (e) {}
}

/**
 * Delete everything — clips + merged file + session dir.
 * Called after download confirmed.
 */
function cleanupAll(sessionId) {
  const dir = sessionDir(sessionId);
  try {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      files.forEach(f => {
        try { fs.unlinkSync(path.join(dir, f)); } catch (e) {}
      });
      fs.rmdirSync(dir);
    }
  } catch (e) {
    console.warn(`[Merger] cleanupAll failed for ${sessionId}:`, e.message);
  }
}

/**
 * Get the merged file path (for streaming download)
 */
function getMergedPath(sessionId) {
  return mergedPath(sessionId);
}

/**
 * Scan /tmp/reels/ and delete any merged.mp4 whose mtime > 48h.
 * Called on server startup and every 6h to recover from crashes/restarts.
 */
const MERGED_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

function sweepExpiredMerged() {
  try {
    if (!fs.existsSync(TMP_BASE)) return;
    const entries = fs.readdirSync(TMP_BASE);
    let cleaned = 0;

    for (const sessionId of entries) {
      const dir = path.join(TMP_BASE, sessionId);
      try { if (!fs.statSync(dir).isDirectory()) continue; } catch { continue; }

      const merged = path.join(dir, 'merged.mp4');

      if (!fs.existsSync(merged)) {
        // Orphan dir with no merged file — remove it
        try { fs.rmdirSync(dir); } catch {}
        continue;
      }

      const ageMs = Date.now() - fs.statSync(merged).mtimeMs;
      if (ageMs > MERGED_TTL_MS) {
        cleanupAll(sessionId);
        cleaned++;
        console.info(`[Merger] sweep — deleted ${sessionId} (age ${Math.round(ageMs / 3_600_000)}h)`);
      }
    }

    if (cleaned) console.info(`[Merger] sweepExpiredMerged — cleaned ${cleaned} session(s)`);
  } catch (e) {
    console.warn('[Merger] sweepExpiredMerged failed:', e.message);
  }
}

module.exports = {
  downloadClips,
  verifyClips,
  mergeClips,
  verifyMerged,
  cleanupClips,
  cleanupAll,
  getMergedPath,
  sweepExpiredMerged,
};
