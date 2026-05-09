# SPRINT AUTONOMOUS — Full Feature Build

Project root: `/Users/siscaliman/Documents/Claude/Projects/Ads creative generator`

---

## API ROUTING RULES (IMMUTABLE)

| Fungsi | API | Endpoint / Model |
|--------|-----|-----------------|
| Image generation | apimart | `POST /images/generations` model `gpt-image-2` |
| Vision / analyze image | apimart | `POST /chat/completions` model `gpt-4o` + base64 |
| Chat / LLM completion | apimart | `POST /chat/completions` model `gpt-4o` |
| Upload image (get CDN URL) | apimart | existing `uploadImageToApimart()` in apimart.js |
| TTS audio | apimart | `POST /audio/speech` model `tts-1` |
| Video generation | GeminiGen | `POST https://api.geminigen.ai/uapi/v1/video-gen/grok` model `grok-3` |
| Video extend | GeminiGen | `POST https://api.geminigen.ai/uapi/v1/video-extend/grok` |
| Video poll | GeminiGen | `GET https://api.geminigen.ai/uapi/v1/history/{uuid}` |
| Video Remake ONLY | apimart | `doubao-seedance-2-0` via videoRemakeService.js — **DO NOT TOUCH** |

**Auth:**
- apimart: `Authorization: Bearer ${APIMART_API_KEY}` header
- GeminiGen: `x-api-key: ${GEMINIGEN_API_KEY}` header

**DO NOT MODIFY:** `geminiGenService.js`, `videoRemakeService.js`, `routes/reels.js`, `reelsGenerator.js`

---

## STATUS FITUR (SKIP YANG SUDAH ADA)

- ✅ Visual Style Presets — SUDAH ADA di reels/page.tsx
- ✅ A/B Hook Generator — SUDAH ADA di `/api/reels/generate-hooks`
- ✅ Storyboard Edit Mode — SUDAH ADA
- ✅ Scene Image Preview — SUDAH ADA

**Yang perlu dibangun: 13 fitur berikut.**

---

## FEATURE 1 — Project Type Selector

**Files:**
- `backend/src/services/storyboardBuilder.js` — tambah `projectType` param
- `backend/src/routes/reels.js` — accept + store `projectType` di session
- `backend/src/services/sessionStore.js` — tambah field `projectType`
- `frontend/app/(app)/reels/page.tsx` — tambah 3-card selector sebelum form brief

**Backend:**

Di `sessionStore.js`, tambah field `projectType: 'story' | 'product_promo' | 'digital_human'` ke `createSession()` default (`'product_promo'`).

Di `routes/reels.js` POST `/build-storyboard`, tambah `projectType` dari req.body, store ke session.

Di `storyboardBuilder.js`, fungsi `buildStoryboard()` terima `projectType`. Inject ke master prompt:
```js
const PROJECT_TYPE_INSTRUCTIONS = {
  product_promo: `PROJECT TYPE: Product Commercial.
- Clip 1 MUST be a strong hook showing the problem or desire.
- Middle clips MUST showcase product features, benefits, results.
- Last clip MUST be a clear CTA with product visible.
- Product must appear in EVERY clip. Product appearance must stay consistent.`,
  story: `PROJECT TYPE: Story Video.
- Build a narrative arc: setup → conflict → resolution.
- Characters must have consistent appearance throughout.
- Emotional beats: clip 1=hook emotion, middle=build tension, last=resolution/payoff.`,
  digital_human: `PROJECT TYPE: Digital Human Ad.
- Include a presenter/spokesperson character in every clip.
- Presenter speaks directly to camera in clips 1 and last.
- Middle clips show product demo while presenter reacts.`
}
```

**Frontend `reels/page.tsx`:**

Tambah step 0 sebelum brief form — 3 card selector:
```
[ 🎬 Product Promo ]  [ 📖 Story Video ]  [ 🤖 Digital Human ]
```
Store `projectType` di state, kirim ke `/build-storyboard`.

