# SPRINT: Per-Scene Voiceover + Adapted VO Script

Project root: `/Users/siscaliman/Documents/Claude/Projects/Ads creative generator`

**Rules:**
- Jangan install package baru.
- Jangan ubah: `geminiGenService.js`, `videoRemakeService.js`, `routes/reels.js`, `scalingService.js`.
- Jalankan endless audit loop (lihat section AUDIT LOOP) sampai 0 error sebelum commit.

---

## OVERVIEW

Dua penambahan:

**A) Voiceover per scene di analisis**
Gemini sudah return `transcript` global, tapi belum return dialogue/VO per scene. Tambah field
`"dialogue"` ke setiap scene di `buildGeminiPrompt()`. Frontend sudah punya render `s.dialogue`
(line 1056 di page.tsx) — jadi begitu Gemini return field ini, langsung tampil otomatis. ✅

**B) Adapted voiceover di Refine Prompt**
Saat user klik "Refine Prompt dengan AI", GPT-4o juga harus hasilkan voiceover script yang sudah
diadaptasi untuk produk/karakter/intent user — per scene sesuai durasi video aslinya.
Ditampilkan di panel Refine Prompt setelah hookVariants.

---

## FEATURE 1 — backend/src/services/videoUrlAnalyzer.js

### 1.1 — Tambah field `dialogue` ke schema scene di `buildGeminiPrompt()`

Cari blok schema scenes di dalam fungsi `buildGeminiPrompt()`:
```
  "scenes": [
    {
      "sceneNumber": 1,
      "duration": "0-3s",
      "description": "what happens visually + audio in this scene",
      "hook": true,
      "visualElements": ["element1", "element2"],
      "emotion": "specific emotion targeted"
    }
  ],
```

Ganti dengan:
```
  "scenes": [
    {
      "sceneNumber": 1,
      "duration": "0-3s",
      "description": "what happens visually in this scene",
      "dialogue": "exact spoken words / voiceover in this scene, empty string if silent",
      "hook": true,
      "visualElements": ["element1", "element2"],
      "emotion": "specific emotion targeted"
    }
  ],
```

> Hanya tambah satu field `"dialogue"` — jangan ubah yang lain.

---

## FEATURE 2 — backend/src/services/translatePromptService.js

### 2.1 — Update function signature

Cari:
```js
async function translateVideoPrompt({ videoAnalysis, userIntent, productName, productDescription = '', assetMode = 'product', characterPhotoBase64 = null, characterPhotoMime = 'image/jpeg' }) {
```

Tidak perlu ubah signature — sudah cukup. Lanjut ke prompt update.

### 2.2 — Tambah context transcript ke prompt GPT-4o

Setelah `const analysisStr = JSON.stringify({...}, null, 2);`, tambah:

```js
  // Build per-scene voiceover context from original analysis
  const originalScenes = Array.isArray(videoAnalysis.scenes) ? videoAnalysis.scenes : [];
  const scenesVoContext = originalScenes.length > 0
    ? originalScenes
        .map((s) => {
          const sceneNum = s.sceneNumber ?? '?';
          const dur = s.duration ?? '';
          const dialogue = (s.dialogue || '').trim();
          return dialogue
            ? `Scene ${sceneNum} (${dur}): "${dialogue}"`
            : `Scene ${sceneNum} (${dur}): [silent / no VO]`;
        })
        .join('\n')
    : (videoAnalysis.transcript ? `Full transcript: "${(videoAnalysis.transcript || '').slice(0, 600)}"` : 'No transcript available');
```

### 2.3 — Update user prompt content (tambah VO context + adapted VO output)

Cari bagian `content:` di dalam messages array yang berisi `WINNING AD DNA:`. Ganti seluruh content string itu dengan:

```js
content: `A winning ad video has been analyzed. You must adapt its creative DNA for a new product.

WINNING AD DNA:
${analysisStr}

ORIGINAL VOICEOVER / DIALOGUE (per scene):
${scenesVoContext}

