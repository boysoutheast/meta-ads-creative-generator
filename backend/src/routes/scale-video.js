const express = require('express');
const router = express.Router();
const fs = require('fs');
const upload = require('../middleware/upload');
const { analyzeVideoReference } = require('../services/videoAnalyzer');
const {
  SCALING_ANGLES,
  generateScalingAngles,
  generateVariationPrompts,
  batchGenerateVideos,
} = require('../services/scalingService');
const axios = require('axios');
const { analyzeImage, uploadImageToApimart } = require('../services/apimart');
const { startRemakeJob, getJob } = require('../services/videoRemakeService');

/**
 * POST /api/scale-video/analyze
 * Upload & analyze a winning video ad — returns video analysis + available angles
 */
router.post('/analyze', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Video file is required' });
  if (!req.file.mimetype.startsWith('video/')) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Only video files are accepted' });
  }
  try {
    const { analysis, frames } = await analyzeVideoReference(req.file.path);
    fs.unlink(req.file.path, () => {});

    const availableAngles = Object.entries(SCALING_ANGLES).map(([key, val]) => ({
      key,
      label: val.label,
      hook: val.hook,
    }));

    res.json({ analysis, framesAnalyzed: frames, filename: req.file.originalname, availableAngles });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    throw err;
  }
});

/**
 * POST /api/scale-video/generate
 * Generate angle variations as 10-second GeminiGen grok-3 videos.
 * Mirror of /scale/generate-variations — same angle pipeline, video output.
 */
router.post('/generate', async (req, res) => {
  const {
    videoAnalysis,
    productName,
    productDescription = '',
    selectedAngles = [],
    aspectRatio = '9:16',
    productPhotoBase64 = null,
    productPhotoMime = 'image/jpeg',
  } = req.body;

  if (!videoAnalysis || !productName) {
    return res.status(400).json({ error: 'videoAnalysis and productName are required' });
  }

  // Step 1: Describe product visually from photo
  let productVisualDescription = null;
  if (productPhotoBase64) {
    try {
      productVisualDescription = await analyzeImage({
        imageBase64: productPhotoBase64,
        mimeType: productPhotoMime || 'image/jpeg',
        prompt: 'Describe this product visually in detail: shape, color, packaging, texture, size, label/branding. Be specific for AI video generation. Under 80 words.',
      });
    } catch (e) {
      console.warn('Product photo analysis failed (non-fatal):', e.message);
    }
  }

  // Step 2: Upload product photo as image-to-video reference for GeminiGen
  let productImageUrl = null;
  if (productPhotoBase64) {
    try {
      productImageUrl = await uploadImageToApimart(productPhotoBase64, productPhotoMime || 'image/jpeg');
      if (productImageUrl) console.log('Product photo uploaded for GeminiGen:', productImageUrl.slice(0, 60));
    } catch (e) {
      console.warn('Product photo upload for video failed (non-fatal):', e.message);
    }
  }

  // Step 3: Generate scaling angles using video analysis as the "winning ad DNA"
  const angles = await generateScalingAngles(
    videoAnalysis,
    productName,
    selectedAngles,
    productVisualDescription,
    productDescription,
    null
  );
  if (!angles.length) {
    return res.status(500).json({ error: 'Failed to generate scaling angles' });
  }

  // Step 4: Build per-angle prompts (same pipeline as images)
  const variationsWithPrompts = await generateVariationPrompts(
    videoAnalysis,
    angles,
    productName,
    productVisualDescription,
    {},
    null
  );

  // Step 5: Batch generate 10-second GeminiGen grok-3 videos for every variation
  const finalVariations = await batchGenerateVideos(variationsWithPrompts, aspectRatio, productImageUrl);

  res.json({
    productName,
    aspectRatio,
    totalVariations: finalVariations.length,
    variations: finalVariations,
    productVisualDescription,
  });
});

/**
 * GET /api/scale-video/status/:taskId
 * Manual task status check (for debugging)
 */
router.get('/status/:taskId', async (req, res) => {
  const { taskId } = req.params;
  try {
    const { data } = await axios.get(`https://api.geminigen.ai/uapi/v1/history/${taskId}`, {
      headers: { 'x-api-key': process.env.GEMINIGEN_API_KEY || '' },
      timeout: 10000,
    });
    const videoUrl = data.generated_video?.[0]?.video_url || null;
    const status = data.status === 2 ? 'completed' : data.status === 3 ? 'failed' : 'processing';
    res.json({ taskId, status, videoUrl, progress: data.status_percentage || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/scale-video/remake
 * Upload source video + product info → start async remake job.
 * Returns { remakeId } immediately; poll /remake/:remakeId for status.
 *
 * Cost: ~$0.044/sec of output. 21s output ≈ $0.92 per remake.
 * Body (multipart/form-data):
 *   file            — source video (mp4/mov)
 *   productName     — required
 *   productDescription (optional)
 *   productPhotoBase64 (optional)
 *   productPhotoMime   (optional)
 *   aspectRatio     — '9:16' | '16:9' | '1:1' (default '9:16')
 *   targetSeconds   — desired total output duration (default 21)
 *   clipCount       — number of clips to extract (default 3)
 */
router.post('/remake', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Video file is required' });
  if (!req.file.mimetype.startsWith('video/')) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Only video files are accepted' });
  }

  const {
    productName,
    productDescription = '',
    productPhotoBase64 = null,
    productPhotoMime = 'image/jpeg',
    aspectRatio = '9:16',
    targetSeconds = 21,
    clipCount = 3,
  } = req.body;

  if (!productName) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'productName is required' });
  }

  const job = startRemakeJob({
    sourceVideoPath: req.file.path,
    productName,
    productDescription,
    productPhotoBase64: productPhotoBase64 || null,
    productPhotoMime,
    aspectRatio,
    targetSeconds: parseInt(targetSeconds) || 21,
    clipCount: Math.min(parseInt(clipCount) || 3, 5),
  });

  const estimatedCost = `$${(Math.min(parseInt(targetSeconds) || 21, 35) * 0.044).toFixed(2)}`;

  res.json({
    remakeId: job.id,
    status: job.status,
    message: 'Remake dimulai. Poll /api/scale-video/remake/' + job.id + ' untuk status.',
    estimatedCostUsd: estimatedCost,
    estimatedMinutes: '4-8',
  });
});

/**
 * GET /api/scale-video/remake/:remakeId
 * Poll status of a remake job.
 */
router.get('/remake/:remakeId', (req, res) => {
  const job = getJob(req.params.remakeId);
  if (!job) return res.status(404).json({ error: 'Remake job not found (expired or invalid ID)' });

  res.json({
    remakeId: job.id,
    status: job.status,
    progress: job.progress,
    log: job.log,
    videoUrl: job.videoUrl,
    error: job.error,
    createdAt: job.createdAt,
  });
});

module.exports = router;