---

## FEATURE 2 — Language Selector

**Files:**
- `backend/src/services/storyboardBuilder.js`
- `backend/src/services/sessionStore.js`
- `frontend/app/(app)/reels/page.tsx`

**Backend:**

Di `sessionStore.js` tambah `outputLanguage: string` field, default `'en'`.

Di `storyboardBuilder.js`, inject ke master prompt:
```js
const LANGUAGE_INSTRUCTION = {
  en: 'Write ALL dialogue, VO scripts, and on-screen text in English.',
  id: 'Tulis SEMUA dialog, VO script, dan teks di video dalam Bahasa Indonesia.',
  th: 'Write ALL dialogue, VO scripts, and on-screen text in Thai.',
  vi: 'Write ALL dialogue, VO scripts, and on-screen text in Vietnamese.',
  zh: 'Write ALL dialogue, VO scripts, and on-screen text in Mandarin Chinese.',
  es: 'Write ALL dialogue, VO scripts, and on-screen text in Spanish.',
}
```

**Frontend:** Tambah dropdown di advanced settings: English / Bahasa Indonesia / Thai / Vietnamese / Mandarin / Spanish.

---

## FEATURE 3 — Product URL Scraper → Auto Brief

**Files:**
- `backend/src/services/productScraper.js` — NEW FILE
- `backend/src/routes/reels.js` — tambah endpoint

**Backend `productScraper.js`:**
```js
const axios = require('axios');
const cheerio = require('cheerio');
const { chatCompletion } = require('./apimart');

async function scrapeProduct(url) {
  // 1. Fetch HTML
  const { data: html } = await axios.get(url, {
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AdBot/1.0)' }
  });

  // 2. Extract with cheerio
  const $ = cheerio.load(html);
  const rawText = $('body').text().replace(/\s+/g, ' ').slice(0, 3000);
  const title = $('h1').first().text().trim() ||
    $('meta[property="og:title"]').attr('content') || '';
  const description = $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') || '';
  const imageUrl = $('meta[property="og:image"]').attr('content') ||
    $('img[class*="product"]').first().attr('src') || null;

  // 3. Use GPT-4o to parse structured product data from raw text
  const parsed = await chatCompletion({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: `Extract product info from this webpage text. Return JSON only:
{ "productName": "", "brand": "", "price": "", "currency": "", "features": ["max 5 bullet points"], "description": "max 100 words", "targetAudience": "" }

Webpage title: ${title}
Meta description: ${description}
Page text: ${rawText}`
    }],
    maxTokens: 500,
    temperature: 0.1,
  });

  let product = {};
  try {
    const match = parsed.match(/\{[\s\S]*\}/);
    product = match ? JSON.parse(match[0]) : {};
  } catch { product = { productName: title, description }; }

  const brief = `Product: ${product.productName || title}${product.brand ? ` by ${product.brand}` : ''}
${product.price ? `Price: ${product.currency || ''} ${product.price}` : ''}
Key Features: ${(product.features || []).join(', ')}
Description: ${product.description || description}
Target Audience: ${product.targetAudience || 'General consumers'}

Create a compelling product ad that showcases the benefits and drives purchase intent.`;

  return { product, brief, imageUrl };
}

module.exports = { scrapeProduct };
```

**Install:** `npm install cheerio` di backend.

**Route di `routes/reels.js`:**
```js
router.post('/scrape-product', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
    const result = await scrapeProduct(url);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: `Scraping failed: ${e.message}` });
  }
});
```

**Frontend `reels/page.tsx`:**

Di awal form brief, tambah input field "Paste product URL" + tombol "Auto-fill". On success: isi brief textarea otomatis, tampilkan product preview card.

**api.ts:**
```ts
export async function scrapeProductUrl(url: string) {
  const res = await api.post('/reels/scrape-product', { url })
  return res.data as { product: any; brief: string; imageUrl: string | null }
}
```

---

