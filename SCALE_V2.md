# SCALE_V2.md — Scale Winning: Full Rebuild + Video Feature

## Filosofi Utama

**"Lihat iklan orang bagus → copas konsep → ganti produk sendiri → generate"**

User tidak perlu mikir prompt, angle, atau copy. Cukup:
1. Upload iklan winning (image atau video)
2. Pilih produk tersimpan
3. Klik generate

AI yang kerja: analisis mendalam → translate ke prompt detail → adaptasi ke produk user → generate output.

**Prinsip: seminimal mungkin input, semaksimal mungkin output.**

---

## Root Cause: Kenapa Output Masih Generik

**Pipeline lama (SALAH):**
```
Analyze winning ad → extract "angle type" (fomo/price_anchor/dll) → 
generate copy dengan angle standar + nama produk
```
Hasilnya generik karena angle-nya **lepas dari konteks winning ad**.

**Pipeline baru (BENAR) — Concept Translation:**
```
Analyze winning ad → extract CORE HOOK MECHANISM secara mendalam →
translate hook ke konteks produk user →
generate image yang SAMA komposisinya tapi relevan ke produk
```

**Contoh nyata:**
- Winning ad: "Orang frustrasi di meja kerja, dikelilingi kertas, laptop, kalkulator — masalahnya dia nggak tau angka bisnisnya sendiri"
- Core hook: *Orang yang sudah lama melakukan sesuatu tapi ternyata melakukan kesalahan mendasar tanpa sadar → shock/realization moment*
- Translated ke diabetes lotion: *Orang yang sudah lama pakai skincare biasa tapi kulitnya tetap kering/retak — ternyata kulit diabetik butuh perawatan khusus yang selama ini diabaikan*
- Image direction: *Sama — wanita distressed, close-up ekspresi khawatir, melihat tangannya/kulitnya yang kering, ada lotion di sekitarnya*

**Yang harus berubah:** `analyzeWinningAd` harus extract hook mechanism, bukan cuma angle label. `generateVariationPrompts` harus translate hook secara spesifik ke produk, bukan apply angle template.

---

## Apa yang Difix & Dibangun

### FIX (bug aktif)
- [ ] Pipeline AI diubah dari "angle selection" ke "concept translation"
- [ ] analyzeWinningAd: extract 7 dimensi mendalam (lihat Task 2)
- [ ] generateVariationPrompts: translate concept ke produk, bukan apply template
- [ ] Bahasa output selalu Indonesia
- [ ] Foto produk → upload → flux-kontext-pro (real image reference)

### BARU
- [ ] Carousel option setelah image generation
- [ ] Menu baru: Scale Winning Video

---

## VERIFIED API CAPABILITIES (tested live)

Dari testing langsung ke `api.apimart.ai`:

### Image models tersedia:
- `flux-kontext-pro` — **UTAMA untuk product reference**. Menerima `image_url` parameter, maintains visual consistency dengan reference image.
- `flux-kontext-max` — versi lebih powerful dari kontext-pro
- `flux-2-pro`, `flux-2-flex` — text-to-image standar (tanpa reference)
- `gpt-image-1`, `gpt-image-1-mini` — OpenAI compat
- `imagen-4.0-apimart` — Google Imagen

### Upload endpoint:
```
POST https://api.apimart.ai/v1/uploads/images
Content-Type: multipart/form-data
field: file (binary image)
Response: { url: "https://..." }
```

### Flux Kontext dengan reference image:
```json
POST https://api.apimart.ai/v1/images/generations
{
  "model": "flux-kontext-pro",
  "prompt": "...",
  "image_url": "https://uploaded-product-url.jpg",
  "n": 1
}
→ Returns: { data: [{ status: "submitted", task_id: "..." }] }
```

**Ini kuncinya**: produk foto di-upload dulu → dapat URL → pass ke flux-kontext-pro → AI generate dengan visual reference produk yang akurat.

---

## TASK 2 — Rewrite AI Pipeline: Concept Translation (PALING PENTING)

### Masalah di scalingService.js saat ini:
1. `analyzeWinningAd` hanya extract surface info (color, angle label, visual style)
2. `generateScalingAngles` apply template angle standar (fomo/price_anchor) tanpa reference ke concept winning ad
3. `generateVariationPrompt` copy visual style tapi tidak translate narrative/scenario

