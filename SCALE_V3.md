# SCALE_V3.md — Reference Image Pipeline + Layout-Based Prompts

> Execute all tasks autonomously in order. Commit + push at end.

## GOAL
Match apimart playground quality: winning ad image + product photo as visual references,
layout-based prompts (typography placement explicit), same clean editorial result.

---

## TASK 1 — apimart.js: support `images` array for gpt-image-2

In `backend/src/services/apimart.js`, replace `generateImage` with this:

```js
async function generateImage({ prompt, size = '1024x1024', model, referenceImages, pollIntervalMs = 5000, timeoutMs = 180000 }) {
  const effectiveModel = model || config.models.image;
  const normalizedSize = GPT_IMAGE_SIZE_MAP[size] || '1024x1024';

  const payload = {
    model: effectiveModel,
    prompt,
    n: 1,
    size: normalizedSize,
  };

  // Pass reference images (winning ad + product photo) if available
  if (referenceImages && referenceImages.length > 0) {
    payload.images = referenceImages;
  }

  const submitted = await submitImageJobPayload(payload);

  // Sync path
  if (submitted.url) {
    const url = Array.isArray(submitted.url) ? submitted.url[0] : submitted.url;
    return [{ url }];
  }

  const taskId = submitted.task_id || submitted.taskId || submitted.id;
  if (!taskId) throw new Error('No task_id: ' + JSON.stringify(submitted).slice(0, 200));

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const task = await getTask(taskId);
    const status = (task.status || '').toLowerCase();

    if (status === 'completed' || status === 'succeed' || status === 'success') {
      const images = task.result?.images || task.images || task.result?.data || task.output?.images || [];
      if (images.length) {
        const url = Array.isArray(images[0].url) ? images[0].url[0] : (images[0].url || images[0]);
        return [{ url }];
      }
      const directUrl = task.result?.url || task.url || task.output?.url;
      if (directUrl) return [{ url: directUrl }];
      throw new Error('Task completed but no images: ' + JSON.stringify(task).slice(0, 200));
    }
    if (['failed', 'error', 'cancelled'].includes(status)) {
      throw new Error('Image task failed: ' + JSON.stringify(task).slice(0, 200));
    }
  }
  throw new Error(`Image generation timed out (task ${taskId})`);
}
```

Also remove the old `GPT_IMAGE_SIZE_MAP` variable if it's defined elsewhere and ensure it's defined once:
```js
const GPT_IMAGE_SIZE_MAP = {
  '1024x1024': '1024x1024',
  '1024x1792': '1024x1536',
  '1792x1024': '1536x1024',
  '1024x1536': '1024x1536',
  '1536x1024': '1536x1024',
};
```

---

## TASK 2 — scale.js analyze route: keep winning ad base64 in response

In `backend/src/routes/scale.js`, update the `/analyze-winning` route.

Find the block that does `fs.unlink` after analysis and add the base64 to the response:

```js
router.post('/analyze-winning', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File is required' });
  const isVideo = req.file.mimetype.startsWith('video/');
  try {
    let analysis;
    // Read file as base64 BEFORE deleting
    const fileBuffer = fs.readFileSync(req.file.path);
    const winningAdBase64 = fileBuffer.toString('base64');
    const winningAdMime = req.file.mimetype;

    if (isVideo) {
      const { analysis: videoAnalysis, frames } = await analyzeVideoReference(req.file.path);
      analysis = { ...videoAnalysis, framesAnalyzed: frames, type: 'video' };
    } else {
      analysis = await analyzeWinningAd(req.file.path, 'image');
      analysis.type = 'image';
    }
    fs.unlink(req.file.path, () => {});
    res.json({
      analysis,
      filename: req.file.originalname,
      // Return base64 so frontend can pass it back for image generation reference
      winningAdBase64,
      winningAdMime,
      availableAngles: Object.entries(SCALING_ANGLES).map(([key, val]) => ({
        key,
        label: val.label,
        hook: val.hook,
      })),
    });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    throw err;
  }
});
```

---

## TASK 3 — scale.js generate-variations: upload both images, pass as references

In `backend/src/routes/scale.js`, update the `/generate-variations` route.

Replace the current route body with this:

```js
router.post('/generate-variations', async (req, res) => {
  const {
    analysis,
    productName,
    productDescription = null,
    selectedAngles = [],
    aspectRatio = '1:1',
    generateImages = false,
    productPhotoBase64 = null,
    productPhotoMime = 'image/jpeg',
    winningAdBase64 = null,
    winningAdMime = 'image/jpeg',
  } = req.body;

  if (!analysis || !productName) {
    return res.status(400).json({ error: 'analysis and productName are required' });
  }

  // Describe product visually from photo
  let productVisualDescription = null;
  if (productPhotoBase64) {
    try {
      productVisualDescription = await analyzeImage({
        imageBase64: productPhotoBase64,
        mimeType: productPhotoMime || 'image/jpeg',
        prompt: 'Describe this product visually in detail: shape, color, packaging, label text, texture, size. Be specific for AI image generation. Under 80 words.',
      });
    } catch (e) {
      console.warn('Product photo analysis failed (non-fatal):', e.message);
    }
  }

  // Upload both images to apimart to get public URLs for gpt-image-2 reference
  const referenceImageUrls = [];
  if (generateImages) {
    // Upload winning ad as style/layout reference
    if (winningAdBase64) {
      try {
        const url = await uploadImageToApimart(winningAdBase64, winningAdMime || 'image/jpeg');
        if (url) { referenceImageUrls.push(url); console.log('Winning ad uploaded:', url.slice(0,60)); }
      } catch (e) { console.warn('Winning ad upload failed (non-fatal):', e.message); }
    }
    // Upload product photo as product reference
    if (productPhotoBase64) {
      try {
        const url = await uploadImageToApimart(productPhotoBase64, productPhotoMime || 'image/jpeg');
        if (url) { referenceImageUrls.push(url); console.log('Product photo uploaded:', url.slice(0,60)); }
      } catch (e) { console.warn('Product photo upload failed (non-fatal):', e.message); }
    }
  }

  const angles = await generateScalingAngles(
    analysis, productName, selectedAngles, productVisualDescription, productDescription
  );
  if (!angles.length) return res.status(500).json({ error: 'Failed to generate scaling angles' });

  const variationsWithPrompts = await generateVariationPrompts(analysis, angles, productName, productVisualDescription);

  let finalVariations = variationsWithPrompts;
  if (generateImages) {
    finalVariations = await batchGenerateImages(variationsWithPrompts, aspectRatio, referenceImageUrls);
  }

  res.json({
    productName,
    aspectRatio,
    totalVariations: finalVariations.length,
    variations: finalVariations,
    productVisualDescription,
    usedReferenceImages: referenceImageUrls.length,
  });
});
```

Also update the import line to include `uploadImageToApimart`:
```js
const { analyzeImage, uploadImageToApimart, generateImage, generateVideo, chatCompletion } = require('../services/apimart');
```

---

## TASK 4 — scalingService.js: batchGenerateImages accepts referenceImageUrls

In `backend/src/services/scalingService.js`, replace `batchGenerateImages`:

```js
async function batchGenerateImages(variations, aspectRatio = '1:1', referenceImageUrls = []) {
  const sizeMap = {
    '1:1': '1024x1024',
    '9:16': '1024x1536',
    '16:9': '1536x1024',
    '4:5': '1024x1024',
  };
  const size = sizeMap[aspectRatio] || '1024x1024';

  const filteredVariations = variations.filter((v) => v.imagePrompt);
  const results = await Promise.allSettled(
    filteredVariations.map((v) =>
      generateImage({
        prompt: v.imagePrompt,
        size,
        referenceImages: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
      })
    )
  );

  let filteredIdx = 0;
  return variations.map((v) => {
    if (!v.imagePrompt) return { ...v, imageUrl: null, imageError: 'No prompt generated' };
    const result = results[filteredIdx++];
    return {
      ...v,
      imageUrl: result.status === 'fulfilled' ? result.value[0]?.url : null,
      imageError: result.status === 'rejected' ? result.reason?.message : null,
    };
  });
}
```

---

## TASK 5 — scalingService.js: imagePromptEN becomes layout-based

In `backend/src/services/scalingService.js`, inside `generateScalingAngles`, change the `imagePromptEN` field instruction in `userPrompt` from scene-based to **layout-based**.

Find the `imagePromptEN` field in the JSON output spec and replace with:

```
  "imagePromptEN": "A layout-based Meta Ads image prompt (150-200 words). Start with layout type based on the angle:
  - before_after angle → 'A clean split-screen Meta Ads image. LEFT HALF shows [problem state]. RIGHT HALF shows [solution state]. Dividing line center with circle containing [time/metric]. TYPOGRAPHY CENTER: [headline lines]. BOTTOM: product + CTA button.'
  - fomo/problem_agitate/curiosity_gap → 'A clean editorial Meta Ads image. LEFT 55%: large bold typography block on cream/light background. RIGHT 45%: photorealistic scene with Indonesian woman. TYPOGRAPHY (render exactly): [badge text], [headline line 1], [headline line 2], [body text]. SCENE: [specific props and expression].'
  - social_proof/authority → 'A clean testimonial Meta Ads image. [Layout]. TYPOGRAPHY: [text]. SCENE: [group or authority scene].'
  - tutorial/price_anchor → 'A clean informational Meta Ads image. [Layout]. TYPOGRAPHY: [text]. ELEMENTS: [specific visual elements].'
  Always include: exact text strings to render, Indonesian woman Southeast Asian, TaraCare product (${productVisualDescription || 'tall slim pink pump bottle 200ML labeled TaraCare Body Lotion'}), color palette from winning ad, BPOM badge, CTA button text. No blur on text."
```