## FEATURE 4 — Character Consistency Pinning

**Files:**
- `backend/src/services/sessionStore.js`
- `backend/src/services/reelsGenerator.js`
- `backend/src/services/storyboardBuilder.js`
- `frontend/app/(app)/reels/page.tsx`

**Backend:**

Di `sessionStore.js` tambah field `pinnedCharacterImageUrl: string | null`, default `null`.

Di `routes/reels.js` POST `/build-storyboard`, accept `pinnedCharacterImageUrl` dan store di session.

Di `reelsGenerator.js`, sebelum `generateFirstClip()`, jika `session.pinnedCharacterImageUrl`:
- Prepend sebagai first item di `imageUrls[]` untuk SETIAP clip
- Override tidak bisa — karakter ini SELALU masuk

Di `storyboardBuilder.js`, jika `pinnedCharacter` ada, tambah ke setiap clip's `[REFERENCES]` section:
```
CHARACTER CONSISTENCY: The main character/person in the pinned reference image must appear in this scene with IDENTICAL appearance — same face, outfit, hair, body proportions. Do not alter their appearance.
```

**Frontend:**

Di section upload reference images, tambah toggle "📌 Pin as Main Character" per uploaded image. Saat toggle aktif, upload image itu juga dikirim sebagai `pinnedCharacterImageUrl` ke build-storyboard.

---

## FEATURE 5 — AI Script Expander

**Files:**
- `backend/src/routes/reels.js` — new endpoint
- `frontend/app/(app)/reels/page.tsx`
- `frontend/lib/api.ts`

**Endpoint `POST /api/reels/expand-script`:**
```js
router.post('/expand-script', async (req, res) => {
  const { brief, projectType = 'product_promo', clipCount = 5, outputLanguage = 'en' } = req.body;
  if (!brief) return res.status(400).json({ error: 'brief is required' });

  const langNote = outputLanguage !== 'en'
    ? `Write the script in ${outputLanguage === 'id' ? 'Bahasa Indonesia' : outputLanguage}.`
    : 'Write in English.';

  const response = await chatCompletion({
    model: 'gpt-4o',
    messages: [{
      role: 'system',
      content: 'You are a professional screenwriter specializing in short-form video ads.'
    }, {
      role: 'user',
      content: `${langNote}
Expand this brief into a ${clipCount}-scene video ad script.
Brief: "${brief}"
Project type: ${projectType}

For each scene return:
SCENE [N]:
Setting: [location + atmosphere]
Action: [what happens visually]
VO/Dialogue: [what is said — max 2 sentences]
Camera: [shot type: close-up/wide/medium/drone]
Emotion: [dominant emotion for viewer]

Make scene 1 a strong hook. Make last scene a clear CTA.`
    }],
    maxTokens: 1000,
    temperature: 0.8,
  });

  res.json({ expandedScript: response });
});
```

**Frontend:**

Di brief textarea, tambah tombol "✨ Expand to Full Script" di bawah input. Klik → call `/expand-script` → tampilkan result di panel expandable yang bisa diedit user → user klik "Use This Script" → isi ke brief textarea.

---

## FEATURE 6 — Auto Subtitle Generator (SRT)

**Files:**
- `backend/src/services/subtitleService.js` — NEW FILE
- `backend/src/routes/reels.js` — new endpoint
- `frontend/app/(app)/reels/page.tsx` — download button
- `frontend/lib/api.ts`

**`subtitleService.js`:**
```js
function generateSRT(clips) {
  // clips: [{ voScript, clipDuration }]
  let srt = '';
  let currentTime = 0;

  clips.forEach((clip, i) => {
    if (!clip.voScript) { currentTime += (clip.clipDuration || 10); return; }

    const start = currentTime;
    const end = currentTime + (clip.clipDuration || 10);
    const startStr = formatTime(start);
    const endStr = formatTime(end);

    // Split long VO into 2 lines max
    const words = clip.voScript.split(' ');
    const mid = Math.ceil(words.length / 2);
    const line1 = words.slice(0, mid).join(' ');
    const line2 = words.slice(mid).join(' ');
    const text = line2 ? `${line1}\n${line2}` : line1;

    srt += `${i + 1}\n${startStr} --> ${endStr}\n${text}\n\n`;
    currentTime = end;
  });

  return srt;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s},000`;
}

