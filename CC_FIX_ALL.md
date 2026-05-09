# CC Prompt — Full Video Fix + Audit

Project root: `/Users/siscaliman/Documents/Claude/Projects/Ads creative generator`

## Aturan utama

- **Semua video generation → GeminiGen `grok-3`** (kecuali Video Remake = doubao via apimart, JANGAN disentuh)
- **Semua image generation → apimart `gpt-image-2`** (sudah benar, jangan disentuh)
- Frontend harus tetap TypeScript-clean: `npx tsc --noEmit` = 0 error setelah semua fix
- Jangan modifikasi: `geminiGenService.js`, `videoRemakeService.js`, `routes/reels.js`, `reelsGenerator.js`

---

## GeminiGen — referensi cepat (jangan modif filenya)

```js
// backend/src/services/geminiGenService.js exports:
const { generateFirstClip, extendClip, pollUntilComplete } = require('./geminiGenService')

// generateFirstClip({ prompt, mode, imageUrls[], aspectRatio, resolution, clipDuration })
//   → { uuid }   — async job, belum ada result

// pollUntilComplete(uuid, onProgress?)
//   → { uuid, videoUrl, thumbnailUrl }   — resolved setelah video selesai
//   → throw Error jika gagal / timeout

// Aspect ratio: 'portrait'(9:16) | 'landscape'(16:9) | 'square'(1:1) | 'vertical'(2:3) | 'horizontal'(3:2)
// Resolution : '480p' | '720p'
// Duration   : 6 | 10 | 15  (integer detik)
// Mode       : 'normal' | 'extremely-crazy' | 'extremely-spicy-or-crazy' | 'custom'
```

**Helper aspect ratio** — tambahkan ke setiap file yang perlu:
```js
function toGeminiAR(ar) {
  return { '9:16': 'portrait', '16:9': 'landscape', '1:1': 'square', '4:5': 'portrait', '2:3': 'vertical', '3:2': 'horizontal' }[ar] || 'portrait'
}
```

---

## Fix 1 — `backend/src/config/index.js`

Hapus baris ini (video gen tidak lagi lewat apimart):
```js
video: process.env.VIDEO_MODEL || 'kling-v2-6',
```
Baris `remake: process.env.REMAKE_MODEL || 'doubao-seedance-2-0'` **tetap ada**.

---

## Fix 2 — `backend/src/services/scalingService.js`

### 2a. Update import baris 1

Dari:
```js
const { analyzeImage, chatCompletion, generateImage, generateVideo, getTask, uploadImageToApimart, submitImageJobPayload, GPT_IMAGE_SIZE_MAP } = require('./apimart');
```
Ke (hapus `generateVideo` dan `getTask`):
```js
const { analyzeImage, chatCompletion, generateImage, uploadImageToApimart, submitImageJobPayload, GPT_IMAGE_SIZE_MAP } = require('./apimart');
const { generateFirstClip, pollUntilComplete } = require('./geminiGenService');
```

### 2b. Ganti seluruh fungsi `batchGenerateVideos`

Cari fungsi ini (sekitar baris 1200) dan ganti seluruh isinya:
```js
// ─── batchGenerateVideos ──────────────────────────────────────────────────────
// Uses GeminiGen grok-3. Mirrors batchGenerateImages — submits all jobs in
// parallel then polls until each is done (or times out at 5 min).
// productImageUrl: when provided, passed as file_urls[] for image-to-video accuracy.

function toGeminiAR(ar) {
  return { '9:16': 'portrait', '16:9': 'landscape', '1:1': 'square', '4:5': 'portrait', '2:3': 'vertical' }[ar] || 'portrait'
}

async function batchGenerateVideos(variations, aspectRatio = '9:16', productImageUrl = null) {
  const geminiAR = toGeminiAR(aspectRatio)

  const results = await Promise.allSettled(
    variations.map(async (v) => {
      if (!v.imagePrompt) return { ...v, videoUrl: null, videoError: 'No prompt generated' }
      try {
        const imageUrls = productImageUrl ? [productImageUrl] : []
        const { uuid } = await generateFirstClip({
          prompt: v.imagePrompt,
          mode: 'normal',
          imageUrls,
          aspectRatio: geminiAR,
          resolution: '720p',
          clipDuration: 10,
        })
        console.log(`[batchGenerateVideos] GeminiGen job: ${uuid}`)
        const { videoUrl } = await pollUntilComplete(uuid)
        return { ...v, videoUrl: videoUrl || null, videoError: videoUrl ? null : 'Completed but no URL' }
      } catch (e) {
        return { ...v, videoUrl: null, videoError: e.message }
      }
    })
  )

  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { ...variations[i], videoUrl: null, videoError: 'Unexpected error' }
  )
}
```

