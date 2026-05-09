/**
 * videoUrlAnalyzer.js
 *
 * Two analysis modes with live progress callbacks:
 *   'audio' → yt-dlp + Whisper-1 transcript + GPT-4o enrich (fast, cheap)
 *   'full'  → Gemini 2.5 Flash via apimart native (visual + audio in 1 call)
 *
 * YouTube in 'full' mode: URL sent directly (Gemini supports YouTube natively).
 * IG/TikTok/Facebook: yt-dlp download → compress → base64 → Gemini.
 *
 * onProgress(evt) is called at every phase boundary so SSE can stream live status.
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

// ─── helpers ─────────────────────────────────────────────────────────────────

const NOOP = () => {};

function bytesMb(bytes) {
  return (bytes / 1_048_576).toFixed(1);
}

/**
 * Run yt-dlp with a chain of progressively-more-lenient format selectors.
 * Instagram, TikTok, etc don't always expose separate video+audio streams.
 * @returns {string} path to the downloaded file
 */
function ytDlpDownload(url, outFile, { audioOnly = false, onProgress = NOOP } = {}) {
  // Mobile Safari iOS UA — sometimes bypasses IG/TikTok desktop-only checks.
  // English Accept-Language helps server return predictable content.
  const ua = '"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"';
  const headers = '--add-header "Accept-Language:en-US,en;q=0.9"';
  const cookiesFromEnv = process.env.YT_DLP_COOKIES_FILE && require('fs').existsSync(process.env.YT_DLP_COOKIES_FILE)
    ? `--cookies "${process.env.YT_DLP_COOKIES_FILE}"`
    : '';

  const flagsCommon = `--no-playlist --max-filesize 200M --no-warnings --retries 2 --user-agent ${ua} ${headers} ${cookiesFromEnv} --output "${outFile}"`;

  // Format chains — tried in order until one works
  const chains = audioOnly
    ? [
        '"bestaudio/best"',
        '"best"',
      ]
    : [
        '"best[ext=mp4]/best"',
        '"best"',
        '"bestvideo+bestaudio/best"',
      ];

  let lastErr = null;
  for (const chain of chains) {
    try {
      onProgress({
        phase: 'downloading',
        message: `Mencoba download dengan format: ${chain.replace(/"/g, '')}…`,
      });
      const cmd = `yt-dlp ${flagsCommon} ${audioOnly ? '--extract-audio --audio-format mp3' : '--merge-output-format mp4'} --format ${chain} "${url}"`;
      execSync(cmd, { timeout: 120000, stdio: 'pipe' });

      // yt-dlp may produce outFile with different extension when audioOnly — locate it
      if (audioOnly) {
        const dir = path.dirname(outFile);
        const baseName = path.basename(outFile, path.extname(outFile));
        const found = fs.readdirSync(dir).find((f) => f.startsWith(baseName) && /\.(mp3|m4a|webm|opus|aac)$/i.test(f));
        if (found) {
          const foundPath = path.join(dir, found);
          if (fs.statSync(foundPath).size > 5000) {
            onProgress({
              phase: 'downloaded',
              message: `Audio downloaded: ${bytesMb(fs.statSync(foundPath).size)} MB`,
            });
            return foundPath;
          }
        }
      } else if (fs.existsSync(outFile) && fs.statSync(outFile).size > 10000) {
        onProgress({
          phase: 'downloaded',
          message: `Video downloaded: ${bytesMb(fs.statSync(outFile).size)} MB`,
        });
        return outFile;
      }
    } catch (e) {
      lastErr = e;
      const stderr = (e.stderr || e.message || '').toString().slice(0, 300);
      onProgress({ phase: 'download_retry', message: `Format ${chain.replace(/"/g, '')} gagal — coba next...`, detail: stderr });
    }
  }

  // Categorise error for friendly messaging
  const errMsg = lastErr ? (lastErr.stderr || lastErr.message || '').toString() : 'unknown';

  if (errMsg.includes('command not found') || errMsg.includes('ENOENT') || errMsg.includes('not recognized')) {
    throw new Error('yt-dlp tidak terinstall di server (deploy ulang Railway dengan Dockerfile baru)');
  }

  // Instagram-specific: login wall / rate-limit
  if (errMsg.includes('rate-limit reached') || errMsg.includes('login required') || errMsg.includes('Restricted Video') || errMsg.includes('Use --cookies')) {
    throw new Error(
      'Instagram saat ini wajib login untuk download (yt-dlp limitation 2024+). ' +
      'Coba: (1) URL TikTok/YouTube/Facebook (gratis tanpa login), atau (2) Download manual dari Instagram lalu pakai tab "Upload File".'
    );
  }

  // Private/removed video
  if (errMsg.includes('Private video') || errMsg.includes('Video unavailable') || errMsg.includes('removed')) {
    throw new Error('Video private, sudah dihapus, atau region-locked.');
  }

  throw new Error(`Download gagal — coba upload manual. Detail: ${errMsg.slice(0, 200)}`);
}