module.exports = { generateSRT };
```

**Endpoint `GET /api/reels/:sessionId/subtitles`:**
```js
router.get('/:sessionId/subtitles', async (req, res) => {
  const session = await getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const clips = session.storyboard || [];
  const srt = generateSRT(clips.map(c => ({
    voScript: c.voScript || c.technicalConfig?.voScript || '',
    clipDuration: session.clipDuration || 10,
  })));

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="subtitles.srt"`);
  res.send(srt);
});
```

**Frontend:** Setelah video generation selesai, tampilkan tombol "📝 Download Subtitles (.srt)".

---

## FEATURE 7 — Voice Dubbing (TTS Auto-Dub)

**API:** apimart `POST /audio/speech` (OpenAI-compatible, model `tts-1`)

**Files:**
- `backend/src/services/ttsService.js` — NEW FILE
- `backend/src/services/reelsMerger.js` — integrasi FFmpeg mix audio
- `backend/src/routes/reels.js` — accept `enableTTS`, `ttsVoice`
- `frontend/app/(app)/reels/page.tsx`

**`ttsService.js`:**
```js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

async function generateTTSAudio(text, voice = 'nova', outputPath) {
  const response = await axios.post(
    `${config.apimart.baseUrl}/audio/speech`,
    { model: 'tts-1', input: text, voice, response_format: 'mp3' },
    {
      headers: {
        'Authorization': `Bearer ${config.apimart.apiKey}`,
        'Content-Type': 'application/json',
      },
      responseType: 'arraybuffer',
      timeout: 30000,
    }
  );
  fs.writeFileSync(outputPath, Buffer.from(response.data));
  return outputPath;
}

// Generate TTS for all clips' VO scripts, return array of audio file paths
async function generateClipAudios(clips, voice, tempDir) {
  const audioPaths = [];
  for (let i = 0; i < clips.length; i++) {
    const voText = clips[i].voScript || clips[i].technicalConfig?.voScript || '';
    if (!voText.trim()) { audioPaths.push(null); continue; }
    const outPath = path.join(tempDir, `tts_clip_${i}.mp3`);
    try {
      await generateTTSAudio(voText, voice, outPath);
      audioPaths.push(outPath);
    } catch (e) {
      console.warn(`[TTS] clip ${i} failed: ${e.message}`);
      audioPaths.push(null);
    }
  }
  return audioPaths;
}

module.exports = { generateTTSAudio, generateClipAudios, VOICES };
```

**`reelsMerger.js`:**

Tambah optional parameter `ttsAudioPaths: string[]` ke merge function. Jika ada, pakai FFmpeg `amix` atau `amerge` untuk mix TTS audio ke atas video (di per-clip atau di merged final).

Implementasi: sebelum concat, per clip: `ffmpeg -i clip.mp4 -i tts.mp3 -filter_complex "[1:a]apad[a]" -map 0:v -map "[a]" -shortest clip_dubbed.mp4`

**Session:** Tambah `enableTTS: boolean`, `ttsVoice: string` ke sessionStore.

**Frontend:** Toggle "🔊 Add AI Voiceover" di advanced settings. Show voice selector: Alloy / Echo / Fable / Onyx / Nova / Shimmer.

---

## FEATURE 8 — Batch Storyboard Variants (3 Angles)

**Files:**
- `backend/src/routes/reels.js`
- `frontend/app/(app)/reels/page.tsx`
- `frontend/lib/api.ts`

**Endpoint `POST /api/reels/build-storyboard-variants`:**
```js
router.post('/build-storyboard-variants', async (req, res) => {
  const basePayload = req.body; // same as build-storyboard

  const angles = [
    { label: 'Emotional Story', angleInstruction: 'Focus on emotional connection and storytelling. Use personal transformation narrative. Make viewers feel something.' },
    { label: 'Benefits & Features', angleInstruction: 'Focus on product features, specs, and measurable benefits. Lead with the #1 unique benefit. Use numbers and facts.' },
    { label: 'Social Proof', angleInstruction: 'Focus on credibility: testimonials, user count, reviews, awards, before/after results. Build trust first.' },
  ];

  const variants = await Promise.allSettled(
    angles.map(async (angle) => {
      const sessionId = `variant_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const storyboard = await buildStoryboard({
        ...basePayload,
        additionalInstruction: angle.angleInstruction,
        sessionId,
      });
      return { label: angle.label, sessionId, storyboard };
    })
  );

  res.json({
    variants: variants
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value)
  });
});
```

**Frontend:** Tambah toggle "Generate 3 Variants" di sebelah Generate button. Tampilkan 3 storyboard side-by-side dengan label. User pilih satu → proceed ke video generation dengan sessionId yang dipilih.

---

## FEATURE 9 — Export Resolution Options

**Files:**
- `backend/src/services/reelsMerger.js`
- `backend/src/routes/reels.js`
- `frontend/app/(app)/reels/page.tsx`

**reelsMerger.js:** Tambah `exportResolution: '720p' | '1080p' | '4k'` param ke merge function.

FFmpeg scale filter:
```js
const SCALE_MAP = { '720p': '1280:720', '1080p': '1920:1080', '4k': '3840:2160' };
const scaleFilter = SCALE_MAP[exportResolution] || SCALE_MAP['720p'];
// Add to FFmpeg: .videoFilters(`scale=${scaleFilter}`)
```

**Session:** Tambah `exportResolution: '720p'` default.

**Frontend:** Di results/generation page, tambah "Export Quality" selector sebelum Merge button: 720p (Fast) / 1080p (HD) / 4K (Pro).

---

## FEATURE 10 — Multi-Reference per Clip (Override)

**Files:**
- `backend/src/services/sessionStore.js`
- `backend/src/services/reelsGenerator.js`
- `backend/src/routes/reels.js`
- `frontend/app/(app)/reels/page.tsx`
- `frontend/components/reels/StoryboardClipCard.tsx`

**Backend:**

Di `sessionStore.js` tambah `clipReferenceOverrides: { [clipIndex: number]: string[] }`, default `{}`.

Endpoint baru `POST /api/reels/:sessionId/clip-references`:
```js
router.post('/:sessionId/clip-references', async (req, res) => {
  const { clipIndex, imageUrls } = req.body;
  const session = await getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!session.clipReferenceOverrides) session.clipReferenceOverrides = {};
  session.clipReferenceOverrides[clipIndex] = imageUrls;
  await saveSession(req.params.sessionId, session);
  res.json({ ok: true });
});
```

Di `reelsGenerator.js`, per clip: jika `session.clipReferenceOverrides[clipIndex]` ada, pakai itu. Otherwise pakai `session.referenceImageUrls`.

**Frontend `StoryboardClipCard.tsx`:** Tambah expandable section "Override references for this clip" dengan upload dropzone kecil.

---

## FEATURE 11 — Self-Review Agent

**Files:**
- `backend/src/services/reviewAgent.js` — NEW FILE
- `backend/src/routes/reels.js` — new endpoint
- `frontend/app/(app)/reels/page.tsx`
- `frontend/lib/api.ts`

**`reviewAgent.js`:**
```js
const { analyzeImage } = require('./apimart');