---

## Fix 3 — `backend/src/routes/generate.js`

### 3a. Update import baris 5

Dari:
```js
const { generateImage, generateVideo, checkVideoStatus } = require('../services/apimart');
```
Ke:
```js
const { generateImage } = require('../services/apimart');
const { generateFirstClip, pollUntilComplete } = require('../services/geminiGenService');
```

### 3b. Ganti POST `/video` endpoint (~baris 100–110)

```js
router.post('/video', async (req, res) => {
  const { prompt, aspectRatio = '9:16', duration = 10 } = req.body
  if (!prompt) return res.status(400).json({ error: 'prompt is required' })

  const arMap = { '9:16': 'portrait', '16:9': 'landscape', '1:1': 'square' }
  const { uuid } = await generateFirstClip({
    prompt,
    mode: 'normal',
    aspectRatio: arMap[aspectRatio] || 'portrait',
    resolution: '720p',
    clipDuration: typeof duration === 'number' ? duration : parseInt(duration) || 10,
  })
  const { videoUrl, thumbnailUrl } = await pollUntilComplete(uuid)
  res.json({ uuid, videoUrl, thumbnailUrl })
})
```

### 3c. Ganti GET `/video/:taskId` endpoint (~baris 116–120)

```js
router.get('/video/:taskId', async (req, res) => {
  const { taskId } = req.params
  try {
    const axios = require('axios')
    const { data } = await axios.get(`https://api.geminigen.ai/uapi/v1/history/${taskId}`, {
      headers: { 'x-api-key': process.env.GEMINIGEN_API_KEY || '' },
      timeout: 10000,
    })
    const videoUrl = data.generated_video?.[0]?.video_url || null
    res.json({
      uuid: taskId,
      status: data.status === 2 ? 'completed' : data.status === 3 ? 'failed' : 'processing',
      videoUrl,
      progress: data.status_percentage || 0,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})
