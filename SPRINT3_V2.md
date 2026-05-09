# SPRINT 3 v2 — Scale Winning Video: Analysis Mode + Intent-to-Prompt

Project root: `/Users/siscaliman/Documents/Claude/Projects/Ads creative generator`

**Rules:**
- Jangan install package baru kecuali yang disebutkan.
- Jangan ubah: `geminiGenService.js`, `videoRemakeService.js`, `routes/reels.js`.
- API rules tetap: non-video = apimart, video generation = GeminiGen grok-3.
- Jalankan audit loop sampai 0 error sebelum commit.

---

## OVERVIEW

Dua perubahan utama pada fitur "Scale Winning Video":

**A) Analysis Mode Selection**
Ketika user pilih mode URL (IG/TikTok/YouTube), tampilkan toggle pilihan:
- **Audio Only** — yt-dlp download → Whisper-1 transcript saja → enrich dengan GPT-4o text → hasilkan analisis berbasis script. Lebih cepat (~15 detik), lebih murah.
- **Full Visual + Audio** — Gemini 2.5 Flash via apimart native endpoint → 1 call analisis visual + audio sekaligus. Lebih kaya hasil (~30-45 detik), biaya ~$0.006/video 60 detik.

**B) Intent-to-Prompt Step**
Setelah analisis selesai, sebelum "Pilih Produk & Setting":
- Tampilkan text area "Mau dipakai untuk apa?"
- User isi intent (misal: "jual skincare kolagen untuk wanita 30-45 tahun di Jakarta")
- Klik "Refine Prompt" → backend pakai GPT-4o via apimart untuk translate analisis + intent → video prompt yang spesifik
- Tampilkan hasilnya di editable textarea (user bisa edit)
- Prompt hasil ini dipakai sebagai base untuk video generate step

---

## FEATURE 1 — backend/src/services/videoUrlAnalyzer.js (REPLACE ENTIRE FILE)

```js
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
```

---

## FEATURE 2 — backend/src/services/translatePromptService.js (NEW FILE)

```js
/**
 * translatePromptService.js
 *
 * Given a video analysis + user intent, use GPT-4o via apimart to produce
 * a detailed, ready-to-use GeminiGen grok-3 video prompt for the user's product.
 */

const { chatCompletion } = require('./apimart');
const config = require('../config');

/**
 * @param {object} opts
 * @param {object} opts.videoAnalysis       - result from analyzeVideoFromUrl.analysis
 * @param {string} opts.userIntent          - free-text from user: "untuk apa video ini?"
 * @param {string} opts.productName         - product name
 * @param {string} [opts.productDescription] - optional product description
 * @returns {Promise<{ videoPrompt, hookVariants, scriptOutline }>}
 */
async function translateVideoPrompt({ videoAnalysis, userIntent, productName, productDescription = '' }) {
  const analysisStr = JSON.stringify({
    overallStyle: videoAnalysis.overallStyle,
    pacing: videoAnalysis.pacing,
    hookType: videoAnalysis.hookType,
    colorPalette: videoAnalysis.colorPalette,
    cameraMovement: videoAnalysis.cameraMovement,
    emotionArc: videoAnalysis.emotionArc,
    musicVibe: videoAnalysis.musicVibe,
    scriptStructure: videoAnalysis.scriptStructure,
    toneOfVoice: videoAnalysis.toneOfVoice,
    keyMessages: videoAnalysis.keyMessages,
    hookWords: videoAnalysis.hookWords,
  }, null, 2);

  const raw = await chatCompletion({
    model: config.models.scalingChat || config.models.chat,
    messages: [
      {
        role: 'system',
        content: 'You are an expert video ad copywriter and prompt engineer for AI video generation tools. Return only valid JSON, no markdown.',
      },
      {
        role: 'user',
        content: `A winning ad video has been analyzed. You must adapt its creative DNA for a new product.

WINNING AD DNA:
${analysisStr}

USER INTENT:
"${userIntent}"

