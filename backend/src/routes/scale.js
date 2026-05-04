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
} = require('../services/scalingService');
const { analyzeVideoReference } = require('../services/videoAnalyzer');
const { analyzeImage, uploadImageToApimart, generateImage, generateVideo, chatCompletion } = require('../services/apimart');
const config = require('../config');

router.get('/angles', (req, res) => {
  res.json({ angles: SCALING_ANGLES });
});

router.post('/analyze-winning', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File is required' });
  const isVideo = req.file.mimetype.startsWith('video/');
  try {
    let analysis;
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
  } = req.body;

  if (!analysis || !productName) {
    return res.status(400).json({ error: 'analysis and productName are required' });
  }

  // Step 1: Get product visual description from photo if provided
  let productVisualDescription = null;
  if (productPhotoBase64) {
    try {
      productVisualDescription = await analyzeImage({
        imageBase64: productPhotoBase64,
        mimeType: productPhotoMime || 'image/jpeg',
        prompt: 'Describe this product visually in detail: shape, color, packaging, texture, size, label/branding. Be specific so an image generation AI can recreate it accurately. Keep response under 100 words.',
      });
    } catch (e) {
      console.warn('Product photo analysis failed:', e.message);
    }
  }

  // Step 2: Upload photo to apimart to get public URL for flux-kontext-pro reference
  let productImageUrl = null;
  if (productPhotoBase64 && generateImages) {
    try {
      productImageUrl = await uploadImageToApimart(productPhotoBase64, productPhotoMime || 'image/jpeg');
      if (productImageUrl) {
        console.log('Product photo uploaded to apimart:', productImageUrl);
      }
    } catch (e) {
      // Non-fatal: fall back to text-only generation
      console.warn('Product photo upload to apimart failed (non-fatal):', e.message);
    }
  }

  const angles = await generateScalingAngles(
    analysis, productName, selectedAngles, productVisualDescription, productDescription
  );
  if (!angles.length) return res.status(500).json({ error: 'Failed to generate scaling angles' });

  const variationsWithPrompts = await generateVariationPrompts(analysis, angles, productName, productVisualDescription);

  let finalVariations = variationsWithPrompts;
  if (generateImages) {
    // Pass productImageUrl so batchGenerateImages uses flux-kontext-pro when available
    finalVariations = await batchGenerateImages(variationsWithPrompts, aspectRatio, productImageUrl);
  }

  res.json({
    productName,
    aspectRatio,
    totalVariations: finalVariations.length,
    variations: finalVariations,
    productVisualDescription,
    usedFluxKontext: !!productImageUrl,
  });
});

router.post('/generate-carousel', async (req, res) => {
  const {
    analysis,
    productName,
    productDescription = '',
    productVisualDescription = null,
    slideCount = 5,
    aspectRatio = '1:1',
    generateImages = false,
    productPhotoBase64 = null,
    productPhotoMime = 'image/jpeg',
  } = req.body;

  if (!analysis || !productName) {
    return res.status(400).json({ error: 'analysis and productName are required' });
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
- Hook style: ${analysis.hook || analysis.hookMechanism || 'engaging hook'}
- Visual style: ${analysis.visualStyle || 'professional'}
- Color palette: ${(analysis.colorPalette || []).join(', ')}
- Mood: ${analysis.mood || 'engaging'}
- Emotion: ${analysis.primaryEmotion || 'desire'}

Struktur WAJIB:
- Slide 1: type "hook" — gunakan hook style yang sama dari winning ad, adaptasi untuk ${productName}. Jangan generik.
- Slide 2 sampai ${clampedSlideCount - 1}: type "benefit" — tiap slide 1 manfaat/USP SPESIFIK dari deskripsi produk (sebutkan ingredient, angka, kondisi target). Beda tiap slide.
- Slide ${clampedSlideCount}: type "cta" — strong call to action

Return JSON array dengan tepat ${clampedSlideCount} item, tanpa markdown:
[
  {
    "slideNumber": 1,
    "type": "hook",
    "headline": "teks utama (Indonesia, max 8 kata)",
    "subtext": "teks pendukung (Indonesia, max 20 kata)",
    "imagePrompt": "English prompt for AI image generator (80-120 words, NO text in image, replicate winning ad visual style)"
  }
]`;

  const response = await chatCompletion({
    model: config.models.chat,
    messages: [
      { role: 'system', content: 'Kamu adalah Meta Ads carousel specialist. Return only valid JSON array.' },
      { role: 'user', content: carouselPrompt },
    ],
    maxTokens: 2500,
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

  if (generateImages) {
    const sizeMap = { '1:1': '1024x1024', '9:16': '1024x1792', '16:9': '1792x1024' };
    const size = sizeMap[aspectRatio] || '1024x1024';

    // Upload product photo for flux-kontext-pro reference if available
    let carouselImageUrl = null;
    if (productPhotoBase64) {
      try {
        carouselImageUrl = await uploadImageToApimart(productPhotoBase64, productPhotoMime || 'image/jpeg');
      } catch (e) {
        console.warn('Carousel product photo upload failed (non-fatal):', e.message);
      }
    }

    const imageResults = await Promise.allSettled(
      slides.map((slide) =>
        slide.imagePrompt
          ? generateImage({ prompt: slide.imagePrompt, size, imageUrl: carouselImageUrl || undefined })
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
  const { prompt, aspectRatio = '9:16', duration = 5 } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  const result = await generateVideo({ prompt, aspectRatio, duration });
  res.json(result);
});

module.exports = router;