```

---

## Fix 4 — `backend/src/routes/create.js`

### 4a. Update import baris 12

Dari:
```js
const { generateImage, generateVideo } = require('../services/apimart');
```
Ke:
```js
const { generateImage } = require('../services/apimart');
const { generateFirstClip, pollUntilComplete } = require('../services/geminiGenService');
```

### 4b. Ganti blok `outputType === 'video'` (~baris 106–112)

Dari:
```js
} else if (outputType === 'video') {
  try {
    const videoResult = await generateVideo({ prompt: imagePrompt, aspectRatio: format, duration: 5 });
    videoJobId = videoResult.id || videoResult.taskId || null;
  } catch (err) {
    console.error('Video generation failed:', err.message);
  }
}
```
Ke:
```js
} else if (outputType === 'video') {
  try {
    const arMap = { '9:16': 'portrait', '16:9': 'landscape', '1:1': 'square', '4:5': 'portrait' }
    const { uuid } = await generateFirstClip({
      prompt: imagePrompt,
      mode: 'normal',
      aspectRatio: arMap[format] || 'portrait',
      resolution: '720p',
      clipDuration: 10,
    })
    const result = await pollUntilComplete(uuid)
    videoJobId = result.videoUrl || null  // reuse videoJobId field — frontend reads it as videoUrl
  } catch (err) {
    console.error('Video generation failed:', err.message)
  }
}
```

**Catatan**: field `videoJobId` di response create tetap dipakai untuk backward compat dengan AdCard. Nanti fix AdCard di bagian Frontend.

---

## Fix 5 — `backend/src/routes/scale.js`

### 5a. Update import baris 14

Dari:
```js
const { analyzeImage, uploadImageToApimart, generateImage, generateVideo, chatCompletion } = require('../services/apimart');
```
Ke (hapus `generateVideo`):
```js
const { analyzeImage, uploadImageToApimart, generateImage, chatCompletion } = require('../services/apimart');
const { generateFirstClip, pollUntilComplete } = require('../services/geminiGenService');
```

### 5b. Ganti endpoint `/generate-video` (~baris 412–417)

Dari:
```js
router.post('/generate-video', async (req, res) => {
  const { prompt, aspectRatio = '9:16', duration = 5 } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  const result = await generateVideo({ prompt, aspectRatio, duration });
  res.json(result);
});
```
Ke:
```js
router.post('/generate-video', async (req, res) => {
  const { prompt, aspectRatio = '9:16', duration = 10 } = req.body
  if (!prompt) return res.status(400).json({ error: 'prompt is required' })
  const arMap = { '9:16': 'portrait', '16:9': 'landscape', '1:1': 'square' }
  const { uuid } = await generateFirstClip({
    prompt,
    mode: 'normal',
    aspectRatio: arMap[aspectRatio] || 'portrait',
    resolution: '720p',
    clipDuration: typeof duration === 'number' ? duration : parseInt(duration) || 10,
  })
  const { videoUrl, thumbnailUrl } = await pollUntilComplete(uuid)
  res.json({ uuid, videoUrl, thumbnailUrl })
})
```

---

## Fix 6 — `backend/src/routes/scale-video.js`

### 6a. Update import baris 12

Dari:
```js
const { analyzeImage, uploadImageToApimart, getTask } = require('../services/apimart');
```
Ke (hapus `getTask`, tambah axios untuk GeminiGen history):
```js
const axios = require('axios');
const { analyzeImage, uploadImageToApimart } = require('../services/apimart');
```

### 6b. Fix komentar kling → GeminiGen

Update semua komentar yang menyebut "kling-v2-6" atau "kling":
- Baris 44: `* Generate angle variations as 10-second kling-v2-6 videos.` → `* Generate angle variations as 10-second GeminiGen grok-3 videos.`
- Baris 76: `// Step 2: Upload product photo as image-to-video reference for kling` → `// Step 2: Upload product photo as image-to-video reference for GeminiGen`
- Baris 81: log `'Product photo uploaded for kling:'` → `'Product photo uploaded for GeminiGen:'`
- Baris 110: `// Step 5: Batch generate 10-second kling-v2-6 videos for every variation` → `// Step 5: Batch generate 10-second GeminiGen grok-3 videos for every variation`

### 6c. Ganti GET `/status/:taskId` endpoint (~baris 126–158)

Endpoint ini sekarang poll GeminiGen history bukan apimart:
```js
router.get('/status/:taskId', async (req, res) => {
  const { taskId } = req.params
  try {
    const { data } = await axios.get(`https://api.geminigen.ai/uapi/v1/history/${taskId}`, {
      headers: { 'x-api-key': process.env.GEMINIGEN_API_KEY || '' },
      timeout: 10000,
    })
    const videoUrl = data.generated_video?.[0]?.video_url || null
    const status = data.status === 2 ? 'completed' : data.status === 3 ? 'failed' : 'processing'
    res.json({ taskId, status, videoUrl, progress: data.status_percentage || 0 })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})
