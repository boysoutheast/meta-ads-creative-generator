const express = require('express');
const router = express.Router();
const fs = require('fs');
const upload = require('../middleware/upload');
const { analyzeImageReference, analyzeVideoReference, generateVideoPromptFromReference } = require('../services/videoAnalyzer');

/**
 * POST /api/analyze/image
 * Analyze an image reference for visual style
 */
router.post('/image', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Image file is required' });
  }

  try {
    const analysis = await analyzeImageReference(req.file.path);

    // Clean up uploaded file
    fs.unlink(req.file.path, () => {});

    res.json({
      analysis,
      filename: req.file.originalname,
      type: 'image',
    });
  } catch (error) {
    fs.unlink(req.file.path, () => {});
    throw error;
  }
});

/**
 * POST /api/analyze/video
 * Analyze a video reference - extract frames and analyze style
 */
router.post('/video', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Video file is required' });
  }

  const { productName, adGoal } = req.body;

  try {
    const { analysis, frames, frameAnalyses } = await analyzeVideoReference(req.file.path);

    // Optionally generate a video prompt from the analysis
    let videoPrompt = null;
    if (productName) {
      videoPrompt = await generateVideoPromptFromReference(analysis, productName, adGoal || 'brand awareness');
    }

    // Clean up uploaded file
    fs.unlink(req.file.path, () => {});

    res.json({
      analysis,
      videoPrompt,
      framesAnalyzed: frames,
      filename: req.file.originalname,
      type: 'video',
    });
  } catch (error) {
    fs.unlink(req.file.path, () => {});
    throw error;
  }
});

/**
 * POST /api/analyze/generate-video-prompt
 * Generate video prompt from existing analysis text
 */
router.post('/generate-video-prompt', async (req, res) => {
  const { referenceAnalysis, productName, adGoal } = req.body;

  if (!referenceAnalysis || !productName) {
    return res.status(400).json({ error: 'referenceAnalysis and productName are required' });
  }

  const { generateVideoPromptFromReference } = require('../services/videoAnalyzer');
  const videoPrompt = await generateVideoPromptFromReference(referenceAnalysis, productName, adGoal || 'brand awareness');

  res.json({ videoPrompt });
});

module.exports = router;