### Fix: Rewrite semua 3 fungsi AI prompt di backend/src/services/scalingService.js

#### 2a. Rewrite analyzeWinningAd — extract 7 dimensi concept

Ganti `analysisPrompt` dengan ini:

```
Kamu adalah Meta Ads creative strategist kelas dunia. Analisis iklan ini secara SANGAT MENDALAM.
Tujuan: ekstrak "DNA" dari iklan ini sehingga konsepnya bisa direplikasi untuk produk berbeda.

Analisis 7 dimensi berikut, return dalam format JSON valid:

1. HUMAN_SCENARIO: Skenario manusia spesifik yang digambarkan. Bukan "orang pakai produk" tapi detail situasinya — siapa orangnya, sedang apa, ada di mana, apa yang terjadi. Ini yang membuat orang berhenti scroll karena merasa "ini tentang aku".

2. EMOTIONAL_TRUTH: Kebenaran emosional universal yang disentuh. Rasa takut, malu, harapan, atau keinginan spesifik apa? Bukan emosi generik, tapi yang sangat spesifik ke situasi yang ditampilkan.

3. HOOK_MECHANISM: Bagaimana tepatnya iklan ini "mencuri" perhatian di 1-3 detik pertama? Apa element pertama yang mata lihat? Mengapa itu bikin penasaran atau berhenti scroll?

4. NARRATIVE_STRUCTURE: Alur cerita/pesan: Setup (situasi masalah) → Tension (kenapa ini penting/menyakitkan) → Resolution (solusi/harapan). Deskripsikan tiap tahap secara spesifik.

5. VISUAL_STORY: Objek-objek, ekspresi, setting spesifik yang "menceritakan" pesan tanpa kata. Apa yang ada di frame dan kenapa itu dipilih? Komposisi, lighting, warna — semua punya makna, jelaskan.

6. COPY_PATTERN: Formula copy yang dipakai. Bukan hanya "problem-agitate" tapi pola spesifiknya: opening word choice, structure, tone, how it creates urgency.

7. REPLICATION_BLUEPRINT: Instruksi singkat "cara replikasi konsep ini untuk produk skincare/kesehatan". Apa yang harus dipertahankan dan apa yang diganti.

Return HANYA valid JSON:
{
  "humanScenario": "...",
  "emotionalTruth": "...",
  "hookMechanism": "...",
  "narrativeStructure": { "setup": "...", "tension": "...", "resolution": "..." },
  "visualStory": "...",
  "copyPattern": "...",
  "replicationBlueprint": "...",
  "visualStyle": "...",
  "colorPalette": ["#hex1", "#hex2"],
  "lighting": "...",
  "mood": "...",
  "composition": "...",
  "dominantAngle": "angle_key",
  "format": "Feed/Story/Reels",
  "primaryEmotion": "..."
}
```

#### 2b. Rewrite generateScalingAngles — translate concept, tidak apply template

Ganti seluruh prompt di `generateScalingAngles` dengan ini:

```js
const systemPrompt = `Kamu adalah Meta Ads creative strategist yang ahli "concept translation" — mengambil DNA dari iklan winning dan mengadaptasinya untuk produk yang berbeda.

PRINSIP UTAMA: Jangan buat iklan generik. Translate SPESIFIK konsep dari winning ad ke konteks produk ini. Pertahankan: hook mechanism, emotional truth, narrative structure. Ganti: skenario, objek, konteks — sesuaikan ke produk.

PENTING: Semua copy (headline, subheadline, bodyText, cta) HARUS Bahasa Indonesia.`;

const userPrompt = `WINNING AD ANALYSIS:
${JSON.stringify(winningAnalysis, null, 2)}

PRODUK: ${productName}
${productDescription ? `Deskripsi produk: ${productDescription}` : ''}
${productVisualDescription ? `Visual produk: ${productVisualDescription}` : ''}

ANGLE YANG DIMINTA: ${anglesToGenerate.join(', ')}

TUGAS:
Untuk tiap angle, buat copy iklan yang:
1. Menggunakan hook mechanism yang SAMA dengan winning ad (cara menarik perhatian di 3 detik pertama)
2. Menyentuh emotional truth yang SAMA tapi diaplikasikan ke konteks produk ini
3. Mengikuti narrative structure yang SAMA (setup→tension→resolution) tapi untuk skenario produk ini
4. BUKAN menggunakan template angle generik — translate konsep winning ad secara spesifik

