/**
 * videoUrlAnalyzer.js
 *
 * Download a social media video URL via yt-dlp then analyze with
 * existing analyzeVideoReference + Whisper-1 transcription.
 *
 * Requires: yt-dlp + ffmpeg installed in the container (backend/Dockerfile).
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { analyzeVideoReference, transcribeAudio } = require('./videoAnalyzer');

/**
 * Download video from URL and analyze it.
 * @param {string} url - Instagram/TikTok/YouTube/Facebook URL
 * @returns {Promise<{ analysis, frames, transcript, platform, title }>}
 */
async function analyzeVideoFromUrl(url) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdl_'));
  const tmpFile = path.join(tmpDir, 'source.mp4');

  try {
    // Download: prefer mp4/720p, max 50MB, no playlist
    execSync(
      `yt-dlp --no-playlist ` +
      `--format "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]" ` +
      `--merge-output-format mp4 --max-filesize 50M ` +
      `--output "${tmpFile}" "${url}"`,
      { timeout: 120000, stdio: 'pipe' }
    );

    if (!fs.existsSync(tmpFile) || fs.statSync(tmpFile).size < 10000) {
      throw new Error('Download gagal atau file terlalu kecil (mungkin video private/removed)');
    }

    // Visual analysis + audio transcription in parallel
    const [transcript, { analysis, frames }] = await Promise.all([
      transcribeAudio(tmpFile),
      analyzeVideoReference(tmpFile),
    ]);

    // Enrich analysis with transcript-derived insights (non-blocking)
    if (transcript && transcript.length > 20) {
      analysis.transcript = transcript.slice(0, 1000);
      try {
        const { chatCompletion } = require('./apimart');
        const config = require('../config');
        const enrichRaw = await chatCompletion({
          model: config.models.chat,
          messages: [
            {
              role: 'system',
              content: 'You are a copywriter analyzing ad video scripts. Return only valid JSON, no markdown.',
            },
            {
              role: 'user',
              content: `Analyze this ad video script and extract copywriting insights.

Transcript: "${transcript.slice(0, 600)}"
Visual style: "${analysis.overallStyle || ''}"
Hook type: "${analysis.hookType || ''}"

Return JSON:
{
  "hookWords": "first 8-10 words of the hook",
  "scriptStructure": "how the script flows (e.g. pain→agitate→solution→cta)",
  "toneOfVoice": "casual/formal/urgency/storytelling/educational",
  "keyMessages": ["main claim 1", "main claim 2"]
}`,
            },
          ],
          maxTokens: 300,
        });
        const enrichMatch = enrichRaw.match(/\{[\s\S]*\}/);
        if (enrichMatch) {
          const enrich = JSON.parse(enrichMatch[0]);
          Object.assign(analysis, enrich);
        }
      } catch (e) {
        console.warn('[videoUrlAnalyzer] enrich non-fatal:', e.message);
      }
    }

    return {
      analysis,
      frames,
      transcript: transcript.slice(0, 300) || '',
      platform: detectPlatform(url),
      title: url.slice(-60),
    };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

function detectPlatform(url) {
  if (url.includes('instagram.com')) return 'Instagram';
  if (url.includes('tiktok.com')) return 'TikTok';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'YouTube';
  if (url.includes('facebook.com') || url.includes('fb.watch')) return 'Facebook';
  return 'Video';
}

module.exports = { analyzeVideoFromUrl, detectPlatform };
