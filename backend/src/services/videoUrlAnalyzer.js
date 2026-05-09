/**
 * videoUrlAnalyzer.js
 *
 * Two analysis modes:
 *   'audio' → yt-dlp + Whisper-1 transcript + GPT-4o enrich (fast, cheap)
 *   'full'  → Gemini 2.5 Flash via apimart native (visual + audio in 1 call)
 *
 * YouTube in 'full' mode: URL sent directly (Gemini supports YouTube natively).
 * IG/TikTok/Facebook: yt-dlp download → compress → base64 → Gemini.
 *
 * Requires: yt-dlp + ffmpeg installed in container.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const config = require('../config');

const GEMINI_ENDPOINT =
  'https://api.apimart.ai/v1beta/models/gemini-2.5-flash:generateContent';

// ─── Gemini helper ────────────────────────────────────────────────────────────

async function callGemini(parts) {
  const { data } = await axios.post(
    GEMINI_ENDPOINT,
    { contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 2048 } },
    {
      headers: { Authorization: `Bearer ${config.apimart.apiKey}`, 'Content-Type': 'application/json' },
      timeout: 120000,
    }
  );
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function buildGeminiPrompt() {
  return `You are a video creative director analyzing a winning ad for Meta/TikTok advertising.
Watch this video — analyze both the visuals AND audio/speech.
Return ONLY valid JSON (no markdown, no backticks):
{
  "transcript": "full spoken words, empty string if no speech",
  "hookWords": "first 8-10 spoken words or on-screen hook text",
  "scenes": [
    { "sceneNumber": 1, "duration": "0-3s", "description": "...", "hook": true, "visualElements": ["..."], "emotion": "..." }
  ],
  "overallStyle": "...",
  "pacing": "fast/medium/slow — description",
  "hookType": "how attention grabbed in first 3 seconds",
  "colorPalette": ["color1", "color2", "color3"],
  "cameraMovement": "...",
  "emotionArc": "pain → hope → solution → relief  (adapt to actual)",
  "recommendedDuration": 30,
  "musicVibe": "...",
  "scriptStructure": "pain→agitate→solution→cta  (adapt to actual)",
  "toneOfVoice": "casual/formal/urgency/storytelling/educational",
  "keyMessages": ["claim 1", "claim 2"]
}`;
}

function parseGeminiResponse(raw) {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      const { transcript = '', ...analysis } = parsed;
      return { analysis, transcript };
    }
  } catch (e) {
    console.warn('[videoUrlAnalyzer] Gemini JSON parse failed:', e.message);
  }
  return {
    analysis: {
      scenes: [], overallStyle: raw.slice(0, 200) || 'Analysis unavailable',
      pacing: 'varied', hookType: 'visual hook', colorPalette: [],
      cameraMovement: 'mixed', emotionArc: 'engagement → desire → action',
      recommendedDuration: 30, musicVibe: 'uplifting',
      scriptStructure: 'unknown', toneOfVoice: 'unknown', keyMessages: [],
    },
    transcript: '',
  };
}

// ─── FULL MODE: Gemini 2.5 Flash ─────────────────────────────────────────────

async function analyzeYouTubeUrl(url) {
  // Gemini supports YouTube URLs natively — no download needed
  return parseGeminiResponse(
    await callGemini([{ fileData: { fileUri: url } }, { text: buildGeminiPrompt() }])
  );
}

async function analyzeDownloadedVideoFull(url) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdl_'));
  const rawFile = path.join(tmpDir, 'source.mp4');
  const compressedFile = path.join(tmpDir, 'compressed.mp4');
  try {
    execSync(
      `yt-dlp --no-playlist --format "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]" --merge-output-format mp4 --max-filesize 50M --output "${rawFile}" "${url}"`,
      { timeout: 120000, stdio: 'pipe' }
    );
    if (!fs.existsSync(rawFile) || fs.statSync(rawFile).size < 10000) {
      throw new Error('Download gagal atau video private/removed');
    }
    try {
      execSync(
        `ffmpeg -i "${rawFile}" -vf "scale=854:-2" -c:v libx264 -b:v 500k -c:a aac -b:a 64k "${compressedFile}" -y`,
        { timeout: 60000, stdio: 'pipe' }
      );
    } catch { /* fall back to raw */ }
    const videoFile =
      fs.existsSync(compressedFile) && fs.statSync(compressedFile).size > 10000
        ? compressedFile : rawFile;
    const videoBase64 = fs.readFileSync(videoFile).toString('base64');
    return parseGeminiResponse(
      await callGemini([
        { inlineData: { mimeType: 'video/mp4', data: videoBase64 } },
        { text: buildGeminiPrompt() },
      ])
    );
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ─── AUDIO ONLY MODE: yt-dlp + Whisper + GPT-4o text enrich ──────────────────