USER INTENT:
"${userIntent}"

${assetMode === 'character'
  ? `CHARACTER NAME: ${productName}
${characterVisualDesc ? `CHARACTER APPEARANCE: ${characterVisualDesc}` : ''}
${productDescription ? `ADDITIONAL INFO: ${productDescription}` : ''}`
  : assetMode === 'none'
  ? 'ASSET: None — create a generic/conceptual video prompt without specific product or character'
  : `PRODUCT: ${productName}
${productDescription ? `PRODUCT DESCRIPTION: ${productDescription}` : ''}`
}

Your tasks:
1. Write a detailed 150-200 word video generation prompt (for GeminiGen grok-3) that:
   - Replicates the visual style, pacing, camera movement, and color palette of the winning ad
   - Adapts the content to showcase ${assetMode === 'character' ? `the character "${productName}"` : assetMode === 'none' ? 'the concept described in the user intent' : `"${productName}"`}
   - Incorporates the user's intent: "${userIntent}"
   - Includes specific cinematic details (shot types, lighting, transitions, music direction)

2. Write 3 hook variants (first 3 seconds) adapted from the winning ad's hook style.

3. Write a script outline adapted from the winning ad's structure.

4. Write an adapted voiceover script per scene — matching the NUMBER of scenes and timing from the original ad. Each scene gets its own VO line adapted to the new product/character/intent. Keep the same emotional arc and script structure as the original. Write in the SAME LANGUAGE as the original transcript (if original is Indonesian, write Indonesian; if English, write English).

Return ONLY valid JSON:
{
  "videoPrompt": "the full 150-200 word cinematic video prompt in English",
  "hookVariants": [
    "Hook variant 1 (adapt style from winning ad)",
    "Hook variant 2",
    "Hook variant 3"
  ],
  "scriptOutline": "step-by-step script outline: 1) hook, 2) problem, 3) solution, 4) CTA — adapted from winning ad structure",
  "adaptedVoiceover": [
    { "scene": 1, "duration": "0-10s", "voiceover": "adapted VO text for scene 1 in original language" },
    { "scene": 2, "duration": "10-20s", "voiceover": "adapted VO text for scene 2" },
    { "scene": 3, "duration": "20-30s", "voiceover": "adapted VO text for scene 3" }
  ]
}`,
```

### 2.4 — Update fallback return + parse

Cari fallback return:
```js
  return {
    videoPrompt: raw.slice(0, 400) || 'Video prompt generation failed.',
    hookVariants: [],
    scriptOutline: '',
  };
```

Ganti dengan:
```js
  return {
    videoPrompt: raw.slice(0, 400) || 'Video prompt generation failed.',
    hookVariants: [],
    scriptOutline: '',
    adaptedVoiceover: [],
  };
```

Cari try-parse block:
```js
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
  } catch (e) {
    console.warn('[translatePromptService] JSON parse failed:', e.message);
  }
```

Ganti dengan:
```js
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      // Ensure adaptedVoiceover is always an array
      if (!Array.isArray(parsed.adaptedVoiceover)) parsed.adaptedVoiceover = [];
      return parsed;
    }
  } catch (e) {
    console.warn('[translatePromptService] JSON parse failed:', e.message);
  }
```

---

## FEATURE 3 — frontend/lib/api.ts

### 3.1 — Update `translateVideoPrompt` return type

Cari:
```ts
}): Promise<{ videoPrompt: string; hookVariants: string[]; scriptOutline: string }> {
```

Ganti dengan:
```ts
}): Promise<{
  videoPrompt: string
  hookVariants: string[]
  scriptOutline: string
  adaptedVoiceover: Array<{ scene: number; duration: string; voiceover: string }>
}> {
```

---

## FEATURE 4 — frontend/app/(app)/scale-video/page.tsx

### 4.1 — Tambah state `adaptedVoiceover`

Setelah:
```ts
  const [scriptOutline, setScriptOutline] = useState('')
```

