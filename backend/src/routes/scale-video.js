const express = require('express');
const router = express.Router();
const fs = require('fs');
const crypto = require('crypto');
const upload = require('../middleware/upload');

// ─── In-memory job store for URL analysis polling ────────────────────────────
// Key: jobId (UUID), Value: { status, log[], result, error, createdAt }
// TTL: 30 minutes — cleaned up after client reads a completed job
const URL_JOBS = new Map();
const URL_JOB_TTL_MS = 30 * 60 * 1000;
function cleanupUrlJob(jobId) {
  setTimeout(() => URL_JOBS.delete(jobId), URL_JOB_TTL_MS);
}
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
const { analyzeVideoFromUrl } = require('../services/videoUrlAnalyzer');
const { translateVideoPrompt } = require('../services/translatePromptService');
const { generateSceneImage } = require('../services/sceneImageService');

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
    productName = 'Generic',
    productDescription = '',
    selectedAngles = [],
    aspectRatio = '9:16',
    productPhotoBase64 = null,
    productPhotoMime = 'image/jpeg',
    assetMode = 'product',
    characterPhotosBase64 = [],   // array of base64 strings (no data: prefix), max 10
    customVideoPrompt = null,
  } = req.body;

  if (!videoAnalysis) {
    return res.status(400).json({ error: 'videoAnalysis is required' });
  }

  // Step 1: Describe product visually from photo (product mode)
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

  // Step 1b: Character mode — analyze every uploaded character photo (up to 4 for cost control)
  // and combine into one merged appearance description. First photo is also the image-to-video ref below.
  let characterVisualDescription = null;
  if (assetMode === 'character' && Array.isArray(characterPhotosBase64) && characterPhotosBase64.length > 0) {
    try {
      const charDescriptions = await Promise.all(
        characterPhotosBase64.slice(0, 4).map((b64, i) =>
          analyzeImage({
            imageBase64: b64,
            mimeType: 'image/jpeg',
            prompt: `Describe this character photo ${i + 1}: appearance, outfit, hair, skin tone, expression, style. Be specific for AI video generation. Under 60 words.`,
          }).catch(() => null)
        )
      );
      const valid = charDescriptions.filter(Boolean);
      if (valid.length > 0) {
        characterVisualDescription = `Character "${productName}": ${valid.join(' | ')}`;
      }
    } catch (e) {
      console.warn('Character photo analysis failed (non-fatal):', e.message);
    }
  }

  // For character mode, the visual description threaded into angle prompts
  // comes from character photos, not product photos.
  if (assetMode === 'character' && characterVisualDescription) {
    productVisualDescription = characterVisualDescription;
  }

  // Step 2: Upload reference photo as image-to-video reference for GeminiGen.
  // Product mode: productPhotoBase64. Character mode: first character photo.
  let productImageUrl = null;
  let i2vBase64 = productPhotoBase64;
  let i2vMime = productPhotoMime || 'image/jpeg';
  if (assetMode === 'character' && Array.isArray(characterPhotosBase64) && characterPhotosBase64.length > 0) {
    i2vBase64 = characterPhotosBase64[0];
    i2vMime = 'image/jpeg';
  }
  if (i2vBase64) {
    try {
      productImageUrl = await uploadImageToApimart(i2vBase64, i2vMime);
      if (productImageUrl) console.log(`${assetMode === 'character' ? 'Character' : 'Product'} photo uploaded for GeminiGen:`, productImageUrl.slice(0, 60));
    } catch (e) {
      console.warn('Reference photo upload for video failed (non-fatal):', e.message);
    }
  }

  // ── Fast path: refined prompt → 1 video only, skip angle variation machine ──
  if (customVideoPrompt) {
    console.log('[scale-video/generate] refined prompt detected — generating 1 video directly');
    const singleVar = [{
      imagePrompt: customVideoPrompt,
      angle: 'refined',
      headline: productName,
      subheadline: '',
      bodyText: productDescription || '',
      cta: '',
      translatedConcept: `Refined prompt for "${productName}"`,
    }];
    const finalVariations = await batchGenerateVideos(singleVar, aspectRatio, productImageUrl);
    return res.json({
      productName,
      aspectRatio,
      totalVariations: 1,
      variations: finalVariations,
      productVisualDescription: productVisualDescription || null,
      mode: 'refined',
    });
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
    {},      // productPricing
    null,    // masterImagePrompt
    null,    // productDescription
    null,    // onStatus
    customVideoPrompt || null  // override video prompt with refined version when provided
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

/**
 * POST /api/scale-video/analyze-from-url
 * Starts a background URL analysis job. Returns { jobId } immediately.
 * Poll GET /analyze-from-url-status/:jobId for live log + result.
 *
 * WHY POLLING: Railway's nginx proxy buffers small SSE writes regardless of
 * X-Accel-Buffering header, breaking live streaming. Polling is reliable on any proxy.
 */
router.post('/analyze-from-url', async (req, res) => {
  const { url, mode = 'full' } = req.body || {};
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return res.status(400).json({ error: 'url is required and must start with http' });
  }

  const jobId = crypto.randomUUID();
  const job = { status: 'running', log: [], result: null, error: null, createdAt: Date.now() };
  URL_JOBS.set(jobId, job);

  // Run analysis in background — DO NOT await
  (async () => {
    const onProgress = (evt) => {
      job.log.push({ ts: Date.now(), ...evt });
    };
    try {
      onProgress({ phase: 'start', message: `Menerima URL: ${url.slice(0, 80)}` });
      const { analysis, frames, transcript, platform, mode: usedMode } = await analyzeVideoFromUrl(url, mode, onProgress);
      const availableAngles = Object.entries(SCALING_ANGLES).map(([key, val]) => ({
        key, label: val.label, hook: val.hook,
      }));
      onProgress({ phase: 'finalizing', message: 'Analisis selesai ✓' });
      job.result = { analysis, framesAnalyzed: frames, filename: `${platform}: ${url.slice(-50)}`, platform, transcript, mode: usedMode, availableAngles };
      job.status = 'done';
    } catch (err) {
      const msg = err.message || 'Gagal menganalisis URL';
      const isYtdlpMissing =
        msg.includes('yt-dlp: command not found') || msg.includes("yt-dlp' is not recognized") ||
        msg.includes('yt-dlp tidak terinstall') || (msg.includes('ENOENT') && msg.includes('yt-dlp')) ||
        (err.code === 'ENOENT' && String(err.path || '').includes('yt-dlp'));
      job.error = isYtdlpMissing
        ? 'yt-dlp tidak tersedia. Untuk Instagram/TikTok gunakan Upload File manual, atau coba YouTube URL.'
        : msg;
      job.status = 'error';
    }
  })();

  res.json({ jobId });
});