// ─── Gemini helper ────────────────────────────────────────────────────────────

async function callGemini(parts, onProgress = NOOP) {
  onProgress({ phase: 'gemini_call', message: 'Mengirim ke Gemini 2.5 Flash...' });
  const { data } = await axios.post(
    GEMINI_ENDPOINT,
    { contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 2048 } },
    {
      headers: { Authorization: `Bearer ${config.apimart.apiKey}`, 'Content-Type': 'application/json' },
      timeout: 120000,
    }
  );
  onProgress({ phase: 'gemini_done', message: 'Gemini selesai analisis ✓' });
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function buildGeminiPrompt() {
  return `You are a video creative director analyzing a winning ad for Meta/TikTok advertising.
Watch this video — analyze both the visuals AND audio/speech.

CRITICAL OUTPUT RULES:
- Return ONLY a single valid JSON object — no \`\`\`json code fences, no markdown, no commentary.
- Escape every double-quote inside string values with backslash.
- No literal newlines inside string values; use spaces instead.
- Start your response with { and end with }.

Schema:
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

// Robust JSON extractor — handles Gemini wrapping in ```json ... ``` markdown,
// trailing commas, unescaped newlines in strings. Falls back to per-field regex
// extraction so we always recover SOMETHING usable.
function extractBalancedJson(text) {
  // Strip markdown code fences first
  let s = text;
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) s = fenceMatch[1];

  // Find balanced { ... } via depth counter
  const startIdx = s.indexOf('{');
  if (startIdx === -1) return null;
  let depth = 0;
  let endIdx = -1;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { endIdx = i; break; }
    }
  }
  if (endIdx === -1) return null;
  return s.slice(startIdx, endIdx + 1);
}

function regexExtractField(json, key) {
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  const m = json.match(re);
  if (!m) return '';
  return m[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\\\\/g, '\\').trim();
}

function regexExtractArray(json, key) {
  const re = new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]*)\\]`);
  const m = json.match(re);
  if (!m) return [];
  // Pull strings out of the array body
  const items = [];
  const itemRe = /"((?:[^"\\]|\\.)*)"/g;
  let mm;
  while ((mm = itemRe.exec(m[1])) !== null) items.push(mm[1].replace(/\\"/g, '"'));
  return items;
}

function parseGeminiResponse(raw) {
  const jsonStr = extractBalancedJson(raw);
  if (jsonStr) {
    // 1. Strict parse
    try {
      const parsed = JSON.parse(jsonStr);
      const { transcript = '', ...analysis } = parsed;
      return { analysis, transcript };
    } catch (e1) {
      // 2. Repair common issues: trailing commas, smart quotes, unescaped newlines in strings
      const repaired = jsonStr
        .replace(/,(\s*[}\]])/g, '$1')         // trailing commas
        .replace(/[“”]/g, '"')       // smart quotes → straight
        .replace(/[‘’]/g, "'")
        .replace(/(:\s*"[^"]*?)\n([^"]*?")/g, '$1 $2'); // newlines inside strings
      try {
        const parsed = JSON.parse(repaired);
        const { transcript = '', ...analysis } = parsed;
        console.info('[Gemini] JSON parsed via repaired pass');
        return { analysis, transcript };
      } catch (e2) {
        // 3. Last resort: regex-extract every field individually
        console.warn('[Gemini] JSON parse failed, using regex fallback:', e2.message);
        const transcript = regexExtractField(jsonStr, 'transcript');
        return {
          analysis: {
            hookWords: regexExtractField(jsonStr, 'hookWords'),
            overallStyle: regexExtractField(jsonStr, 'overallStyle') || 'Visual analysis (parser fallback)',
            pacing: regexExtractField(jsonStr, 'pacing') || 'varied',
            hookType: regexExtractField(jsonStr, 'hookType') || 'visual hook',
            colorPalette: regexExtractArray(jsonStr, 'colorPalette'),
            cameraMovement: regexExtractField(jsonStr, 'cameraMovement') || 'mixed',
            emotionArc: regexExtractField(jsonStr, 'emotionArc') || 'engagement → desire → action',
            musicVibe: regexExtractField(jsonStr, 'musicVibe') || 'uplifting',
            scriptStructure: regexExtractField(jsonStr, 'scriptStructure') || 'inferred',
            toneOfVoice: regexExtractField(jsonStr, 'toneOfVoice') || 'unknown',
            keyMessages: regexExtractArray(jsonStr, 'keyMessages'),
            scenes: [],
            recommendedDuration: 30,
          },
          transcript,
        };
      }
    }
  }
  // No JSON object found at all
  console.warn('[Gemini] No JSON object found in response');
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