```

---

## Fix 7 — `backend/src/services/singleImageWorker.js`

Cari baris ~107:
```js
apiUsed: 'apimart/dall-e-3',
```
Ganti dengan:
```js
apiUsed: 'apimart/gpt-image-2',
```

---

## Fix 8 — `backend/src/services/referenceService.js`

Baris 1 ada import `generateVideo` yang tidak dipakai. Grep dulu:
```bash
grep -n "generateVideo" backend/src/services/referenceService.js
```
Kalau `generateVideo` hanya ada di import dan tidak dipanggil di body file, hapus dari import.

---

## Fix 9 — Frontend: `frontend/components/ads/AdCard.tsx`

### 9a. Update `AdCardData` interface

Cari:
```ts
videoJobId?: string | null
```
Ganti dengan:
```ts
videoUrl?: string | null
```

### 9b. Update render logic

Cari blok (~baris 201–207):
```tsx
) : data.videoJobId ? (
  <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
    <Badge variant="secondary">Video Job</Badge>
    <p className="font-mono break-all">{data.videoJobId}</p>
    <p>Cek status di apimart.ai dashboard</p>
  </div>
```
Ganti dengan:
```tsx
) : data.videoUrl ? (
  <video
    src={data.videoUrl}
    controls
    className="h-full w-full object-cover"
    playsInline
  />
```

---

## Fix 10 — Frontend: `frontend/app/(app)/create/page.tsx`

Cari (~baris 482):
```tsx
videoJobId: r.videoJobId,
```
Ganti dengan:
```tsx
videoUrl: r.videoJobId,  // backend reuses videoJobId field to carry the URL
```

---

## Fix 11 — Frontend: `frontend/lib/api.ts`

Cari `ScaleVideoJobResponse` interface, pastikan field `videoUrl` sudah ada di `variations[]`. Kalau belum ada, tambahin. Interface sekarang ada `videoUrl: string | null` per variation — cek baris sekitar 384–404, update jika perlu.

Juga update komentar di `generateScaleVideoJob` yang mungkin masih menyebut "kling".

---

## Verifikasi setelah semua fix

### 1. Grep: zero kling references di routes/services
```bash
grep -rn "kling" backend/src/routes/ backend/src/services/ --include="*.js"
```
Expected: 0 hasil (boleh ada di comment yang sudah diupdate menjadi konteks historis).

### 2. Grep: generateVideo tidak dipanggil di tempat yang salah
```bash
grep -rn "generateVideo\b" backend/src/routes/ backend/src/services/ --include="*.js"
```
Expected: hanya muncul di `apimart.js` (definisi) dan `videoRemakeService.js` (pemanggil resmi).

### 3. TypeScript check
```bash
cd frontend && npx tsc --noEmit
```
Expected: 0 error. Kalau ada error, perbaiki dulu sebelum commit.

### 4. Git commit (pakai workaround lock file FUSE)
```python
# Jalankan python3 -c "..." ini sebelum git add kalau ada lock file
import os
for f in ['.git/index.lock', '.git/HEAD.lock']:
    try: os.rename(f, f + '.bak')
    except: pass
```
Lalu:
```bash
git add -A
git commit -m "fix: all video generation switched to GeminiGen grok-3, fix AdCard videoUrl"
git push origin main
```

### 5. Deploy Railway
```bash
railway up --detach
```
Atau kalau CLI tidak tersedia, trigger redeploy via `railway redeploy`.

### 6. Self-audit pasca deploy

Cek setiap fitur video dengan test call ke backend:
- `POST /api/scale-video/generate` → variations[].videoUrl harus berisi URL video GeminiGen
- `POST /api/create/generate` (outputType=video) → results[].videoJobId harus berisi URL video GeminiGen
- `POST /api/generate/video` → response harus punya `videoUrl`
- `POST /api/scale/generate-video` → response harus punya `videoUrl`
- `POST /api/reels/*` → unchanged, masih GeminiGen ✅
- `POST /api/scale-video/remake` → unchanged, masih doubao via apimart ✅

---

## Yang TIDAK boleh disentuh

| File | Alasan |
|------|--------|
| `services/geminiGenService.js` | Sudah benar, ini canonical reference |
| `services/videoRemakeService.js` | Pakai doubao-seedance-2-0 via apimart — benar |
| `routes/reels.js` + `reelsGenerator.js` | Sudah pakai GeminiGen dengan benar |
| Semua image generation | Sudah pakai apimart gpt-image-2 dengan benar |
| `config.models.remake` | Harus tetap `doubao-seedance-2-0` |