Tambah:
```ts
  const [adaptedVoiceover, setAdaptedVoiceover] = useState<Array<{ scene: number; duration: string; voiceover: string }>>([])
```

### 4.2 — Reset `adaptedVoiceover` saat analyze ulang

Di dalam `handleAnalyze`, setelah `setScriptOutline('')`, tambah:
```ts
      setAdaptedVoiceover([])
```

### 4.3 — Populate `adaptedVoiceover` setelah translate

Di dalam `handleTranslatePrompt`, setelah:
```ts
      setScriptOutline(result.scriptOutline || '')
```

Tambah:
```ts
      setAdaptedVoiceover(result.adaptedVoiceover || [])
```

### 4.4 — Tampilkan adapted voiceover di panel Refine Prompt

Cari blok `{scriptOutline && (` di dalam `{refinedPrompt && (...)}`  section. Setelah closing `)}` dari scriptOutline details block, dan SEBELUM `<div className="flex items-center gap-2 rounded-lg border border-emerald-200...">`, tambah:

```tsx
                        {adaptedVoiceover.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                              🎙 Adapted voiceover script:
                            </p>
                            <div className="space-y-1.5">
                              {adaptedVoiceover.map((item, i) => (
                                <div key={i} className="rounded border bg-background p-2.5 space-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-semibold bg-primary/10 text-primary rounded px-1.5 py-0.5">
                                      Scene {item.scene}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">{item.duration}</span>
                                  </div>
                                  <p className="text-xs leading-relaxed italic text-foreground">"{item.voiceover}"</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
```

---

---

## FEATURE 5 — Force Indonesian VO + Per-Scene Image Prompts

> **Tambahan ini di-append ke spec sebelumnya — kerjakan setelah Feature 1-4 selesai.**

### 5.1 — Force Indonesian di `translatePromptService.js`