/**
 * GET /api/scale-video/analyze-from-url-status/:jobId
 * Poll for analysis job status + live log.
 * Returns: { status: 'running'|'done'|'error', log: [], result?, error? }
 */
router.get('/analyze-from-url-status/:jobId', (req, res) => {
  const job = URL_JOBS.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired' });

  res.json({
    status: job.status,
    log: job.log,
    result: job.result,
    error: job.error,
  });

  // Schedule cleanup once job is terminal
  if (job.status !== 'running') cleanupUrlJob(req.params.jobId);
});

/**
 * POST /api/scale-video/translate-prompt
 * Given video analysis + user intent, generate a tailored GeminiGen video prompt.
 * Body: { videoAnalysis, userIntent, productName, productDescription? }
 * Returns: { videoPrompt, hookVariants, scriptOutline }
 */
router.post('/translate-prompt', async (req, res) => {
  const {
    videoAnalysis,
    userIntent,
    productName,
    productDescription = '',
    assetMode = 'product',
    characterPhotosBase64 = [],   // array of base64 data URLs or raw base64, all photos, max 10
    productPhotoBase64 = null,    // product mode: single photo
    targetDuration = 30,          // desired output duration in seconds (multiples of 10)
  } = req.body || {};
  if (!videoAnalysis || !userIntent || !productName) {
    return res.status(400).json({ error: 'videoAnalysis, userIntent, and productName are required' });
  }
  try {
    const result = await translateVideoPrompt({
      videoAnalysis,
      userIntent,
      productName,
      productDescription,
      assetMode,
      characterPhotosBase64: Array.isArray(characterPhotosBase64) ? characterPhotosBase64 : [],
      productPhotoBase64: productPhotoBase64 || null,
      targetDuration: Math.min(120, Math.max(10, Math.round((parseInt(targetDuration) || 10) / 10) * 10)), // 10-120s, multiples of 10
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Gagal generate prompt' });
  }
});

/**
 * POST /api/scale-video/generate-scene-images
 * Generate one preview image per adapted scene using gpt-image-2.
 * Body: {
 *   adaptedScenes: [{ scene, duration, voiceover, imagePrompt }],
 *   assetPhotosBase64?: string[]  — base64 data URLs of product/character photos used as reference
 * }
 * Returns: { scenes: [{ scene, duration, voiceover, imagePrompt, imageUrl }] }
 */
router.post('/generate-scene-images', async (req, res) => {
  const { adaptedScenes, assetPhotosBase64 } = req.body || {};
  if (!Array.isArray(adaptedScenes) || adaptedScenes.length === 0) {
    return res.status(400).json({ error: 'adaptedScenes array is required' });
  }

  // Build referenceImages from asset photos — pass all up to 10 for maximum character fidelity
  const referenceImages = Array.isArray(assetPhotosBase64) && assetPhotosBase64.length > 0
    ? assetPhotosBase64.slice(0, 10).filter(Boolean)
    : undefined;

  if (referenceImages) {
    console.log(`[scene-images] using ${referenceImages.length} asset reference image(s)`);
  }

  // Generate images in parallel — cap at 10 scenes
  const results = await Promise.all(
    adaptedScenes.slice(0, 10).map(async (s) => {
      const imageUrl = s.imagePrompt
        ? await generateSceneImage(s.imagePrompt, referenceImages).catch((e) => {
            console.warn(`[scene-images] scene ${s.scene} gen failed:`, e.message);
            return null;
          })
        : null;
      return { ...s, imageUrl };
    })
  );

  res.json({ scenes: results });
});

module.exports = router;
