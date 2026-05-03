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
const { generateVideo } = require('../services/apimart');

/**
 * GET /api/scale/angles
 * Get available scaling angles
 */
router.get('/angles', (req, res) => {
  res.json({ angles: SCALING_ANGLES });
});

/**
 * POST /api/scale/analyze-winning
 * Upload & analyze a winning ad (image or video)
 */
router.post('/analyze-winning', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'File is required' });
  }

  const isVideo = req.file.mimetype.startsWith('video/');

  try {
    let analysis;
    if (isVideo) {
      const { analysis: videoAnalysis, frames } = await analyzeVideoReference(req.file.path);
      analysis = { raw: videoAnalysis, framesAnalyzed: frames, type: 'video' };
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

/**
 * POST /api/scale/generate-variations
 * Generate N variations from a winning ad analysis
 * Body: { analysis, productName, selectedAngles: [], aspectRatio, generateImages }
 */
router.post('/generate-variations', async (req, res) => {
  const {
    analysis,
    productName,
    selectedAngles = [],
    aspectRatio = '1:1',
    generateImages = false,
  } = req.body;

  if (!analysis || !productName) {
    return res.status(400).json({ error: 'analysis and productName are required' });
  }

  // Step 1: Generate angles (copy + image direction)
  const angles = await generateScalingAngles(analysis, productName, selectedAngles);

  if (!angles.length) {
    return res.status(500).json({ error: 'Failed to generate scaling angles' });
  }

  // Step 2: Generate image prompts per angle
  const variationsWithPrompts = await generateVariationPrompts(analysis, angles, productName);

  // Step 3: Optionally generate images
  let finalVariations = variationsWithPrompts;
  if (generateImages) {
    finalVariations = await batchGenerateImages(variationsWithPrompts, aspectRatio);
  }

  res.json({
    productName,
    aspectRatio,
    totalVariations: finalVariations.length,
    variations: finalVariations,
  });
});

/**
 * POST /api/scale/generate-image
 * Generate image for a single variation by prompt
 */
router.post('/generate-image', async (req, res) => {
  const { prompt, aspectRatio = '1:1' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const { generateImage } = require('../services/apimart');
  const sizeMap = { '1:1': '1024x1024', '9:16': '1024x1792', '16:9': '1792x1024' };
  const images = await generateImage({ prompt, size: sizeMap[aspectRatio] || '1024x1024' });

  res.json({ images, prompt });
});

/**
 * POST /api/scale/generate-video
 * Generate video variation
 */
router.post('/generate-video', async (req, res) => {
  const { prompt, aspectRatio = '9:16', duration = 5 } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const result = await generateVideo({ prompt, aspectRatio, duration });
  res.json(result);
});

module.exports = router;
