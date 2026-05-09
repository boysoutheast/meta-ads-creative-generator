const express = require('express');
const router = express.Router();
const fs = require('fs');
const upload = require('../middleware/upload');
const {
  SCALING_ANGLES,
  analyzeWinningAd,
  generateScalingAngles,
  generateVariationPrompts,
  batchGenerateImages,
  buildCarouselSlidePrompt,
} = require('../services/scalingService');
const { analyzeVideoReference } = require('../services/videoAnalyzer');
const { analyzeImage, uploadImageToApimart, generateImage, chatCompletion } = require('../services/apimart');
const { generateFirstClip, pollUntilComplete } = require('../services/geminiGenService');
const config = require('../config');

router.get('/angles', (req, res) => {
  res.json({ angles: SCALING_ANGLES });
});

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
      analysis = await analyzeWinningAd(req.file.path, winningAdMime);
      analysis.type = 'image';
    }
    // Extract masterImagePrompt from analysis — return it separately so frontend
    // can store it and pass it back at generate-time (avoids re-generating it per angle).
    const masterImagePrompt = analysis.masterImagePrompt || null;

    fs.unlink(req.file.path, () => {});
    res.json({
      analysis,
      filename: req.file.originalname,
      // Return base64 so frontend can pass it back for image generation reference
      winningAdBase64,
      winningAdMime,
      masterImagePrompt,
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

// ─── SSE streaming endpoint — same logic as /generate-variations but sends
// progress events as each image completes so the frontend can show a live bar.
router.post('/generate-variations-stream', async (req, res) => {
  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx/Railway proxy buffering
  res.flushHeaders(); // Send headers immediately so the client can start reading

  const send = (data) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  };

  // Keepalive heartbeat — Railway proxy kills idle SSE connections after ~3 min.
  // Send a comment line every 20s so the connection stays alive through long LLM calls.
  const keepalive = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': ping\n\n');
      if (typeof res.flush === 'function') res.flush();
    }
  }, 20000);
  res.on('close', () => clearInterval(keepalive));

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
    productPrice = null,
    productPromoPrice = null,
    masterImagePrompt = null,
    imagesPerAngle = 1,
    angleQuantities = {},
  } = req.body;

  if (!analysis || !productName) {
    send({ type: 'error', message: 'analysis and productName are required' });
    return res.end();
  }

  try {
    // ── Phase 1: product photo analysis ──────────────────────────────────────
    let productVisualDescription = null;
    if (productPhotoBase64) {
      send({ type: 'status', message: 'Menganalisis foto produk…' });
      try {
        productVisualDescription = await analyzeImage({
          imageBase64: productPhotoBase64,
          mimeType: productPhotoMime || 'image/jpeg',
          prompt: 'Describe this product visually in detail: shape, color, packaging, label text, texture, size. Be specific for AI image generation. Under 80 words.',
          maxTokens: 300,
        });
      } catch (e) {
        console.warn('Product photo analysis failed (non-fatal):', e.message);
      }
    }

    // ── Phase 2: upload product photo reference ───────────────────────────────
    const referenceImageUrls = [];
    if (generateImages && productPhotoBase64) {
      send({ type: 'status', message: 'Menyiapkan referensi produk…' });
      try {
        const url = await uploadImageToApimart(productPhotoBase64, productPhotoMime || 'image/jpeg');
        if (url) { referenceImageUrls.push(url); }
      } catch (e) { console.warn('Product photo upload failed (non-fatal):', e.message); }
    }

    // ── Phase 3: generate angle concepts + copy ───────────────────────────────
    const onStatus = (msg) => send({ type: 'status', message: msg });
    const angles = await generateScalingAngles(
      analysis, productName, selectedAngles, productVisualDescription, productDescription, masterImagePrompt, onStatus
    );
    if (!angles.length) {
      send({ type: 'error', message: 'Gagal generate scaling angles' });
      return res.end();
    }

    const variationsWithPrompts = await generateVariationPrompts(
      analysis, angles, productName, productVisualDescription,
      { productPrice, productPromoPrice }, masterImagePrompt, productDescription, onStatus
    );

    // ── Phase 4: image generation with live progress ──────────────────────────
    if (!generateImages) {
      send({
        type: 'done',
        productName, aspectRatio,
        totalVariations: variationsWithPrompts.length,
        variations: variationsWithPrompts,
        productVisualDescription,
        usedReferenceImages: 0,
      });
      return res.end();
    }

    // Calculate total images upfront so frontend can show the bar immediately
    const totalImages = variationsWithPrompts
      .filter((v) => v.imagePrompt)
      .reduce((sum, v) => {
        const qty = angleQuantities?.[v.angle];
        return sum + (qty ? Math.min(Math.max(parseInt(qty) || 1, 1), 5) : Math.min(Math.max(parseInt(imagesPerAngle) || 1, 1), 5));
      }, 0);

    send({ type: 'start', totalImages, totalAngles: variationsWithPrompts.length });

    const finalVariations = await batchGenerateImages(
      variationsWithPrompts, aspectRatio, referenceImageUrls, imagesPerAngle, angleQuantities,
      (completed, total, angle, headline) => {
        send({ type: 'progress', completed, total, angle, headline });
      },
      onStatus
    );

    send({
      type: 'done',
      productName, aspectRatio,
      totalVariations: finalVariations.length,
      variations: finalVariations,
      productVisualDescription,
      usedReferenceImages: referenceImageUrls.length,
    });
    res.end();
  } catch (err) {
    console.error('[generate-variations-stream] error:', err.message);
    send({ type: 'error', message: err.message || 'Internal server error' });
    res.end();
  }
});

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
    productPrice = null,
    productPromoPrice = null,
    masterImagePrompt = null,
    imagesPerAngle = 1,
    angleQuantities = {},
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
        maxTokens: 300,
      });
    } catch (e) {
      console.warn('Product photo analysis failed (non-fatal):', e.message);
    }
  }

  // Upload ONLY product photo as visual reference.
  // Winning ad style/layout comes through the text prompt (masterImagePrompt / A-K analysis).
  // DO NOT pass winning ad as visual reference — it causes the AI to copy the winning product
  // into the generated image instead of substituting our product.
  const referenceImageUrls = [];
  if (generateImages && productPhotoBase64) {
    try {
      const url = await uploadImageToApimart(productPhotoBase64, productPhotoMime || 'image/jpeg');
      if (url) { referenceImageUrls.push(url); console.log('Product photo uploaded:', url.slice(0, 60)); }
    } catch (e) { console.warn('Product photo upload failed (non-fatal):', e.message); }
  }

  const angles = await generateScalingAngles(
    analysis, productName, selectedAngles, productVisualDescription, productDescription, masterImagePrompt
  );
  if (!angles.length) return res.status(422).json({ error: 'Gagal generate scaling angles — coba lagi atau kurangi jumlah angle.' });

  const variationsWithPrompts = await generateVariationPrompts(analysis, angles, productName, productVisualDescription, { productPrice, productPromoPrice }, masterImagePrompt, productDescription);

  let finalVariations = variationsWithPrompts;
  if (generateImages) {
    finalVariations = await batchGenerateImages(variationsWithPrompts, aspectRatio, referenceImageUrls, imagesPerAngle, angleQuantities);
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

router.post('/generate-carousel', async (req, res) => {
  const {
    analysis,
    productName,
    productDescription = '',
    productVisualDescription: incomingVisualDesc = null,
    slideCount = 5,
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

  // Resolve product visual description — use provided or derive from product photo
  let productVisualDescription = incomingVisualDesc;
  if (!productVisualDescription && productPhotoBase64) {
    try {
      productVisualDescription = await analyzeImage({
        imageBase64: productPhotoBase64,
        mimeType: productPhotoMime || 'image/jpeg',
        prompt: 'Describe this product visually in detail: shape, color, packaging, label text, texture, size. Be specific for AI image generation. Under 80 words.',
        maxTokens: 300,
      });
    } catch (e) {
      console.warn('Carousel product photo analysis failed (non-fatal):', e.message);
    }
  }

  const clampedSlideCount = Math.min(Math.max(parseInt(slideCount) || 5, 3), 8);
  const productVisualNote = productVisualDescription
    ? `\n\nDeskripsi visual produk: ${productVisualDescription}`
    : '';

  const carouselPrompt = `Kamu adalah Meta Ads carousel specialist & copywriter Indonesia.
PENTING: Semua teks copy (headline, subtext) HARUS dalam Bahasa Indonesia.

Buat carousel Meta Ads ${clampedSlideCount} slide untuk:
Produk: ${productName}
${productDescription ? `Deskripsi lengkap (WAJIB dipakai — sebutkan ingredient spesifik, kondisi target, klaim unik di tiap benefit slide):\n${productDescription}` : ''}${productVisualNote}

Referensi dari winning ad:
- Hook style: ${analysis.hookMechanism || analysis.hook || 'engaging hook'}
- Visual style: ${analysis.visualStyle || 'professional editorial'}
- Color palette: ${(analysis.colorPalette || []).join(', ')}
- Mood: ${analysis.mood || 'engaging'}
- Emotion: ${analysis.primaryEmotion || 'desire'}
- Composition type: ${analysis.compositionType || 'model_with_product'}

Struktur WAJIB:
- Slide 1: type "hook" — gunakan hook style yang sama dari winning ad, adaptasi untuk ${productName}. Jangan generik. Harus scroll-stopping.
- Slide 2 sampai ${clampedSlideCount - 1}: type "benefit" — tiap slide 1 manfaat/USP SPESIFIK dari deskripsi produk (sebutkan ingredient, angka, kondisi target). Beda tiap slide.
- Slide ${clampedSlideCount}: type "cta" — strong call to action, buat orang ingin beli sekarang.

Return JSON array dengan tepat ${clampedSlideCount} item, tanpa markdown:
[
  {
    "slideNumber": 1,
    "type": "hook",
    "headline": "teks utama (Indonesia, max 8 kata, scroll-stopping)",
    "subtext": "teks pendukung (Indonesia, max 20 kata, spesifik)",
    "cta": "teks CTA (Indonesia, max 5 kata) — hanya untuk slide type cta"
  }
]`;

  const response = await chatCompletion({
    model: config.models.chat,
    messages: [
      { role: 'system', content: 'Kamu adalah Meta Ads carousel specialist. Return only valid JSON array, no markdown.' },
      { role: 'user', content: carouselPrompt },
    ],
    maxTokens: 2000,
    temperature: 0.8,
  });

  let slides = [];
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) slides = JSON.parse(jsonMatch[0]);
    else throw new Error('No JSON array found');
  } catch (e) {
    return res.status(500).json({ error: 'Failed to generate carousel structure: ' + e.message });
  }

  // Build detailed composition-aware image prompts for each slide
  slides = slides.map((slide) => ({
    ...slide,
    imagePrompt: buildCarouselSlidePrompt(slide, analysis, productName, productVisualDescription || null, productDescription || null),
  }));

  if (generateImages) {
    const sizeMap = { '1:1': '1024x1024', '9:16': '1024x1536', '16:9': '1536x1024' };
    const size = sizeMap[aspectRatio] || '1024x1024';

    // Upload ONLY product photo as visual reference — same rule as angle variations.
    // Winning ad is NOT passed visually to prevent product contamination.
    const referenceImageUrls = [];
    if (productPhotoBase64) {
      try {
        const url = await uploadImageToApimart(productPhotoBase64, productPhotoMime || 'image/jpeg');
        if (url) { referenceImageUrls.push(url); console.log('Carousel: product photo uploaded:', url.slice(0, 60)); }
      } catch (e) { console.warn('Carousel product photo upload failed (non-fatal):', e.message); }
    }

    const imageResults = await Promise.allSettled(
      slides.map((slide) =>
        slide.imagePrompt
          ? generateImage({
              prompt: slide.imagePrompt,
              size,
              referenceImages: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
            })
          : Promise.resolve(null)
      )
    );
    slides = slides.map((slide, i) => ({
      ...slide,
      imageUrl: imageResults[i].status === 'fulfilled' && imageResults[i].value
        ? imageResults[i].value[0]?.url || null
        : null,
      imageError: imageResults[i].status === 'rejected' ? imageResults[i].reason?.message : null,
    }));
  }

  res.json({ totalSlides: slides.length, productName, slides });
});

router.post('/generate-image', async (req, res) => {
  const { prompt, aspectRatio = '1:1' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  const sizeMap = { '1:1': '1024x1024', '9:16': '1024x1792', '16:9': '1792x1024' };
  const images = await generateImage({ prompt, size: sizeMap[aspectRatio] || '1024x1024' });
  res.json({ images, prompt });
});

router.post('/generate-video', async (req, res) => {
  const { prompt, aspectRatio = '9:16', duration = 10 } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  const arMap = { '9:16': 'portrait', '16:9': 'landscape', '1:1': 'square' };
  const { uuid } = await generateFirstClip({
    prompt,
    mode: 'normal',
    aspectRatio: arMap[aspectRatio] || 'portrait',
    resolution: '720p',
    clipDuration: typeof duration === 'number' ? duration : parseInt(duration) || 10,
  });
  const { videoUrl, thumbnailUrl } = await pollUntilComplete(uuid);
  res.json({ uuid, videoUrl, thumbnailUrl });
});

module.exports = router;