async function reviewGeneratedClips(clips, brief) {
  // clips: [{ uuid, thumbnailUrl, voScript, clipIndex }]
  const clipsWithThumbs = clips.filter(c => c.thumbnailUrl);
  if (!clipsWithThumbs.length) return { issues: [], overallScore: 70, message: 'No thumbnails available for review' };

  const thumbnailDescriptions = await Promise.allSettled(
    clipsWithThumbs.map(async (clip) => {
      try {
        const desc = await analyzeImage({
          imageUrl: clip.thumbnailUrl,
          prompt: `Briefly describe what you see in this video frame. Is it visually clear and high quality? Any obvious issues? Max 50 words.`,
        });
        return { clipIndex: clip.clipIndex, description: desc };
      } catch { return { clipIndex: clip.clipIndex, description: 'Unable to analyze' }; }
    })
  );

  const descriptions = thumbnailDescriptions
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  const reviewPrompt = `You are a video ad quality reviewer. Review these AI-generated video clips for a product ad.

Brief: "${brief}"

Clip descriptions:
${descriptions.map(d => `Clip ${d.clipIndex + 1}: ${d.description}`).join('\n')}

Return JSON only:
{
  "overallScore": 0-100,
  "issues": [{ "clipIndex": 0, "severity": "warning|error", "message": "..." }],
  "summary": "one sentence overall assessment"
}`;

  const { chatCompletion } = require('./apimart');
  const response = await chatCompletion({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: reviewPrompt }],
    maxTokens: 600,
    temperature: 0.3,
  });

  try {
    const match = response.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { issues: [], overallScore: 75, summary: 'Review complete' };
  } catch { return { issues: [], overallScore: 75, summary: 'Review complete' }; }
}

