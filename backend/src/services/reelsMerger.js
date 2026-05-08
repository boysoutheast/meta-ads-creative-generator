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

/**
 * FFmpeg concat all clips → merged.mp4
 * Returns outputPath
 */
async function mergeClips(sessionId, clipCount, onProgress) {
  ensureDir(sessionId);
  const output = mergedPath(sessionId);

  // Build concat file for FFmpeg
  const concatFile = path.join(sessionDir(sessionId), 'concat.txt');
  const lines = [];
  for (let i = 0; i < clipCount; i++) {
    lines.push(`file '${clipPath(sessionId, i)}'`);
  }
  fs.writeFileSync(concatFile, lines.join('\n'), 'utf8');

  onProgress && onProgress({ phase: 'merging', progress: 0 });

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
        // Clean up concat file
        try { fs.unlinkSync(concatFile); } catch (e) {}
        resolve(output);
      })
      .on('error', (err) => {
        reject(new Error(`FFmpeg merge failed: ${err.message}`));
      })
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

module.exports = {
  downloadClips,
  verifyClips,
  mergeClips,
  verifyMerged,
  cleanupClips,
  cleanupAll,
  getMergedPath,
};