PRODUCT: ${productName}
${productDescription ? `PRODUCT DESCRIPTION: ${productDescription}` : ''}

Your tasks:
1. Write a detailed 150-200 word video generation prompt (for GeminiGen grok-3) that:
   - Replicates the visual style, pacing, camera movement, and color palette of the winning ad
   - Adapts the content to showcase "${productName}"
   - Incorporates the user's intent: "${userIntent}"
   - Includes specific cinematic details (shot types, lighting, transitions, music direction)

2. Write 3 hook variants (first 3 seconds) adapted from the winning ad's hook style.

3. Write a script outline adapted from the winning ad's structure.

Return ONLY valid JSON:
{
  "videoPrompt": "the full 150-200 word cinematic video prompt in English",
  "hookVariants": [
    "Hook variant 1 (adapt style from winning ad)",
    "Hook variant 2",
    "Hook variant 3"
  ],
  "scriptOutline": "step-by-step script outline: 1) hook, 2) problem, 3) solution, 4) CTA — adapted from winning ad structure"
}`,
      },
    ],
    maxTokens: 800,
  });

  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
  } catch (e) {
    console.warn('[translatePromptService] JSON parse failed:', e.message);
  }

  // Fallback
  return {
    videoPrompt: raw.slice(0, 400) || 'Video prompt generation failed.',
    hookVariants: [],
    scriptOutline: '',
  };
}

module.exports = { translateVideoPrompt };
```

---

## FEATURE 3 — backend/src/routes/scale-video.js (CHANGES)

### 3.1 — Update import at top (already has analyzeVideoFromUrl, add translateVideoPrompt)

Find:
```js
const { analyzeVideoFromUrl } = require('../services/videoUrlAnalyzer');
```

Replace with:
```js
const { analyzeVideoFromUrl } = require('../services/videoUrlAnalyzer');
const { translateVideoPrompt } = require('../services/translatePromptService');
```

### 3.2 — Update `/analyze-from-url` to accept `mode` param

Find the entire route handler:
```js
router.post('/analyze-from-url', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
```

Replace with:
```js
router.post('/analyze-from-url', async (req, res) => {
  const { url, mode = 'full' } = req.body || {};
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
```

Find inside that handler:
```js
    const { analysis, frames, transcript, platform } = await analyzeVideoFromUrl(url);
```

Replace with:
```js
    const { analysis, frames, transcript, platform, mode: usedMode } = await analyzeVideoFromUrl(url, mode);
```

Find in that handler's res.json:
```js
    res.json({
      analysis,
      framesAnalyzed: frames,
      filename: `${platform}: ${url.slice(-50)}`,
      platform,
      transcript,
      availableAngles,
    });
```

Replace with:
```js
    res.json({
      analysis,
      framesAnalyzed: frames,
      filename: `${platform}: ${url.slice(-50)}`,
      platform,
      transcript,
      mode: usedMode,
      availableAngles,
    });
```

### 3.3 — Add new `/translate-prompt` endpoint (before `module.exports = router`)

```js
/**
 * POST /api/scale-video/translate-prompt
 * Given video analysis + user intent, generate a tailored GeminiGen video prompt.
 * Body: { videoAnalysis, userIntent, productName, productDescription? }
 * Returns: { videoPrompt, hookVariants, scriptOutline }
 */
router.post('/translate-prompt', async (req, res) => {
  const { videoAnalysis, userIntent, productName, productDescription = '' } = req.body || {};
  if (!videoAnalysis || !userIntent || !productName) {
    return res.status(400).json({ error: 'videoAnalysis, userIntent, and productName are required' });
  }
  try {
    const result = await translateVideoPrompt({ videoAnalysis, userIntent, productName, productDescription });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Gagal generate prompt' });
  }
});
```

### 3.4 — Update `/generate` to accept optional `customVideoPrompt`

In `router.post('/generate', ...)`, find the destructuring:
```js
  const {
    videoAnalysis,
    productName,
    productDescription = '',
    selectedAngles = [],
    aspectRatio = '9:16',
    productPhotoBase64 = null,
    productPhotoMime = 'image/jpeg',
  } = req.body;
```

