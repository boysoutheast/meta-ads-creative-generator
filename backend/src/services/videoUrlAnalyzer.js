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
    {
      contents: [{ role: 'user', parts }],
      // 16384 tokens — rich NotebookLM-style schema needs space for per-scene detail
      generationConfig: {
        maxOutputTokens: 16384,
        temperature: 0.35,
        responseMimeType: 'application/json',
      },
    },
    {
      headers: { Authorization: `Bearer ${config.apimart.apiKey}`, 'Content-Type': 'application/json' },
      timeout: 120000,
    }
  );
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const finishReason = data?.candidates?.[0]?.finishReason || 'unknown';
  onProgress({
    phase: 'gemini_done',
    message: `Gemini selesai (${text.length} chars, finish=${finishReason}) ✓`,
    detail: text.slice(0, 120),
  });
  return text;
}

function buildGeminiPrompt() {
  return `You are a senior creative director and prompt engineer analyzing a winning ad video for Meta/TikTok scaling. Your output is consumed by another AI to RECREATE this ad's creative DNA for a new product, so be SPECIFIC, EXHAUSTIVE, and TECHNICAL.

Watch the entire video — analyze visuals, audio/speech, music, sound effects, on-screen text, transitions, and brand moments. Be extremely thorough — like a NotebookLM source-grounded analysis with second-by-second detail.

CRITICAL OUTPUT RULES:
- Return ONLY a single valid JSON object — no \`\`\`json fences, no markdown, no prose outside the JSON.
- Escape every double-quote inside string values with backslash.
- No literal newlines inside string values — use " · " or commas instead.
- Start your response with { and end with }.
- Be VERY DETAILED. Long descriptions are encouraged (this analysis will drive recreation).

Schema (fill EVERY field thoroughly):
{
  "transcript": "FULL verbatim spoken words (every line, in order)",
  "transcriptByScene": [
    { "sceneNumber": 1, "spokenLines": "exact dialogue/VO for this scene" }
  ],

  "hookBreakdown": {
    "first3Seconds": "second-by-second description of the opening 0-3s — what viewer sees, hears, feels",
    "hookWords": "first 8-12 spoken or on-screen words that grab attention",
    "hookMechanism": "how attention is hijacked (e.g. 'pattern-break visual + confrontational dialogue + dramatic close-up')",
    "viewerReaction": "what emotion/action this hook is designed to trigger in the viewer",
    "scrollStopPower": "what specifically makes a scrolling user STOP — be concrete"
  },

  "scenes": [
    {
      "sceneNumber": 1,
      "duration": "0-3s",
      "title": "short scene label",
      "setting": "location + time-of-day + environment + key props (be specific)",
      "characters": [
        { "role": "main character", "appearance": "age, gender, race, outfit, distinctive features", "personality": "energy and demeanor" }
      ],
      "action": "second-by-second description of what happens visually — every movement, gesture, reaction, prop interaction",
      "dialogue": "exact spoken words in this scene",
      "textOverlay": "any on-screen text (caption, subtitle, callout, kinetic type) — verbatim",
      "cameraShot": "shot type (close-up, wide, dutch angle, etc) + framing + subject placement",
      "cameraMovement": "static/pan/tilt/zoom/handheld/dolly/whip-pan etc — be specific",
      "lighting": "key light direction, color temperature, contrast, shadows, mood (e.g. 'hard top-light, cold 5500K, harsh shadows for clinical look')",
      "colorGrading": "saturation, contrast, dominant colors, look (e.g. 'high saturation, crushed blacks, teal-orange grade')",
      "soundEffects": ["specific sfx heard in this scene — be concrete: 'whoosh', 'glass shatter', 'wet splash'"],
      "musicCue": "music presence + style (e.g. 'driving 8-bit synth, 140 BPM' or 'silent — only foley')",
      "transition": "how this scene moves to the next (cut, dissolve, match-cut, whip-pan, jump-cut, etc)",
      "visualEffects": ["any post effects: motion graphics, kinetic type, glow, particle, color flash, etc"],
      "purpose": "narrative role of this scene (hook, problem setup, agitation, demo, proof, CTA, etc)",
      "emotion": "specific emotion this scene targets — be precise (anger, longing, relief, urgency, awe, etc)"
    }
  ],

  "overallStyle": "detailed paragraph describing visual aesthetic, art direction, animation style or live-action treatment, brand identity feel, era/genre influences",

  "pacing": {
    "speed": "fast / medium / slow",
    "rhythm": "describe the editing rhythm (e.g. 'rapid 0.5-1s cuts in act 1, slows to 2s shots in act 2')",
    "averageShotLength": "X seconds",
    "totalScenes": 0,
    "energyArc": "how energy rises/falls across the video"
  },

  "colorPalette": {
    "primary": "dominant color across the video",
    "secondary": ["supporting color 1", "supporting color 2"],
    "accents": ["highlight color 1", "highlight color 2"],
    "moodAssociation": "what the palette communicates (e.g. 'warm-friendly + clinical-trustworthy')"
  },

  "cameraMovement": "detailed paragraph on shot composition, motion language, framing strategy across the whole video",

  "emotionArc": {
    "phases": ["emotion 1", "emotion 2", "emotion 3", "emotion 4"],
    "peak": "scene number where emotional peak occurs + why",
    "resolution": "how viewer is left feeling at the end"
  },

  "audioDesign": {
    "voiceover": {
      "presence": true,
      "voiceCharacter": "tone, pace, accent, gender, age, energy",
      "deliveryStyle": "shouting, whispering, conversational, theatrical, etc"
    },
    "music": {
      "genre": "specific genre",
      "instruments": ["instr 1", "instr 2"],
      "tempoBpm": 0,
      "mood": "uplifting, dramatic, urgent, etc"
    },
    "soundEffects": ["distinctive sfx that recur across the video"],
    "audioPacingMatchesVisual": "yes/no — describe how"
  },

  "scriptStructure": {
    "framework": "PAS / AIDA / problem-solution / before-after / testimonial / etc",
    "hookLine": "the exact opening line",
    "agitationPoints": ["pain point 1 amplified", "pain point 2"],
    "solutionReveal": "how the product is introduced as solution — exact moment",
    "ctaLine": "exact closing CTA",
    "structureBreakdown": "act-by-act breakdown of how the script flows"
  },

  "toneOfVoice": "casual / formal / urgent / storytelling / educational + specific energy descriptor",

  "keyMessages": [
    { "message": "core claim verbatim", "deliveryMethod": "verbal | visual | text-overlay | combination", "sceneRef": 1 }
  ],

  "visualMotifs": ["recurring visual elements: characters, objects, colors, framings that repeat throughout"],

  "brandingMoments": [
    { "timestamp": "12s", "type": "logo / product / text-callout", "description": "what brand element + how presented" }
  ],

  "productPlacement": {
    "frequency": "how many seconds product is on-screen / what % of video",
    "placement": "how product is framed (centered hero, integrated lifestyle, before-after demo, etc)",
    "transformation": "how product is positioned as the solution narratively"
  },

  "ctaStrategy": {
    "type": "soft / hard / multi",
    "placement": "early / middle / late / repeated",
    "wording": "exact CTA verbatim",
    "visualCue": "what visual reinforces the CTA (button graphic, arrow, kinetic text, etc)"
  },

  "targetAudience": "inferred demographic + psychographic + pain points + desires",

  "uniqueSellingProps": ["what specifically makes THIS ad creative stand out vs typical ads in this category"],

  "platformOptimizations": "vertical 9:16 framing / captions for sound-off / TikTok-style edits / IG Reels conventions / fast-hook for FYP — list specific platform-savvy choices",

  "hookType": "categorize: problem-first / curiosity-gap / transformation / social-proof / shock / pattern-break / personification / dialogue-direct / etc",

  "musicVibe": "concise descriptor",

  "recommendedDuration": 30,

  "creativeDirectorNotes": "free-form 2-3 sentence note on what makes this ad's creative DNA reproducible — what to keep, what's optional"
}`;
}