Contoh cara berpikir:
- Winning ad: orang frustrasi tidak tahu angka bisnisnya (hook: "kamu melakukan kesalahan tanpa sadar")  
- Produk skincare diabetes: orang tidak sadar kulitnya butuh perawatan khusus (hook: "kamu merawat kulit dengan cara yang salah selama ini")
- Sama hooknya, berbeda konteksnya

Untuk tiap angle, return:
{
  "angle": "angle_key",
  "translatedConcept": "penjelasan 1 paragraf: bagaimana konsep winning ad ditranslate ke produk ini untuk angle ini",
  "headline": "headline max 8 kata, scroll-stopping — BAHASA INDONESIA",
  "subheadline": "subheadline max 15 kata — BAHASA INDONESIA",
  "bodyText": "body copy max 30 kata — BAHASA INDONESIA",
  "cta": "CTA max 4 kata — BAHASA INDONESIA",
  "imageScenario": "Skenario visual spesifik untuk gambar: siapa, sedang apa, di mana, ekspresi, objek di sekitarnya — harus PARALEL dengan skenario winning ad tapi untuk konteks produk (50 kata, Indonesian)",
  "imagePromptEN": "Detail image prompt dalam English untuk AI image generator (80-150 kata)"
}

Return array JSON valid.`;
```

#### 2c. Rewrite generateVariationPrompt — gunakan imageScenario dari step sebelumnya

Ubah fungsi `generateVariationPrompt` untuk menggunakan `angle.imageScenario` (dari step 2b) sebagai basis, bukan `angle.imageDirection` yang generik:

```js
const conceptContext = angle.translatedConcept 
  ? `\nTranslated concept: ${angle.translatedConcept}\nScene to depict: ${angle.imageScenario}`
  : `\nImage direction: ${angle.imageDirection}`;

const prompt = `Meta Ads creative image, ${winningAnalysis.visualStyle || 'professional, clean'}, 
${conceptContext}
Product: ${productName} — must be clearly visible and recognizable.
${productVisualDescription ? `Product looks like: ${productVisualDescription}` : ''}
Maintain winning ad visual DNA: ${winningAnalysis.colorPalette?.join(', ')} color palette, ${winningAnalysis.lighting} lighting, ${winningAnalysis.mood} mood, ${winningAnalysis.composition} composition.
NO text, words, numbers, or typography in image.
Highly detailed, photorealistic, Meta Ads format.`;

return prompt.trim();
```

Jika `angle.imagePromptEN` sudah ada (digenerate di step 2b), gunakan langsung tanpa memanggil chatCompletion lagi — hemat API call:

```js
async function generateVariationPrompts(winningAnalysis, angles, productName, productVisualDescription) {
  return angles.map((angle) => {
    // Use pre-generated imagePromptEN if available
    const imagePrompt = angle.imagePromptEN || buildFallbackPrompt(angle, winningAnalysis, productName, productVisualDescription);
    return { ...angle, imagePrompt };
  });
}
```

Ini menggabungkan step 2b dan 2c jadi 1 API call, lebih efisien.

#### 2d. Update batchGenerateImages

Terima `productImageUrl` dan pass ke generateImage:

```js
async function batchGenerateImages(variations, aspectRatio = '1:1', productImageUrl = null) {
  const sizeMap = { '1:1': '1024x1024', '9:16': '1024x1792', '16:9': '1792x1024' };
  const size = sizeMap[aspectRatio] || '1024x1024';
  const results = await Promise.allSettled(
    variations.filter(v => v.imagePrompt).map((v) =>
      generateImage({ prompt: v.imagePrompt, size, imageUrl: productImageUrl })
    )
  );
  let idx = 0;
  return variations.map((v) => {
    if (!v.imagePrompt) return { ...v, imageUrl: null, imageError: 'No prompt' };
    const r = results[idx++];
    return { ...v, imageUrl: r.status === 'fulfilled' ? r.value[0]?.url : null, imageError: r.status === 'rejected' ? r.reason?.message : null };
  });
}
```

---

## TASK 1 — Fix Bahasa & Product Visual Reference (REAL img2img)

### 1a. Fix bahasa di backend/src/services/scalingService.js

Di semua prompt yang dikirim ke chatCompletion, tambahkan instruksi bahasa Indonesia:

Di fungsi `generateScalingAngles`, tambahkan di awal system prompt:
```
"PENTING: Semua output copy (headline, subheadline, bodyText, cta) HARUS dalam Bahasa Indonesia. Jangan gunakan bahasa Inggris sama sekali untuk teks iklan."
```

Di fungsi `generateVariationPrompts`, tambahkan instruksi yang sama.

Di fungsi `analyzeWinningAd`, biarkan analisis internal dalam English (untuk akurasi).

### 1b. Upload product photo → get URL → pass ke Flux Kontext (REAL reference)

Tambahkan fungsi `uploadImageToApimart` di `backend/src/services/apimart.js`:

```js
const FormData = require('form-data');

/**
 * Upload a base64 image to apimart and return a public URL.
 * Used for passing product photos as reference to flux-kontext-pro.
 */
async function uploadImageToApimart(base64Data, mimeType = 'image/jpeg') {
  const buffer = Buffer.from(base64Data, 'base64');
  const fd = new FormData();
  fd.append('file', buffer, {
    filename: `product-${Date.now()}.jpg`,
    contentType: mimeType,
  });
  const response = await imageClient.post('/uploads/images', fd, {
    headers: { ...fd.getHeaders() },
    timeout: 30000,
  });
  // Response shape: { url: "..." } or { data: { url: "..." } }
  return response.data?.url || response.data?.data?.url || null;
}
```

Tambahkan ke module.exports.

### 1c. Gunakan flux-kontext-pro untuk generate dengan product reference

Di `backend/src/services/apimart.js`, modifikasi `generateImage`:

```js
async function generateImage({ prompt, size = '1024x1024', model, imageUrl, pollIntervalMs = 5000, timeoutMs = 180000 }) {
  const payload = {
    model: model || config.models.image,
    prompt,
    n: 1,
  };
  
  // If imageUrl provided, use flux-kontext-pro for reference-based generation
  if (imageUrl) {
    payload.model = 'flux-kontext-pro';
    payload.image_url = imageUrl;
    // flux-kontext uses aspect_ratio not size
    const aspectMap = { '1024x1024': '1:1', '1024x1792': '9:16', '1792x1024': '16:9' };
    payload.aspect_ratio = aspectMap[size] || '1:1';
  } else {
    payload.size = size;
  }
  
  // ... rest of existing submit + poll logic unchanged
}
```

### 1d. Backend: inject product photo ke generate-variations

Di `backend/src/routes/scale.js`, endpoint POST `/api/scale/generate-variations`:

Tambahkan handling `productPhotoBase64` di request body:

```js
const { analysis, productName, selectedAngles, aspectRatio, generateImages, productPhotoBase64, productPhotoMime } = req.body;

let productImageUrl = null;
if (productPhotoBase64 && generateImages) {
  try {
    const { uploadImageToApimart } = require('../services/apimart');
    productImageUrl = await uploadImageToApimart(productPhotoBase64, productPhotoMime || 'image/jpeg');
  } catch(e) {
    // Non-fatal: if upload fails, fall back to text-only generation
    req.log?.warn({ err: e.message }, 'product_photo_upload_failed');
  }
}
```

Lalu saat memanggil `batchGenerateImages`, pass `productImageUrl`:
```js
finalVariations = await batchGenerateImages(variationsWithPrompts, aspectRatio, productImageUrl);
```

Di `backend/src/services/scalingService.js`, update `batchGenerateImages` untuk menerima dan pass `productImageUrl` ke `generateImage`:
```js
async function batchGenerateImages(variations, aspectRatio, productImageUrl = null) {
  // ... existing code
  const { url } = await generateImage({ 
    prompt: v.imagePrompt, 
    size: sizeMap[aspectRatio],
    imageUrl: productImageUrl  // pass reference
  });
  // ...
}
```

### 1e. Frontend: kirim product photo ke backend

Di `frontend/app/(app)/scale/page.tsx`, saat selectedProduct berubah:
```ts
// Extract base64 from data URL
function extractBase64(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  return match ? { mime: match[1], data: match[2] } : null
}
```

Saat memanggil `generateScalingVariations`, tambahkan:
```ts
const photo = selectedProduct?.photos?.[0]
const photoData = photo ? extractBase64(photo) : null

await generateScalingVariations({
  analysis: analysisResp.analysis,
  productName: selectedProduct?.name || productName.trim(),
  selectedAngles,
  aspectRatio,
  generateImages: outputType === 'image' && generateImages,
  productPhotoBase64: photoData?.data,
  productPhotoMime: photoData?.mime,
})
```