module.exports = { reviewGeneratedClips };
```

**Endpoint `POST /api/reels/:sessionId/review`:**
```js
router.post('/:sessionId/review', async (req, res) => {
  const session = await getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const clips = (session.storyboard || []).map((clip, i) => ({
    clipIndex: i,
    thumbnailUrl: clip.thumbnailUrl || null,
    voScript: clip.voScript || '',
  }));

  const review = await reviewGeneratedClips(clips, session.brief || '');
  res.json(review);
});
```

**Frontend:** Setelah video generation selesai, auto-call `/review`. Tampilkan banner:
- Score ≥ 80: "✅ Great quality — ready to export"
- Score 60-79: "⚠️ Review suggested — [N] potential issues"
- Score < 60: "❌ Quality issues detected — consider regenerating flagged clips"

---

## FEATURE 12 — Conversational Shot Editing

**Files:**
- `backend/src/routes/reels.js` — new endpoint
- `frontend/components/reels/StoryboardClipCard.tsx`
- `frontend/lib/api.ts`

**Endpoint `POST /api/reels/:sessionId/edit-clip`:**
```js
router.post('/:sessionId/edit-clip', async (req, res) => {
  const { clipIndex, instruction } = req.body;
  const session = await getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const clip = session.storyboard?.[clipIndex];
  if (!clip) return res.status(404).json({ error: 'Clip not found' });

  const { chatCompletion } = require('../services/apimart');
  const { generateSceneImage } = require('../services/sceneImageService');

  // Update grokPrompt + technicalConfig based on instruction
  const response = await chatCompletion({
    model: 'gpt-4o',
    messages: [{
      role: 'system',
      content: 'You are a video director. Modify the given clip spec based on the instruction. Return the FULL updated clip as JSON, preserving all fields not mentioned in the instruction.'
    }, {
      role: 'user',
      content: `Current clip spec:
${JSON.stringify(clip, null, 2)}

User instruction: "${instruction}"

Return the updated clip JSON only. Preserve structure. Update grokPrompt, voScript, and technicalConfig fields to reflect the instruction.`
    }],
    maxTokens: 1500,
    temperature: 0.7,
  });

  let updatedClip = clip;
  try {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) updatedClip = { ...clip, ...JSON.parse(match[0]) };
  } catch { /* keep original on parse error */ }

  // Regenerate scene image for the updated clip
  try {
    const sceneImageUrl = await generateSceneImage(updatedClip.grokPrompt || updatedClip.imagePrompt || '');
    updatedClip.sceneImageUrl = sceneImageUrl;
  } catch { /* scene image is non-blocking */ }

  session.storyboard[clipIndex] = updatedClip;
  await saveSession(req.params.sessionId, session);

  res.json({ clip: updatedClip, clipIndex });
});
```

**Frontend `StoryboardClipCard.tsx`:** Tambah input field "✏️ Edit this clip..." di bawah setiap card. Saat submit → call `/edit-clip` → update card dengan clip baru tanpa reload page.

**api.ts:**
```ts
export async function editStoryboardClip(sessionId: string, clipIndex: number, instruction: string) {
  const res = await api.post(`/reels/${sessionId}/edit-clip`, { clipIndex, instruction })
  return res.data as { clip: TechnicalConfig & { sceneImageUrl?: string }, clipIndex: number }
}
```

---

## FEATURE 13 — Scene Transition Planner

**Files:**
- `backend/src/services/reelsMerger.js`
- `backend/src/routes/reels.js`
- `frontend/app/(app)/reels/page.tsx`
- `frontend/components/reels/StoryboardClipCard.tsx`

**Transitions to support:**

| Type | FFmpeg Filter |
|------|--------------|
| `cut` | Simple concat (default, current behavior) |
| `fade` | `xfade=fade:offset={offset}:duration=0.5` |
| `dissolve` | `xfade=dissolve:offset={offset}:duration=0.5` |
| `wipeleft` | `xfade=wipeleft:offset={offset}:duration=0.5` |
| `zoom` | `xfade=zoomin:offset={offset}:duration=0.3` |

**reelsMerger.js:** Accept `transitions: { [afterClipIndex: number]: string }` param. Kalau ada transition, gunakan FFmpeg `filter_complex` dengan `xfade` daripada simple concat.

**Session:** Tambah `transitions: {}` field.

**Endpoint `POST /api/reels/:sessionId/transitions`:**
```js
router.post('/:sessionId/transitions', async (req, res) => {
  const { transitions } = req.body; // { "0": "dissolve", "1": "fade" }
  const session = await getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  session.transitions = transitions || {};
  await saveSession(req.params.sessionId, session);
  res.json({ ok: true });
});
```

**Frontend:** Antara setiap dua clip card di storyboard, tampilkan mini dropdown: Cut / Fade / Dissolve / Wipe / Zoom. Default Cut.

---

## AUDIT LOOP (WAJIB SETELAH SEMUA FITUR SELESAI)

Jalankan loop ini sampai clean:

```
1. cd frontend && npx tsc --noEmit
   → Harus 0 error. Fix semua TypeScript error sebelum lanjut.