More precisely — replace the entire `imagePromptEN` instruction line in the JSON template with:

```
"imagePromptEN": "A professional Meta Ads image prompt (150-200 words). MUST specify: (1) LAYOUT: exact layout type — split-screen, editorial left-text/right-scene, or full-scene with overlay. Match the layout style and composition of the winning ad reference. (2) TYPOGRAPHY (render exactly, large and bold): the exact headline text '[headline value]', subheadline, and CTA button '[cta value]' as rendered text in the image. (3) SCENE: Indonesian woman, Southeast Asian features, relatable everyday person, [specific action/expression matching angle emotion]. (4) PRODUCT: TaraCare Body Lotion Taracare — tall slim pink pump bottle 200ML, pink and white label, pump dispenser top — prominently featured, clearly identifiable. Reference the uploaded product photo. (5) COLOR: use winning ad's color palette [${palette}], [${winningAnalysis.lighting||'warm natural'}] lighting, [${winningAnalysis.mood||'engaging'}] mood. (6) PROPS: specific objects that tell the story, parallel to winning ad props. (7) STYLE: photorealistic, high-end beauty/skincare editorial, clean background, no CGI look. Rendered text must be perfectly legible."
```

---

## TASK 6 — frontend: store winningAdBase64 and pass to generate

In `frontend/app/(app)/scale/page.tsx`:

### 6a. Add state for winning ad base64:

After existing state declarations, add:
```ts
const [winningAdBase64, setWinningAdBase64] = useState<string | null>(null)
const [winningAdMime, setWinningAdMime] = useState<string>('image/jpeg')
```

### 6b. Update `handleAnalyze` to store the winning ad:

After `setAnalysisResp(resp)`, add:
```ts
// Store winning ad for use as reference in image generation
if (resp.winningAdBase64) {
  setWinningAdBase64(resp.winningAdBase64)
  setWinningAdMime(resp.winningAdMime || 'image/jpeg')
}
```

### 6c. Update `generateScalingVariations` call to pass winning ad:

In the `handleGenerate` function, add `winningAdBase64` and `winningAdMime` to the payload:

```ts
const resp = await generateScalingVariations({
  analysis: analysisResp.analysis,
  productName: selectedProduct.name,
  productDescription: selectedProduct.description,
  selectedAngles,
  aspectRatio,
  generateImages: outputType === 'image' && generateImages,
  productPhotoBase64,
  productPhotoMime,
  winningAdBase64: winningAdBase64 ?? undefined,
  winningAdMime: winningAdMime,
})
```

---

## TASK 7 — frontend lib/api.ts: add winningAdBase64 to generateScalingVariations

In `frontend/lib/api.ts`, update `generateScalingVariations` payload type to include:

```ts
export async function generateScalingVariations(payload: {
  analysis: any
  productName: string
  productDescription?: string
  selectedAngles: string[]
  aspectRatio: AspectRatio
  generateImages: boolean
  productPhotoBase64?: string
  productPhotoMime?: string
  winningAdBase64?: string   // ← add
  winningAdMime?: string     // ← add
}): Promise<GenerateVariationsResponse> {
  const res = await api.post('/scale/generate-variations', payload)
  return res.data
}
```

Also update `AnalyzeWinningResponse` type in `frontend/lib/types.ts` to include:

```ts
export interface AnalyzeWinningResponse {
  analysis: WinningAdAnalysis
  filename: string
  availableAngles: ScalingAngle[]
  winningAdBase64?: string   // ← add
  winningAdMime?: string     // ← add
}
```

---

## TASK 8 — TypeScript check + commit + push

```bash
cd "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator"

# TypeScript check
cd frontend && npx tsc --noEmit
cd ..

# Commit & push
rm -f .git/index.lock .git/HEAD.lock
git add -A
git commit -m "feat: gpt-image-2 reference images pipeline — winning ad + product photo as visual references, layout-based prompts"
git push origin main
```

---

## Summary

After this deploy:
- Winning ad image uploaded to apimart → visual layout/style reference for gpt-image-2
- Product photo uploaded to apimart → product accuracy reference
- Both passed via `images: [url1, url2]` to gpt-image-2
- imagePromptEN is layout-based (editorial left/right, split-screen, etc.) not just scene description
- Result should match apimart playground quality