Update `generateScalingVariations` di `frontend/lib/api.ts` untuk menerima kedua field baru ini dan include di request body.

Di frontend/app/(app)/scale/page.tsx:
- Saat user pilih produk dari dropdown, jika `selectedProduct.photos[0]` ada (base64 data URL), ekstrak base64-nya (strip prefix `data:image/...;base64,`) dan kirim sebagai `productPhotoBase64` ke generate-variations.

---

## TASK 2 — Scale Winning Image v2

### Backend: backend/src/routes/scale.js

Endpoint POST /api/scale/generate-variations, tambahkan field baru di response per variation:
```json
{
  "angle": "fomo",
  "headline": "...",          // BAHASA INDONESIA
  "subheadline": "...",       // BAHASA INDONESIA  
  "bodyText": "...",          // BAHASA INDONESIA
  "cta": "...",               // BAHASA INDONESIA
  "imagePrompt": "...",       // English (untuk image generation AI)
  "imageUrl": "...",
  "conceptNote": "..."        // Penjelasan kenapa angle ini dipilih (untuk user)
}
```

### Backend: backend/src/services/scalingService.js

Di `generateVariationPrompts`, pastikan image prompt selalu menyertakan:
1. Visual style dari winning ad (warna, layout, suasana, lighting)
2. Hook type yang sama (misal: problem-agitate, curiosity)
3. Product visual description (dari foto produk)
4. Platform: "Meta Ads, square format, high quality, professional"
5. JANGAN include teks/tulisan dalam prompt gambar (teks ditangani sebagai copy terpisah)

### Frontend: frontend/app/(app)/scale/page.tsx

Flow baru:
1. Upload winning ad → Analyze (button)
2. Hasil analisis muncul (AnalysisCard)
3. Pilih produk tersimpan (dropdown) — produk auto-load foto untuk visual injection
4. Pilih angle (checkboxes)
5. Pilih aspect ratio
6. Generate → hasilkan variasi

**Setelah hasil muncul**, tampilkan banner/card di bawah:
```
┌─────────────────────────────────────────────────┐
│ 🎠 Mau dijadikan Carousel juga?                  │
│ Cocok untuk storytelling produk di Meta Ads      │
│                                                  │
│ [Tidak, makasih]    [Ya, buat carousel →]        │
└─────────────────────────────────────────────────┘
```

Jika user klik "Ya, buat carousel →", tampilkan inline form:
```
Berapa slide carousel? [3] [4] [5] [6] [7] [8] (default 5)
[Generate Carousel]
```

Lalu call endpoint carousel generation.

### Carousel Generation

Backend POST /api/scale/generate-carousel:
```
Body: {
  analysis,          // dari winning ad analysis
  productName,
  productDescription, // dari produk tersimpan
  productVisualDescription, // dari foto produk
  slideCount,        // 3-8
  aspectRatio,       // '1:1' default untuk carousel
  language: 'id'
}
```

Logic carousel:
- Slide 1: Hook slide — ambil hook yang sama persis dari winning ad, adaptasi ke produk
- Slide 2 - (N-1): Benefit slides — tiap slide 1 USP/manfaat produk
- Slide terakhir: CTA slide — strong call to action

Per slide, generate:
- `headline`: teks utama slide (Indonesia)
- `subtext`: teks pendukung (Indonesia)
- `imagePrompt`: prompt untuk generate gambar slide (English, konsisten visual dengan winning ad)
- `imageUrl`: hasil generate (jika generateImages: true)

Response:
```json
{
  "totalSlides": 5,
  "productName": "...",
  "slides": [
    {
      "slideNumber": 1,
      "type": "hook",
      "headline": "...",
      "subtext": "...",
      "imagePrompt": "...",
      "imageUrl": "..."
    }
  ]
}
```

### Carousel Display (frontend)

Setelah carousel generate, tampilkan di bawah image variations:

```
┌──────────────────────────────────────────────────────┐
│ Carousel Preview (5 slide)              [Download All]│
│                                                       │
│  ┌───┐  ┌───┐  ┌───┐  ┌───┐  ┌───┐                 │
│  │ 1 │  │ 2 │  │ 3 │  │ 4 │  │ 5 │                 │
│  │   │→ │   │→ │   │→ │   │→ │   │                 │
│  └───┘  └───┘  └───┘  └───┘  └───┘                 │
│  Hook   Manfaat Manfaat Bukti  CTA                   │
│                                                       │
│  [Slide yang dipilih: preview besar + copy di bawah] │
└──────────────────────────────────────────────────────┘
```

Component: `frontend/components/ads/CarouselPreview.tsx`
- Horizontal scrollable thumbnail strip (klik untuk preview besar)
- Click thumbnail → show full preview + copy text
- Download individual slide button per slide
- "Download Semua" button (download zip or sequence)

---

## TASK 3 — Scale Winning Video (Menu Baru)

### Konsep

Upload video iklan winning (misal: video obat lutut sakit yang bagus) → AI analisis setiap aspek visual & konsep → translate ke video generation prompt yang sangat detail → adaptasi prompt ke produk user (misal: lotion diabetes, ambiance sama, hook sama, tapi produk beda) → generate video baru via apimart.

### Backend

#### 3a. Enhance video analysis: backend/src/services/videoAnalyzer.js

Fungsi `analyzeVideoReference` sudah ada. Enhance output-nya dengan fields:
```json
{
  "scenes": [
    {
      "sceneNumber": 1,
      "duration": "0-3s",
      "description": "Close-up tangan memegang lutut, ekspresi kesakitan",
      "hook": true,
      "visualElements": ["close-up", "pain expression", "warm lighting"],
      "emotion": "empathy/pain"
    }
  ],
  "overallStyle": "documentary-feel, warm tones, close-up heavy",
  "pacing": "slow to fast (builds urgency)",
  "hookType": "problem-first (show pain before solution)",
  "colorPalette": "warm brown, cream, soft green",
  "cameraMovement": "mostly static, slight zoom in for emphasis",
  "emotionArc": "pain → hope → solution → relief",
  "recommendedDuration": 30,
  "musicVibe": "soft emotional, builds to uplifting"
}
```

Prompt ke vision AI untuk analisis video:
```
Analyze this winning ad video frame by frame. Extract:
1. Scene-by-scene breakdown with timing
2. Hook type (how does it grab attention in first 3 seconds?)
3. Visual style (lighting, color palette, camera angles)
4. Emotion arc (what emotions does it take the viewer through?)
5. Pacing (slow/fast, when does it change?)
6. Key visual elements that make it effective
7. Overall ambiance/atmosphere
8. Recommended music/sound vibe

Be extremely detailed. This will be used to recreate a similar video for a different product.
```

#### 3b. New route: backend/src/routes/scale-video.js

```
POST /api/scale-video/analyze
- multer upload single video
- call analyzeVideoReference (enhanced)
- return detailed analysis

POST /api/scale-video/generate
Body: {
  videoAnalysis,          // dari analyze step
  productName,
  productDescription,
  productPhotoBase64,     // untuk describe produk secara visual
  aspectRatio: '9:16',   // default portrait untuk story/reels
  duration: 30,           // detik
  language: 'id'
}

Logic:
1. Dari videoAnalysis, extract: hook type, emotion arc, visual style, pacing, scene structure
2. Describe product visually (dari productPhotoBase64 via vision AI)
3. Build video prompt:
   - Keep: hook structure, emotion arc, visual style, pacing, ambiance
   - Replace: product references → produk user
   - Add: product visual description
4. Generate "scene-by-scene video script" dulu (sebagai intermediate step):
   [
     { scene: 1, duration: "0-3s", description: "...", visualStyle: "..." },
     { scene: 2, duration: "3-8s", description: "...", visualStyle: "..." },
     ...
   ]
5. Compile scene descriptions → single video generation prompt (English, detailed)
6. Call apimart generateVideo({ prompt, aspectRatio, duration })
7. Return { taskId, videoScript, videoPrompt } untuk polling

GET /api/scale-video/status/:taskId
- Poll apimart task status
- Return { status, videoUrl, progress }
```

Register di backend/src/index.js:
```js
app.use('/api/scale-video', require('./routes/scale-video'));
```

#### 3c. Add to frontend/lib/api.ts