async function analyzeAudioOnly(url) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdl_'));
  const rawFile = path.join(tmpDir, 'source.mp4');
  try {
    execSync(
      `yt-dlp --no-playlist --format "bestaudio[ext=m4a]/bestaudio/best" --extract-audio --audio-format mp3 --output "${rawFile}" "${url}"`,
      { timeout: 120000, stdio: 'pipe' }
    );
    // Find downloaded file (yt-dlp may output .mp3 even with .mp4 template)
    const files = fs.readdirSync(tmpDir);
    const audioFile = files.find((f) => f.match(/\.(mp3|m4a|webm|opus)$/i));
    if (!audioFile) throw new Error('Audio download gagal');
    const audioPath = path.join(tmpDir, audioFile);

    const { transcribeAudio } = require('./videoAnalyzer');
    const transcript = await transcribeAudio(audioPath);

    // Build analysis from transcript via GPT-4o
    const { chatCompletion } = require('./apimart');
    const enrichRaw = await chatCompletion({
      model: config.models.chat,
      messages: [
        { role: 'system', content: 'You are a copywriter analyzing ad video scripts. Return only valid JSON, no markdown.' },
        {
          role: 'user',
          content: `Analyze this ad video transcript and infer the creative strategy.

Transcript: "${transcript.slice(0, 800)}"

Return ONLY valid JSON:
{
  "hookWords": "first 8-10 words of the hook",
  "scriptStructure": "how script flows (pain→agitate→solution→cta, adapt to actual)",
  "toneOfVoice": "casual/formal/urgency/storytelling/educational",
  "keyMessages": ["main claim 1", "main claim 2"],
  "emotionArc": "inferred emotion arc",
  "hookType": "how it grabs attention in first 3 seconds",
  "overallStyle": "inferred from script tone (cannot confirm visually)",
  "pacing": "inferred from script length and rhythm",
  "colorPalette": [],
  "cameraMovement": "unknown (audio-only mode)",
  "scenes": [],
  "recommendedDuration": 30,
  "musicVibe": "inferred from tone"
}`,
        },
      ],
      maxTokens: 600,
    });
    const m = enrichRaw.match(/\{[\s\S]*\}/);
    const analysis = m ? JSON.parse(m[0]) : { overallStyle: 'Audio analysis only', scenes: [], colorPalette: [] };
    return { analysis, transcript: transcript.slice(0, 1000) };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @param {string} url
 * @param {'audio'|'full'} mode  default: 'full'
 */
async function analyzeVideoFromUrl(url, mode = 'full') {
  const platform = detectPlatform(url);

  let result;
  if (mode === 'audio') {
    result = await analyzeAudioOnly(url);
  } else if (platform === 'YouTube') {
    result = await analyzeYouTubeUrl(url);
  } else {
    result = await analyzeDownloadedVideoFull(url);
  }

  return {
    analysis: result.analysis,
    frames: result.analysis.scenes?.length || 0,
    transcript: (result.transcript || '').slice(0, 500),
    platform,
    mode,
    title: url.slice(-60),
  };
}

function detectPlatform(url) {
  if (url.includes('instagram.com')) return 'Instagram';
  if (url.includes('tiktok.com')) return 'TikTok';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'YouTube';
  if (url.includes('facebook.com') || url.includes('fb.watch')) return 'Facebook';
  return 'Video';
}

module.exports = { analyzeVideoFromUrl, detectPlatform };
