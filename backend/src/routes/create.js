const express = require('express');
const router = express.Router();
const fs = require('fs');
const upload = require('../middleware/upload');
const {
  analyzeReference,
  blendReferenceWithProduct,
  generateAdImagePrompt,
  generateAdCopy,
  generateCarouselFromReference,
} = require('../services/referenceService');
const { generateImage } = require('../services/apimart');
const { generateFirstClip, pollUntilComplete } = require('../services/geminiGenService');
const { analyzeVideoReference } = require('../services/videoAnalyzer');

/**
 * POST /api/create/analyze-reference
 * Upload reference ad (image or video) and analyze its style
 */
router.post('/analyze-reference', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Reference file is required' });
  }

  const isVideo = req.file.mimetype.startsWith('video/');

  try {
    let analysis;
    if (isVideo) {
      const { analysis: videoAnalysis, frames, frameAnalyses } = await analyzeVideoReference(req.file.path);
      // Try to parse as JSON if video analysis returns structured data
      try {
        const jsonMatch = videoAnalysis.match(/\{[\s\S]*\}/);
        analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: videoAnalysis };
      } catch {
        analysis = { raw: videoAnalysis };
      }
      analysis.type = 'video';
      analysis.framesAnalyzed = frames;
    } else {
      analysis = await analyzeReference(req.file.path, 'image');
      analysis.type = 'image';
    }

    fs.unlink(req.file.path, () => {});

    res.json({
      analysis,
      filename: req.file.originalname,
    });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    throw err;
  }
});

/**
 * POST /api/create/generate
 * Generate ad (single image or video) from reference + product info
 * Body: {
 *   referenceAnalysis,
 *   productInfo: { productName, description, usp, targetAudience, adGoal, brandColors },
 *   format: '1:1' | '9:16' | '16:9' | '4:5',
 *   outputType: 'image' | 'video',
 *   language: 'id' | 'en' | 'bilingual',
 *   variations: 1 | 3 | 5,
 *   generateImages: true | false
 * }
 */
router.post('/generate', async (req, res) => {
  const {
    referenceAnalysis,
    productInfo,
    format = '1:1',
    outputType = 'image',
    language = 'id',
    variations = 1,
    generateImages = false,
  } = req.body;

  if (!referenceAnalysis || !productInfo?.productName) {
    return res.status(400).json({ error: 'referenceAnalysis and productInfo.productName are required' });
  }

  // Blend reference style with product info
  const blendedContext = await blendReferenceWithProduct(referenceAnalysis, productInfo);

  // Generate N variations
  const variationResults = await Promise.allSettled(
    Array.from({ length: variations }, async (_, i) => {
      const [imagePrompt, copy] = await Promise.all([
        generateAdImagePrompt(referenceAnalysis, productInfo, blendedContext, format),
        generateAdCopy(productInfo, blendedContext, language, format),
      ]);

      let imageUrl = null;
      let videoJobId = null;

      if (generateImages && outputType === 'image') {
        const sizeMap = { '1:1': '1024x1024', '9:16': '1024x1792', '16:9': '1792x1024', '4:5': '1024x1024' };
        try {
          const images = await generateImage({ prompt: imagePrompt, size: sizeMap[format] || '1024x1024' });
          imageUrl = images[0]?.url || null;
        } catch (err) {
          console.error('Image generation failed:', err.message);
        }
      } else if (outputType === 'video') {
        try {
          const arMap = { '9:16': 'portrait', '16:9': 'landscape', '1:1': 'square', '4:5': 'portrait' };
          const { uuid } = await generateFirstClip({
            prompt: imagePrompt,
            mode: 'normal',
            aspectRatio: arMap[format] || 'portrait',
            resolution: '720p',
            clipDuration: 10,
          });
          const result = await pollUntilComplete(uuid);
          videoJobId = result.videoUrl || null;  // reuse videoJobId field — frontend reads it as videoUrl
        } catch (err) {
          console.error('Video generation failed:', err.message);
        }
      }

      return {
        variationIndex: i + 1,
        imagePrompt,
        copy,
        imageUrl,
        videoJobId,
        format,
        outputType,
      };
    })
  );

  const results = variationResults.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { variationIndex: i + 1, error: r.reason?.message, imagePrompt: null, copy: null }
  );

  res.json({
    productName: productInfo.productName,
    format,
    outputType,
    language,
    totalVariations: results.length,
    blendedContext,
    results,
  });
});

/**
 * POST /api/create/carousel
 * Generate full carousel from reference + product info
 * Body: { referenceAnalysis, productInfo, slideCount, language, generateImages }
 */
router.post('/carousel', async (req, res) => {
  const {
    referenceAnalysis,
    productInfo,
    slideCount = 5,
    language = 'id',
    generateImages = false,
  } = req.body;

  if (!referenceAnalysis || !productInfo?.productName) {
    return res.status(400).json({ error: 'referenceAnalysis and productInfo.productName are required' });
  }

  const blendedContext = await blendReferenceWithProduct(referenceAnalysis, productInfo);
  const slides = await generateCarouselFromReference(
    referenceAnalysis,
    productInfo,
    blendedContext,
    slideCount,
    language
  );

  // Optionally generate images for each slide
  if (generateImages && slides.length > 0) {
    const imageResults = await Promise.allSettled(
      slides.map((slide) => {
        if (!slide.imagePrompt) return Promise.resolve(null);
        return generateImage({ prompt: slide.imagePrompt, size: '1024x1024' });
      })
    );
    slides.forEach((slide, i) => {
      if (imageResults[i].status === 'fulfilled' && imageResults[i].value) {
        slide.imageUrl = imageResults[i].value[0]?.url || null;
      }
    });
  }

  res.json({
    productName: productInfo.productName,
    totalSlides: slides.length,
    blendedContext,
    slides,
  });
});

module.exports = router;