// Robust JSON extractor — handles Gemini wrapping in ```json ... ``` markdown,
// trailing commas, unescaped newlines in strings, AND truncated responses
// (auto-pads missing closing braces). Returns extracted JSON string or null.
function extractBalancedJson(text) {
  let s = text;
  // 1. Strip markdown code fences (with or without closing fence)
  const fenceWithClose = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceWithClose) {
    s = fenceWithClose[1];
  } else {
    // Truncated case: opening fence only, no closing
    const fenceOpenOnly = s.match(/```(?:json)?\s*([\s\S]*)$/i);
    if (fenceOpenOnly) s = fenceOpenOnly[1];
  }
  s = s.trim();

  // 2. Find first { and walk to balanced } (string-aware so quotes inside don't confuse)
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

  // 3. If we found balanced JSON, return it
  if (endIdx !== -1) return s.slice(startIdx, endIdx + 1);

  // 4. Truncated response: pad with closing braces equal to remaining depth
  if (depth > 0) {
    let recovered = s.slice(startIdx);
    // If we ended inside a string, close it first
    if (inString) recovered += '"';
    // Trim a trailing comma if present
    recovered = recovered.replace(/,\s*$/, '');
    // Add missing closing braces
    recovered += '}'.repeat(depth);
    return recovered;
  }

  return null;
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