async function analyzeYouTubeUrl(url, onProgress) {
  onProgress({ phase: 'youtube_native', message: 'YouTube URL — mengirim ke Gemini langsung tanpa download...' });
  return parseGeminiResponse(
    await callGemini(
      [{ fileData: { fileUri: url } }, { text: buildGeminiPrompt() }],
      onProgress
    )
  );
}

async function analyzeDownloadedVideoFull(url, onProgress) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdl_'));
  const rawFile = path.join(tmpDir, 'source.mp4');
  const compressedFile = path.join(tmpDir, 'compressed.mp4');
  try {
    onProgress({ phase: 'tmp_dir', message: `Tmp dir: ${tmpDir}` });

    const downloadedPath = ytDlpDownload(url, rawFile, { onProgress });

    // Compress to keep base64 payload < ~10MB so Gemini accepts it fast
    onProgress({ phase: 'compressing', message: 'Compressing dengan ffmpeg (854px, 500kbps)...' });
    try {
      execSync(
        `ffmpeg -i "${downloadedPath}" -vf "scale=854:-2" -c:v libx264 -b:v 500k -c:a aac -b:a 64k "${compressedFile}" -y`,
        { timeout: 60000, stdio: 'pipe' }
      );
    } catch (compErr) {
      onProgress({ phase: 'compress_skip', message: 'Compression skipped — pakai raw file', detail: compErr.message?.slice(0, 100) });
    }

    const finalFile =
      fs.existsSync(compressedFile) && fs.statSync(compressedFile).size > 10000
        ? compressedFile
        : downloadedPath;
    const sizeMb = bytesMb(fs.statSync(finalFile).size);
    onProgress({ phase: 'encoding', message: `Encoding ${sizeMb}MB ke base64...` });
    const videoBase64 = fs.readFileSync(finalFile).toString('base64');

    return parseGeminiResponse(
      await callGemini(
        [
          { inlineData: { mimeType: 'video/mp4', data: videoBase64 } },
          { text: buildGeminiPrompt() },
        ],
        onProgress
      )
    );
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    onProgress({ phase: 'cleanup', message: 'Tmp files cleaned up ✓' });
  }
}

// ─── AUDIO ONLY MODE: yt-dlp + Whisper + GPT-4o text enrich ──────────────────

async function analyzeAudioOnly(url, onProgress) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdl_'));
  const rawFile = path.join(tmpDir, 'source.mp4');
  try {
    onProgress({ phase: 'tmp_dir', message: `Tmp dir: ${tmpDir}` });

    const audioPath = ytDlpDownload(url, rawFile, { audioOnly: true, onProgress });

    onProgress({ phase: 'transcribing', message: 'Mengirim audio ke Whisper-1...' });
    const { transcribeAudio } = require('./videoAnalyzer');
    const transcript = await transcribeAudio(audioPath);

    if (!transcript) {
      onProgress({ phase: 'transcript_empty', message: '⚠️ Whisper return empty — mungkin video tanpa speech' });
    } else {
      onProgress({ phase: 'transcribed', message: `Transcript: ${transcript.length} karakter` });
    }

    onProgress({ phase: 'enriching', message: 'Inferring creative strategy via GPT-4o...' });
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
    onProgress({ phase: 'enriched', message: 'Strategy inference ✓' });
    const m = enrichRaw.match(/\{[\s\S]*\}/);
    const analysis = m ? JSON.parse(m[0]) : { overallStyle: 'Audio analysis only', scenes: [], colorPalette: [] };
    return { analysis, transcript: transcript.slice(0, 1000) };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    onProgress({ phase: 'cleanup', message: 'Tmp files cleaned up ✓' });
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @param {string} url
 * @param {'audio'|'full'} mode
 * @param {function} onProgress  (evt: { phase, message, detail? }) => void
 */
async function analyzeVideoFromUrl(url, mode = 'full', onProgress = NOOP) {
  const platform = detectPlatform(url);
  onProgress({ phase: 'detected', message: `Platform terdeteksi: ${platform}` });

  let result;
  if (mode === 'audio') {
    onProgress({ phase: 'mode', message: '🎙 Audio Only mode (yt-dlp + Whisper-1 + GPT-4o)' });
    result = await analyzeAudioOnly(url, onProgress);
  } else if (platform === 'YouTube') {
    onProgress({ phase: 'mode', message: '🎬 Visual+Audio mode (Gemini 2.5 Flash native YouTube)' });
    result = await analyzeYouTubeUrl(url, onProgress);
  } else {
    onProgress({ phase: 'mode', message: '🎬 Visual+Audio mode (yt-dlp + Gemini 2.5 Flash)' });
    result = await analyzeDownloadedVideoFull(url, onProgress);
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