Di dalam prompt GPT-4o (task #4 tentang voiceover), ubah kalimat bahasa:

Ganti:
```
Write in the SAME LANGUAGE as the original transcript (if original is Indonesian, write Indonesian; if English, write English).
```

Dengan:
```
ALWAYS write the voiceover in Bahasa Indonesia, regardless of the original language.
```

### 5.2 — Tambah `imagePrompt` per scene ke output GPT-4o

Update prompt GPT-4o di `translatePromptService.js` — ubah schema JSON return:

Ganti seluruh bagian `"adaptedVoiceover"` di dalam JSON schema prompt:
```
  "adaptedVoiceover": [
    { "scene": 1, "duration": "0-10s", "voiceover": "adapted VO text for scene 1 in original language" },
    { "scene": 2, "duration": "10-20s", "voiceover": "adapted VO text for scene 2" },
    { "scene": 3, "duration": "20-30s", "voiceover": "adapted VO text for scene 3" }
  ]
```

Ganti dengan:
```
  "adaptedScenes": [
    {
      "scene": 1,
      "duration": "0-10s",
      "voiceover": "teks VO bahasa Indonesia untuk scene 1 — adaptasi dari VO asli sesuai produk/karakter",
      "imagePrompt": "specific English image generation prompt for scene 1 — describe: subject, setting, action, lighting, color palette, visual style, camera angle. Match the visual aesthetic of the original ad but adapted for the new product/character. Under 120 words."
    },
    {
      "scene": 2,
      "duration": "10-20s",
      "voiceover": "teks VO bahasa Indonesia scene 2",
      "imagePrompt": "specific English image generation prompt for scene 2"
    },
    {
      "scene": 3,
      "duration": "20-30s",
      "voiceover": "teks VO bahasa Indonesia scene 3",
      "imagePrompt": "specific English image generation prompt for scene 3"
    }
  ]
```

> Ganti nama key `adaptedVoiceover` → `adaptedScenes` di SEMUA tempat di translatePromptService:
> fallback return, parse block, dan prompt content.

### 5.3 — Update `maxTokens` di translatePromptService

Cari:
```js
    maxTokens: 800,
```

Ganti dengan:
```js
    maxTokens: 1600,
```

---

## FEATURE 6 — backend/src/routes/scale-video.js: endpoint scene images

Tambah import di atas file (setelah import `translateVideoPrompt`):
```js
const { generateSceneImage } = require('../services/sceneImageService');
```

Tambah endpoint baru sebelum `module.exports = router`:

```js
/**
 * POST /api/scale-video/generate-scene-images
 * Generate one preview image per adapted scene using gpt-image-2.
 * Body: { adaptedScenes: [{ scene, duration, voiceover, imagePrompt }] }
 * Returns: { scenes: [{ scene, duration, voiceover, imagePrompt, imageUrl }] }
 */
router.post('/generate-scene-images', async (req, res) => {
  const { adaptedScenes } = req.body || {};
  if (!Array.isArray(adaptedScenes) || adaptedScenes.length === 0) {
    return res.status(400).json({ error: 'adaptedScenes array is required' });
  }

  // Generate images in parallel (max 5 concurrent)
  const results = await Promise.all(
    adaptedScenes.slice(0, 10).map(async (s) => {
      const imageUrl = s.imagePrompt
        ? await generateSceneImage(s.imagePrompt).catch(() => null)
        : null;
      return { ...s, imageUrl };
    })
  );

  res.json({ scenes: results });
});
```

---

## FEATURE 7 — frontend/lib/api.ts: new functions + updated types

### 7.1 — Update `translateVideoPrompt` return type

Ganti return type lama (`adaptedVoiceover: Array<...>`) dengan:
```ts
}): Promise<{
  videoPrompt: string
  hookVariants: string[]
  scriptOutline: string
  adaptedScenes: Array<{
    scene: number
    duration: string
    voiceover: string
    imagePrompt: string
  }>
}> {
```

### 7.2 — Tambah `generateSceneImages` function (setelah `translateVideoPrompt`)

```ts
export async function generateSceneImages(adaptedScenes: Array<{
  scene: number
  duration: string
  voiceover: string
  imagePrompt: string
}>): Promise<Array<{
  scene: number
  duration: string
  voiceover: string
  imagePrompt: string
  imageUrl: string | null
}>> {
  const res = await api.post('/scale-video/generate-scene-images', { adaptedScenes }, { timeout: 300000 })
  return res.data.scenes
}
```

### 7.3 — Update `generateScaleVideoJob` — remove `selectedAngles` requirement

`selectedAngles` tetap ada di payload type tapi optional. Tambah `adaptedScenes` sebagai optional:
```ts
  adaptedScenes?: Array<{ scene: number; duration: string; voiceover: string; imagePrompt: string; imageUrl?: string | null }>
```

---

## FEATURE 8 — frontend/app/(app)/scale-video/page.tsx

### 8.1 — Ganti state names (`adaptedVoiceover` → `adaptedScenes`)

Rename semua state dan variable:
- `adaptedVoiceover` → `adaptedScenes`
- Type: `Array<{ scene: number; duration: string; voiceover: string; imagePrompt: string; imageUrl?: string | null }>`

### 8.2 — Tambah state baru

```ts
const [generatingSceneImages, setGeneratingSceneImages] = useState(false)
```

### 8.3 — Update imports api.ts

Tambah `generateSceneImages` ke import list dari `@/lib/api`.

### 8.4 — Update `handleTranslatePrompt`

Setelah `setAdaptedScenes(result.adaptedScenes || [])`:

```ts
      // Auto-generate scene images in background
      if (result.adaptedScenes?.length > 0) {
        setGeneratingSceneImages(true)
        generateSceneImages(result.adaptedScenes)
          .then((scenes) => setAdaptedScenes(scenes))
          .catch((e) => console.warn('Scene image gen failed:', e.message))
          .finally(() => setGeneratingSceneImages(false))
      }
```

### 8.5 — Remove angle selector dari Step 2 Card

**Hapus** seluruh blok JSX berikut dari Step 2 Card:
```tsx
                {/* Angle selector */}
                {availableAngles.length > 0 && (
                  <div>
                    <Label className="mb-2 block">Pilih angle</Label>
                    <AngleSelector
                      angles={availableAngles}
                      selected={selectedAngles}
                      onChange={setSelectedAngles}
                    />
                  </div>
                )}
```

**Update** tombol Generate — hapus reference ke `selectedAngles.length`:
```tsx
                <Button
                  className="w-full"
                  onClick={handleGenerate}
                  disabled={generating || !videoAnalysis}
                >
                  {generating ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Generating video… (bisa 5-10 menit)</>
                  ) : (
                    <><Video className="h-4 w-4" /> Generate Video</>
                  )}
                </Button>
```

### 8.6 — Update `handleGenerate` — pakai scene image prompts

Dalam `handleGenerate`, ubah `selectedAngles` menjadi auto-select semua angles yang tersedia:
```ts
      const resp = await generateScaleVideoJob({
        videoAnalysis,
        productName,
        productDescription,
        selectedAngles: availableAngles.map((a) => a.key),   // auto-select all
        aspectRatio,
        productPhotoBase64,
        productPhotoMime,
        characterPhotosBase64,
        assetMode,
        customVideoPrompt: refinedPrompt || undefined,
        adaptedScenes: adaptedScenes.length > 0 ? adaptedScenes : undefined,
      })
```

### 8.7 — Update `handleTranslatePrompt` guard: tidak wajib produk

Pastikan guard di `handleTranslatePrompt` tidak require `selectedProduct`:
```ts
    if (!userIntent.trim() || !videoAnalysis) return
```
(sudah benar dari spec sebelumnya — pastikan tidak berubah)

### 8.8 — Ganti render `adaptedVoiceover` → render storyboard `adaptedScenes`

Cari blok render `adaptedVoiceover.length > 0` (dari Feature 4.4 sebelumnya) dan GANTI SELURUHNYA dengan storyboard display berikut:

```tsx
                        {adaptedScenes.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                              🎬 Storyboard per scene
                              {generatingSceneImages && (
                                <span className="flex items-center gap-1 text-[10px] text-primary">
                                  <Loader2 className="h-2.5 w-2.5 animate-spin" /> generating images…
                                </span>
                              )}
                            </p>
                            <div className="space-y-2">
                              {adaptedScenes.map((item, i) => (
                                <div key={i} className="rounded-lg border bg-background overflow-hidden">
                                  {/* Scene image */}
                                  <div className="relative aspect-video bg-muted flex items-center justify-center">
                                    {item.imageUrl ? (
                                      <img
                                        src={item.imageUrl}
                                        alt={`Scene ${item.scene}`}
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <div className="flex flex-col items-center gap-1 text-muted-foreground">
                                        {generatingSceneImages
                                          ? <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                          : <ImageIcon className="h-5 w-5 opacity-30" />
                                        }
                                        <span className="text-[10px]">
                                          {generatingSceneImages ? 'Generating…' : 'No image'}
                                        </span>
                                      </div>
                                    )}
                                    <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
                                      <span className="text-[10px] font-semibold bg-primary text-primary-foreground rounded px-1.5 py-0.5">
                                        Scene {item.scene}
                                      </span>
                                      <span className="text-[10px] bg-black/50 text-white rounded px-1.5 py-0.5">
                                        {item.duration}
                                      </span>
                                    </div>
                                  </div>
                                  {/* VO + prompt */}
                                  <div className="p-2.5 space-y-1.5">
                                    <p className="text-xs leading-relaxed italic text-foreground">
                                      🎙 "{item.voiceover}"
                                    </p>
                                    {item.imagePrompt && (
                                      <details>
                                        <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">
                                          Lihat image prompt
                                        </summary>
                                        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground bg-muted rounded p-1.5">
                                          {item.imagePrompt}
                                        </p>
                                      </details>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
```

> **PENTING**: Import `ImageIcon` dari lucide-react jika belum ada di import list.

---

## AUDIT LOOP (WAJIB — ulangi sampai 0 error)

```bash
# 1. Node syntax check backend
node --check "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/backend/src/services/videoUrlAnalyzer.js"
node --check "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/backend/src/services/translatePromptService.js"
node --check "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/backend/src/routes/scale-video.js"

# 2. TypeScript — 0 errors
cd "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/frontend"
npx tsc --noEmit 2>&1 | grep "error TS"
# → must be empty

# 3. Verify dialogue field in Gemini prompt
grep -n '"dialogue"' "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/backend/src/services/videoUrlAnalyzer.js"
# → 1 result inside buildGeminiPrompt

# 4. Verify adaptedScenes in translatePromptService
grep -n "adaptedScenes" "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/backend/src/services/translatePromptService.js"
# → appears in: JSON schema prompt, parse block, fallback return

# 5. Verify Indonesian VO instruction
grep -n "Bahasa Indonesia" "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/backend/src/services/translatePromptService.js"
# → 1 result

# 6. Verify generate-scene-images endpoint
grep -n "generate-scene-images" "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/backend/src/routes/scale-video.js"
# → 1 result (router.post)

# 7. Verify generateSceneImages in api.ts
grep -n "generateSceneImages\|adaptedScenes" "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/frontend/lib/api.ts"
# → both present

# 8. Verify AngleSelector removed from page.tsx
grep -n "AngleSelector\|availableAngles.*length.*0\|Pilih angle" "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/frontend/app/(app)/scale-video/page.tsx"
# → AngleSelector must NOT appear in JSX (only import line or removed entirely)
# → "Pilih angle" label must NOT appear

# 9. Verify storyboard display in page.tsx
grep -n "adaptedScenes\|generatingSceneImages\|storyboard\|imageUrl\|ImageIcon" "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/frontend/app/(app)/scale-video/page.tsx"
# → all present

# 10. Verify Generate button no longer depends on selectedAngles.length
grep -n "selectedAngles.length" "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/frontend/app/(app)/scale-video/page.tsx"
# → must NOT appear in disabled condition of Generate button

# 11. Fix any error → restart from step 1
```

---

---

## FEATURE 9 — Live System Log: Pengembangan Phase Events

> Tambahkan phase events yang lebih granular di seluruh pipeline agar user bisa
> melihat progress secara real-time. Semua perubahan di sisi backend (onProgress calls)
> dan frontend (rendering log).

### 9.1 — `videoUrlAnalyzer.js`: tambah phase events granular

Tambah `onProgress` calls di titik-titik kritis yang belum punya event:

```js
// Di dalam analyzeVideoFromUrl, setelah menentukan platform:
onProgress({ phase: 'platform_detected', message: `Platform terdeteksi: ${platform.toUpperCase()}` });

// Sebelum yt-dlp download:
onProgress({ phase: 'downloading', message: 'Mendownload video via yt-dlp…' });

// Setelah download selesai, sebelum ffmpeg compress:
onProgress({ phase: 'download_done', message: `Download selesai — ${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB` });

// Sebelum ffmpeg compress:
onProgress({ phase: 'compressing', message: 'Mengompresi video untuk Gemini…' });

// Setelah ffmpeg selesai:
onProgress({ phase: 'compress_done', message: `Kompresi selesai — siap dikirim ke Gemini` });

// Sebelum Gemini call:
onProgress({ phase: 'gemini_call', message: 'Mengirim ke Gemini 2.5 Flash untuk analisis…' });

// Setelah Gemini return (sebelum parse):
onProgress({ phase: 'gemini_done', message: 'Gemini selesai — parsing hasil…' });

// Setelah JSON parse berhasil:
onProgress({ phase: 'parse_done', message: `Analisis selesai: ${analysis.scenes?.length ?? 0} scene terdeteksi` });
```

> Phase-phase yang sudah ada (`start`, `gemini_error`, `gemini_empty`, `finalizing`) tidak diubah.

### 9.2 — `scale-video.js` route `/analyze-from-url`: tambah phase events polling

Di dalam background async IIFE (job runner), pastikan `onProgress` sudah dipanggil dari
`analyzeVideoFromUrl` — tidak perlu tambahan di route karena analyzer sudah handle lewat callback.

Tapi tambah satu event eksplisit saat job selesai sukses:

```js
// Setelah job.result = {...}:
onProgress({ phase: 'done', message: `✅ Analisis selesai — ${job.result.framesAnalyzed ?? 0} frame dianalisis` });
job.status = 'done';
```

### 9.3 — `page.tsx`: warna + label per phase di Live System Log

Update mapping warna phase di render log. Cari fungsi/object `phaseColor` atau inline className
yang menentukan warna badge log, lalu ganti/update dengan mapping lengkap:

```ts
const PHASE_COLOR: Record<string, string> = {
  start:            'bg-blue-100 text-blue-700',
  platform_detected:'bg-indigo-100 text-indigo-700',
  downloading:      'bg-yellow-100 text-yellow-800',
  download_done:    'bg-yellow-200 text-yellow-900',
  compressing:      'bg-orange-100 text-orange-700',
  compress_done:    'bg-orange-200 text-orange-900',
  gemini_call:      'bg-purple-100 text-purple-700',
  gemini_done:      'bg-purple-200 text-purple-900',
  parse_done:       'bg-green-100 text-green-700',
  finalizing:       'bg-green-200 text-green-900',
  done:             'bg-emerald-100 text-emerald-700',
  gemini_error:     'bg-red-100 text-red-700',
  gemini_empty:     'bg-red-100 text-red-700',
  error:            'bg-red-200 text-red-800',
};

// Fallback:
const color = PHASE_COLOR[event.phase] ?? 'bg-gray-100 text-gray-600';
```

### 9.4 — `page.tsx`: auto-scroll log ke bawah saat ada event baru

Tambah `useRef` untuk log container dan auto-scroll effect:

```ts
const logEndRef = useRef<HTMLDivElement>(null)

// Di dalam useEffect yang watch systemLog (atau setelah setiap setSystemLog):
useEffect(() => {
  logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
}, [systemLog])
```

Di JSX, di dalam log container `<div className="...overflow-y-auto...">`, tambah di akhir list:

```tsx
<div ref={logEndRef} />
```

### 9.5 — `page.tsx`: tampilkan timestamp relatif di setiap log entry

Setiap log entry dari polling sudah punya field `ts` (Unix ms). Tampilkan sebagai `+Xs` relatif
dari awal job:

```ts
// Di dalam log render, hitung offset dari log[0].ts:
const startTs = systemLog[0]?.ts ?? Date.now()
// ...
<span className="text-[9px] text-muted-foreground font-mono ml-auto">
  +{((entry.ts - startTs) / 1000).toFixed(1)}s
</span>
```

### 9.6 — AUDIT untuk Feature 9

```bash
# Verify phase events ada di analyzer
grep -n "phase:" "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/backend/src/services/videoUrlAnalyzer.js" | head -20
# → harus ada: start, platform_detected, downloading, compressing, gemini_call, gemini_done, parse_done, finalizing

# Verify PHASE_COLOR di page.tsx
grep -n "PHASE_COLOR\|phaseColor\|platform_detected\|download_done" "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/frontend/app/(app)/scale-video/page.tsx"
# → harus ada

# Verify logEndRef
grep -n "logEndRef" "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/frontend/app/(app)/scale-video/page.tsx"
# → harus ada useRef + scrollIntoView
```

---

## FEATURE 10 — Cleanup: Delete Temp Video Files Setelah FFmpeg Merge

> Setelah FFmpeg berhasil merge scene clips menjadi video final, hapus semua file sumber
> dan folder temp agar tidak menumpuk di server Railway.

### 10.1 — Identifikasi lokasi merge di backend

File: `backend/src/services/videoRemakeService.js`

Cari pola ini — bagian setelah FFmpeg concat/merge berhasil:
```js
// Sesuatu seperti:
await runFfmpeg([...]);
// atau:
execSync(`ffmpeg ... ${outputPath}`);
```

### 10.2 — Tambah cleanup setelah merge sukses

Setelah FFmpeg merge command berhasil (tidak throw), tambah cleanup block:

```js
// ── Cleanup: hapus source clips + temp dir setelah merge sukses ──────────
const { rm } = require('fs/promises');

// Hapus file-file individual clip (array of paths yang di-concat FFmpeg)
if (Array.isArray(clipPaths) && clipPaths.length > 0) {
  await Promise.allSettled(
    clipPaths.map((p) => rm(p, { force: true }))
  );
}

// Hapus temp concat list file jika ada (file txt berisi daftar clip)
if (concatListPath) {
  await rm(concatListPath, { force: true }).catch(() => {});
}

// Hapus source video yang di-upload user (sudah tidak diperlukan)
if (sourceVideoPath) {
  await rm(sourceVideoPath, { force: true }).catch(() => {});
}

// Hapus temp directory jika sudah kosong
if (tempDir) {
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});
}
// ─────────────────────────────────────────────────────────────────────────
```

> Gunakan `Promise.allSettled` bukan `Promise.all` agar satu file yang gagal dihapus
> tidak crash seluruh cleanup.

> Jika nama variable untuk paths berbeda (bukan `clipPaths`, `concatListPath`, dll),
> sesuaikan dengan nama actual di videoRemakeService.js setelah membacanya terlebih dulu.

### 10.3 — Cleanup juga di `analyze` route (upload file)

Di `POST /api/scale-video/analyze`, source file sudah dihapus setelah analisis:
```js
fs.unlink(req.file.path, () => {});
```
Ini sudah benar — tidak perlu diubah.

### 10.4 — Cleanup juga di `videoUrlAnalyzer.js` (yt-dlp download)

Setelah `analyzeVideoFromUrl` selesai (sukses atau error), pastikan file yang di-download
yt-dlp dihapus. Cari pola:

```js
// Di dalam finally block atau setelah Gemini call:
if (downloadedFilePath) {
  fs.unlink(downloadedFilePath, () => {});
}
// Dan compressed file jika ada:
if (compressedFilePath && compressedFilePath !== downloadedFilePath) {
  fs.unlink(compressedFilePath, () => {});
}
```

> Pastikan cleanup ada di `finally` block agar file dihapus meskipun Gemini throw error.

### 10.5 — Log cleanup di system log

Di dalam videoRemakeService.js, setelah cleanup selesai, emit ke job log:

```js
job.log.push({ ts: Date.now(), phase: 'cleanup', message: `🧹 File sumber dihapus (${clipPaths?.length ?? 0} clips + temp dir)` });
```

### 10.6 — AUDIT untuk Feature 10

```bash
# Verify cleanup di videoRemakeService
grep -n "rm\|unlink\|cleanup\|Cleanup" "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/backend/src/services/videoRemakeService.js" | head -20
# → harus ada cleanup setelah FFmpeg merge

# Verify cleanup di videoUrlAnalyzer (yt-dlp temp files)
grep -n "unlink\|rm\|cleanup\|finally" "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/backend/src/services/videoUrlAnalyzer.js" | head -20
# → harus ada unlink di finally block

# Node syntax check
node --check "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/backend/src/services/videoRemakeService.js"
node --check "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/backend/src/services/videoUrlAnalyzer.js"
```

---

## COMMIT + DEPLOY

```bash
cd "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator"
git add -A
git commit -m "feat: Indonesian VO, scene storyboard + image gen, remove angle selector, scene-driven generate flow, live log improvements, temp file cleanup after merge"
git push origin main
railway up --detach
```
