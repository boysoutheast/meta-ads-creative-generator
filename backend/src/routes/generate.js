const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const { generateAdPrompt, generateSlideCopy } = require('../services/promptGenerator');
const { generateImage, generateVideo, checkVideoStatus } = require('../services/apimart');
const { analyzeImageReference, analyzeVideoReference, generateVideoPromptFromReference } = require('../services/videoAnalyzer');

/**
 * POST /api/generate/prompt
 * Generate AI prompt for a slide
 */
router.post('/prompt', async (req, res) => {
  const {
    productName,
    slideRole,
    slideIndex,
    totalSlides,
    visualStyle,
    contentType,
    format,
    platform,
    aspectRatio,
    productDescription,
    referenceAnalysis,
    brandColors,
    language,
  } = req.body;

  if (!productName || !slideRole) {
    return res.status(400).json({ error: 'productName and slideRole are required' });
  }

  const [imagePrompt, slideCopy] = await Promise.all([
    generateAdPrompt({
      productName,
      slideRole,
      slideIndex: slideIndex || 1,
      totalSlides: totalSlides || 1,
      visualStyle: visualStyle || 'daily-social',
      contentType: contentType || 'carousel',
      format: format || 'penjelasan singkat',
      platform: platform || 'Meta Ads',
      aspectRatio: aspectRatio || '1:1',
      productDescription,
      referenceAnalysis,
      brandColors,
      language,
    }),
    generateSlideCopy({
      productName,
      slideRole,
      visualStyle: visualStyle || 'daily-social',
      contentFormat: format || 'penjelasan singkat',
      productDescription,
      language,
    }),
  ]);

  res.json({
    imagePrompt,
    slideCopy,
    slideRole,
    slideIndex,
  });
});

/**
 * POST /api/generate/image
 * Generate image from prompt
 */
router.post('/image', async (req, res) => {
  const { prompt, aspectRatio = '1:1', quality = 'standard', style = 'vivid' } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  // Map aspect ratio to DALL-E size
  const sizeMap = {
    '1:1': '1024x1024',
    '9:16': '1024x1792',
    '16:9': '1792x1024',
    '4:5': '1024x1024', // closest available
  };
  const size = sizeMap[aspectRatio] || '1024x1024';

  const images = await generateImage({ prompt, size, quality, style });

  res.json({
    images,
    prompt,
    size,
  });
});

/**
 * POST /api/generate/video
 * Generate video from prompt
 */
router.post('/video', async (req, res) => {
  const { prompt, aspectRatio = '9:16', duration = 5 } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const result = await generateVideo({ prompt, aspectRatio, duration });

  res.json(result);
});

/**
 * GET /api/generate/video/:taskId
 * Check video generation status
 */
router.get('/video/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const result = await checkVideoStatus(taskId);
  res.json(result);
});

/**
 * POST /api/generate/full-carousel
 * Generate all slides for a carousel in one request
 */
router.post('/full-carousel', async (req, res) => {
  const {
    productName,
    totalSlides = 5,
    visualStyle,
    contentType = 'carousel',
    aspectRatio = '1:1',
    productDescription,
    referenceAnalysis,
    brandColors,
    language,
    slides, // array of { slideRole, format }
    generateImages = false, // set true to also generate images (slower)
  } = req.body;

  if (!productName) {
    return res.status(400).json({ error: 'productName is required' });
  }

  // Default slide structure if not provided
  const defaultSlides = [
    { slideRole: 'hook', format: 'attention grabber' },
    { slideRole: 'problem', format: 'penjelasan singkat' },
    { slideRole: 'solution', format: 'penjelasan singkat' },
    { slideRole: 'proof', format: 'testimonial/bukti' },
    { slideRole: 'cta', format: 'call to action' },
  ].slice(0, totalSlides);

  const slideConfigs = slides || defaultSlides;

  // Generate prompts for all slides in parallel
  const slideResults = await Promise.all(
    slideConfigs.map(async (slide, idx) => {
      const [imagePrompt, slideCopy] = await Promise.all([
        generateAdPrompt({
          productName,
          slideRole: slide.slideRole,
          slideIndex: idx + 1,
          totalSlides: slideConfigs.length,
          visualStyle: visualStyle || 'daily-social',
          contentType,
          format: slide.format,
          aspectRatio,
          productDescription,
          referenceAnalysis,
          brandColors,
          language,
        }),
        generateSlideCopy({
          productName,
          slideRole: slide.slideRole,
          visualStyle: visualStyle || 'daily-social',
          contentFormat: slide.format,
          productDescription,
          language,
        }),
      ]);

      return {
        slideIndex: idx + 1,
        slideRole: slide.slideRole,
        format: slide.format,
        imagePrompt,
        slideCopy,
        imageUrl: null, // will be generated if generateImages=true
      };
    })
  );

  // Optionally generate images (takes longer)
  if (generateImages) {
    const sizeMap = { '1:1': '1024x1024', '9:16': '1024x1792', '16:9': '1792x1024' };
    const size = sizeMap[aspectRatio] || '1024x1024';

    for (const slide of slideResults) {
      try {
        const images = await generateImage({ prompt: slide.imagePrompt, size });
        slide.imageUrl = images[0]?.url || null;
      } catch (err) {
        console.error(`Image generation failed for slide ${slide.slideIndex}:`, err.message);
        slide.imageError = err.message;
      }
    }
  }

  res.json({
    productName,
    totalSlides: slideResults.length,
    visualStyle,
    aspectRatio,
    slides: slideResults,
  });
});

module.exports = router;