```ts
export async function analyzeWinningVideo(file: File) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await api.post('/scale-video/analyze', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export async function generateScaleVideo(payload: {
  videoAnalysis: any
  productName: string
  productDescription?: string
  productPhotoBase64?: string
  aspectRatio?: string
  duration?: number
}) {
  const res = await api.post('/scale-video/generate', payload)
  return res.data // { taskId, videoScript, videoPrompt }
}

export async function getScaleVideoStatus(taskId: string) {
  const res = await api.get(`/scale-video/status/${taskId}`)
  return res.data // { status, videoUrl, progress }
}
```

### Frontend: frontend/app/(app)/scale-video/page.tsx

**Flow UI (3 langkah, bukan wizard — semua visible, progressive reveal):**

```
┌─────────────────────────────────────────┐
│ 🎬 Scale Winning Video                   │
│ Upload video iklan winning → AI analisis │
│ → adapt ke produkmu → generate video baru│
└─────────────────────────────────────────┘

STEP 1: Upload & Analyze
┌────────────────────────┐
│ [Dropzone video]       │
│ MP4/MOV, maks 50MB     │
│                        │
│ [🔍 Analyze Video]     │
└────────────────────────┘

(setelah analyze selesai, muncul Step 2)

STEP 2: Pilih Produk & Setting
┌────────────────────────────────────────┐
│ Produk: [dropdown produk tersimpan ▼]  │
│ Durasi: [15s] [30s] [60s]             │
│ Format: [9:16 Reels] [1:1 Feed]       │
│                                        │
│ 📋 Analisis AI:                        │
│ Hook: problem-first (3 detik pertama)  │
│ Style: warm, close-up, documentary     │
│ Emotion: pain → relief → joy           │
│ Pacing: slow build → fast climax       │
│                                        │
│ [🎬 Generate Video]                    │
└────────────────────────────────────────┘

(setelah klik generate, muncul Step 3)

STEP 3: Hasil
┌────────────────────────────────────────┐
│ Generating... (biasanya 2-5 menit)     │
│ [progress bar + status polling]        │
│                                        │
│ Script yang digunakan:                 │
│ Scene 1 (0-3s): [deskripsi]            │
│ Scene 2 (3-8s): [deskripsi]            │
│ ...                                    │
│                                        │
│ [Video player ketika selesai]          │
│ [Download video]                       │
└────────────────────────────────────────┘
```

**Polling logic:**
- Setelah generate, simpan taskId di state
- Poll setiap 5 detik ke `/api/scale-video/status/:taskId`
- Update progress bar
- Saat status "completed", tampilkan video player
- Timeout 5 menit → show error + retry button

### Tambah ke Sidebar

Di frontend/components/layout/Sidebar.tsx, ubah group Generate:
```ts
{
  label: 'Generate',
  items: [
    { href: '/generate/single-image', label: 'Single Image', icon: ImageIcon },
    { href: '/scale', label: 'Scale Winning Image', icon: Layers },
    { href: '/scale-video', label: 'Scale Winning Video', icon: Video },
    { href: '/create', label: 'Create w/ Reference', icon: Sparkles },
  ],
},
```
Import `Video` dan `Layers` dari lucide-react.

---

## TASK 4 — Build, Test, Deploy

### Pre-deploy checklist

- [ ] `cd frontend && npm run build` — 0 errors, 0 TypeScript errors
- [ ] Semua API calls punya error handling yang proper (cath + toast)
- [ ] Polling video punya timeout + cleanup (clearInterval on unmount)
- [ ] Carousel display responsive di mobile
- [ ] Bahasa Indonesia di semua copy output
- [ ] Product photo injection teretst (ada foto → prompt lebih akurat)
- [ ] Loading states semua ada (skeleton/spinner)
- [ ] 0 console.error di production

### Deploy

```bash
git add -A
git commit -m "feat: scale winning v2 — Indonesian language, product visual injection, carousel option, scale winning video menu"
git push origin main
```

Railway auto-redeploy backend.
Vercel auto-redeploy frontend.

---

## Summary Fitur Final

| Menu | Input | Output |
|------|-------|--------|
| Scale Winning Image | Foto iklan winning + produk | N variasi image + optional carousel |
| Scale Winning Video | Video iklan winning + produk | Video baru yang sama konsep, produk berbeda |
| Create w/ Reference | Foto referensi + produk | Image/video/carousel custom |
| Single Image | Prompt manual + produk | 1 image |

**Filosofi tetap sama: lihat iklan bagus → copas konsep → ganti produk → generate.**