Replace with:
```js
  const {
    videoAnalysis,
    productName,
    productDescription = '',
    selectedAngles = [],
    aspectRatio = '9:16',
    productPhotoBase64 = null,
    productPhotoMime = 'image/jpeg',
    customVideoPrompt = null,
  } = req.body;
```

Find Step 4 in that route:
```js
  // Step 4: Build per-angle prompts (same pipeline as images)
  const variationsWithPrompts = await generateVariationPrompts(
    videoAnalysis,
    angles,
    productName,
    productVisualDescription,
    {},
    null
  );
```

Replace with:
```js
  // Step 4: Build per-angle prompts — use customVideoPrompt as base if provided
  const variationsWithPrompts = await generateVariationPrompts(
    videoAnalysis,
    angles,
    productName,
    productVisualDescription,
    {},
    null,
    customVideoPrompt || null
  );
```

---

## FEATURE 4 — backend/src/services/scalingService.js (MINOR UPDATE)

### 4.1 — Update `generateVariationPrompts` signature to accept `customVideoPromptOverride`

Find function signature:
```js
async function generateVariationPrompts(
  referenceAnalysis,
  angles,
  productName,
  productVisualDescription,
  brandVoice,
  productImageUrl
) {
```

Replace with:
```js
async function generateVariationPrompts(
  referenceAnalysis,
  angles,
  productName,
  productVisualDescription,
  brandVoice,
  productImageUrl,
  customVideoPromptOverride = null
) {
```

### 4.2 — Inside `generateVariationPrompts`, where `imagePrompt` is assigned to each variation

Find the line where variation gets its `imagePrompt` set. It will be inside a `.map` or loop, something like:
```js
imagePrompt: videoPrompt,
```
or similar. After the imagePrompt is computed/assigned, add:

```js
// If user provided a custom refined prompt, use it instead of auto-generated one
if (customVideoPromptOverride) {
  variation.imagePrompt = customVideoPromptOverride;
}
```

> **Note**: Read the actual code first to find the exact location. The pattern is: find where `imagePrompt` is set inside `generateVariationPrompts`, then override it with `customVideoPromptOverride` if truthy.

---

## FEATURE 5 — frontend/lib/api.ts (CHANGES)

### 5.1 — Update `analyzeWinningVideoFromUrl` to accept mode

Find:
```ts
export async function analyzeWinningVideoFromUrl(url: string) {
  const res = await api.post('/scale-video/analyze-from-url', { url }, { timeout: 240000 })
```

Replace with:
```ts
export async function analyzeWinningVideoFromUrl(url: string, mode: 'audio' | 'full' = 'full') {
  const res = await api.post('/scale-video/analyze-from-url', { url, mode }, { timeout: 240000 })
```

### 5.2 — Add `translateVideoPrompt` function (after `analyzeWinningVideoFromUrl`)

```ts
export async function translateVideoPrompt(payload: {
  videoAnalysis: any
  userIntent: string
  productName: string
  productDescription?: string
}): Promise<{ videoPrompt: string; hookVariants: string[]; scriptOutline: string }> {
  const res = await api.post('/scale-video/translate-prompt', payload, { timeout: 60000 })
  return res.data
}
```

### 5.3 — Update `generateScaleVideoJob` to accept optional `customVideoPrompt`

Find the `generateScaleVideoJob` function and its payload type. Add `customVideoPrompt?: string` to the payload parameter type and include it in the POST body.

---

## FEATURE 6 — frontend/app/(app)/scale-video/page.tsx (CHANGES)

### 6.1 — Add imports

Add to existing imports:
```ts
import { analyzeWinningVideo, analyzeWinningVideoFromUrl, translateVideoPrompt, generateScaleVideoJob, getProducts, type Product, type ScaleVideoGenerateResponse } from '@/lib/api'
import { Textarea } from '@/components/ui/textarea'
```

Add to lucide-react imports: `Wand2`, `ChevronRight`