2. node --check pada setiap backend file yang diubah/dibuat

3. Grep sanity checks:
   grep -rn "kling\|dall-e-3\|dall-e\|runway\|sora" backend/src/ --include="*.js"
   → 0 hasil (kecuali di komentar)

   grep -rn "generateVideo\b" backend/src/routes/ backend/src/services/ --include="*.js"
   → Hanya boleh ada di apimart.js (definisi) dan videoRemakeService.js

4. Cek semua api.ts function calls punya matching backend route:
   Setiap `api.post('/X')` dan `api.get('/X')` di api.ts harus ada handler di routes/

5. Kalau ada error atau mismatch di step 1-4, fix dan ulangi dari step 1.
   Selesai hanya kalau semua 5 steps bersih.
```

---

## COMMIT + DEPLOY

Setelah audit 100% clean:

```python
import os
for f in ['.git/index.lock', '.git/HEAD.lock']:
    try: os.rename(f, f + '.bak')
    except: pass
```
```bash
cd backend && npm install cheerio 2>/dev/null; cd ..
git add -A
git commit -m "feat: add 13 new features — project type, language, url scraper, character pinning, script expander, subtitles, TTS, batch variants, export resolution, clip ref override, self-review, shot editing, transitions"
git push origin main
railway up --detach
```