### 6.2 — Add new states (after existing states)

```ts
// Analysis mode for URL input
const [analyzeMode, setAnalyzeMode] = useState<'audio' | 'full'>('full')

// Intent-to-prompt step
const [userIntent, setUserIntent] = useState('')
const [translating, setTranslating] = useState(false)
const [refinedPrompt, setRefinedPrompt] = useState<string>('')
const [hookVariants, setHookVariants] = useState<string[]>([])
const [scriptOutline, setScriptOutline] = useState('')
const [showIntentStep, setShowIntentStep] = useState(false)
```

### 6.3 — Update `handleAnalyze` to pass analyzeMode

Find:
```ts
      const resp = inputMode === 'url'
        ? await analyzeWinningVideoFromUrl(urlInput.trim())
        : await analyzeWinningVideo(file!)
```

Replace with:
```ts
      const resp = inputMode === 'url'
        ? await analyzeWinningVideoFromUrl(urlInput.trim(), analyzeMode)
        : await analyzeWinningVideo(file!)
```

Also in `handleAnalyze`, after `setVideoAnalysis(resp.analysis)`, reset intent step:
```ts
      setRefinedPrompt('')
      setHookVariants([])
      setScriptOutline('')
      setUserIntent('')
      setShowIntentStep(true)  // show intent step after analysis
```

### 6.4 — Add `handleTranslatePrompt` function

```ts
const handleTranslatePrompt = async () => {
  if (!userIntent.trim() || !videoAnalysis || !selectedProduct) return
  setTranslating(true)
  try {
    const result = await translateVideoPrompt({
      videoAnalysis,
      userIntent: userIntent.trim(),
      productName: selectedProduct.name,
      productDescription: selectedProduct.description,
    })
    setRefinedPrompt(result.videoPrompt)
    setHookVariants(result.hookVariants || [])
    setScriptOutline(result.scriptOutline || '')
  } catch (e: any) {
    setError(e?.response?.data?.error || e.message || 'Gagal generate prompt')
  } finally {
    setTranslating(false)
  }
}
```

### 6.5 — Update `handleGenerate` to pass `customVideoPrompt`

Find the `generateScaleVideoJob` call and add `customVideoPrompt: refinedPrompt || undefined` to the payload.

### 6.6 — In URL input section, add `analyzeMode` toggle BELOW the URL input field

Insert after the URL input `<p className="text-xs ...">` paragraph, before the closing `</div>` of the URL input container:

```tsx
{/* Analysis mode toggle */}
<div>
  <p className="text-xs font-medium text-muted-foreground mb-1">Mode analisis:</p>
  <div className="flex rounded-md border bg-muted/30 p-0.5 gap-0.5">
    <button
      type="button"
      onClick={() => setAnalyzeMode('audio')}
      className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
        analyzeMode === 'audio' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      🎙 Audio Only
    </button>
    <button
      type="button"
      onClick={() => setAnalyzeMode('full')}
      className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
        analyzeMode === 'full' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      🎬 Visual + Audio
    </button>
  </div>
  <p className="text-[10px] text-muted-foreground mt-1">
    {analyzeMode === 'audio' ? 'Hanya analisis script/narasi (~15 detik)' : 'Analisis visual + audio lengkap via Gemini (~30-45 detik)'}
  </p>
</div>
```

### 6.7 — Add "Intent-to-Prompt" Card (between analysis result and Step 2)

Insert this Card after the analysis summary Card (`{videoAnalysis && !analyzing && (...)}`) and BEFORE `{videoAnalysis && (<Card> Step 2...)}`:

```tsx
{/* Step 1.5 — Intent to Prompt */}
{videoAnalysis && !analyzing && showIntentStep && (
  <Card className="border-primary/30 bg-primary/5">
    <CardHeader className="pb-3">
      <CardTitle className="text-base flex items-center gap-2">
        <Wand2 className="h-4 w-4 text-primary" />
        Refine Prompt
      </CardTitle>
      <CardDescription>
        Ceritakan mau dipakai untuk apa — AI akan translate analisis ini jadi video prompt yang spesifik.
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      <Textarea
        placeholder="Contoh: jual suplemen kolagen untuk wanita 30-45 tahun, target ibu-ibu Jakarta yang aktif, tone: warm dan aspirational"
        value={userIntent}
        onChange={(e) => setUserIntent(e.target.value)}
        rows={3}
        className="text-sm resize-none"
      />

      <Button
        className="w-full"
        onClick={handleTranslatePrompt}
        disabled={!userIntent.trim() || !selectedProduct || translating}
      >
        {translating ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Generating refined prompt…</>
        ) : (
          <><Wand2 className="h-4 w-4" /> Refine Prompt dengan AI</>
        )}
      </Button>

      {refinedPrompt && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-primary">Video Prompt (editable):</p>
            <Textarea
              value={refinedPrompt}
              onChange={(e) => setRefinedPrompt(e.target.value)}
              rows={5}
              className="text-xs font-mono resize-none"
            />
          </div>

          {hookVariants.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Hook variants:</p>
              <div className="space-y-1">
                {hookVariants.map((h, i) => (
                  <div key={i} className="rounded border bg-background px-2.5 py-1.5 text-xs">
                    <span className="font-medium text-primary">{i + 1}.</span> {h}
                  </div>
                ))}
              </div>
            </div>
          )}

          {scriptOutline && (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Script outline</summary>
              <p className="mt-1.5 rounded border bg-muted p-2.5 text-xs leading-relaxed">{scriptOutline}</p>
            </details>
          )}

          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
            <ChevronRight className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <p className="text-xs text-emerald-700 font-medium">Prompt siap — lanjut ke Step 2 untuk generate video.</p>
          </div>
        </div>
      )}
    </CardContent>
  </Card>
)}
```

---

## AUDIT LOOP (WAJIB — ulangi sampai 0 error)

```bash
# 1. TypeScript check
cd /Users/siscaliman/Documents/Claude/Projects/Ads\ creative\ generator/frontend && npx tsc --noEmit
# → must be 0 errors

# 2. Node syntax check
node --check /Users/siscaliman/Documents/Claude/Projects/Ads\ creative\ generator/backend/src/services/videoUrlAnalyzer.js
node --check /Users/siscaliman/Documents/Claude/Projects/Ads\ creative\ generator/backend/src/services/translatePromptService.js
node --check /Users/siscaliman/Documents/Claude/Projects/Ads\ creative\ generator/backend/src/routes/scale-video.js

# 3. No stray references to old models
grep -rn "kling\|dall-e-3\|runway\|whisper" /Users/siscaliman/Documents/Claude/Projects/Ads\ creative\ generator/backend/src/routes/ --include="*.js"
# → 0 results in routes (whisper is OK in services/videoAnalyzer.js only)

# 4. Verify endpoint wiring
grep -n "translate-prompt\|analyze-from-url" /Users/siscaliman/Documents/Claude/Projects/Ads\ creative\ generator/backend/src/routes/scale-video.js
# → both endpoints present

# 5. Verify api.ts exports
grep -n "translateVideoPrompt\|analyzeWinningVideoFromUrl" /Users/siscaliman/Documents/Claude/Projects/Ads\ creative\ generator/frontend/lib/api.ts
# → both functions present

# 6. Verify frontend imports
grep -n "translateVideoPrompt\|analyzeMode\|userIntent\|refinedPrompt" /Users/siscaliman/Documents/Claude/Projects/Ads\ creative\ generator/frontend/app/\(app\)/scale-video/page.tsx
# → all present

# 7. Fix any error found and re-run from step 1
```

---

## COMMIT + DEPLOY

```bash
cd /Users/siscaliman/Documents/Claude/Projects/Ads\ creative\ generator
git add -A
git commit -m "feat: sprint 3 v2 — analysis mode (audio/full Gemini), intent-to-prompt refiner, custom video prompt"
git push origin main
railway up --detach
```
