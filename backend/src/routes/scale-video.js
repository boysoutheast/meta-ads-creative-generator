const express = require('express');
const router = express.Router();
const fs = require('fs');
const upload = require('../middleware/upload');
const { analyzeVideoReference } = require('../services/videoAnalyzer');
const { analyzeImage, chatCompletion, generateVideo, getTask } = require('../services/apimart');
const config = require('../config');

/**
 * POST /api/scale-video/analyze
 * Upload & analyze a winning video ad
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
    res.json({ analysis, framesAnalyzed: frames, filename: req.file.originalname });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    throw err;
  }
});

/**
 * POST /api/scale-video/generate
 * Generate a video based on winning ad analysis + product
 */
router.post('/generate', async (req, res) => {
  const {
    videoAnalysis,
    productName,
    productDescription = '',
    productPhotoBase64 = null,
    aspectRatio = '9:16',
    duration = 30,
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
        mimeType: 'image/jpeg',
        prompt: 'Describe this product visually in detail: shape, color, packaging, texture, size, label/branding. Be specific for AI video generation. Under 80 words.',
      });
    } catch (e) {
      console.warn('Product photo analysis failed:', e.message);
    }
  }

  // Step 2: Generate scene-by-scene video script
  const scriptPrompt = `You are a video ad director adapting a winning ad concept for a new product.

Winning ad analysis:
- Hook type: ${videoAnalysis.hookType || 'visual hook'}
- Overall style: ${videoAnalysis.overallStyle || 'professional'}
- Pacing: ${videoAnalysis.pacing || 'moderate'}
- Emotion arc: ${videoAnalysis.emotionArc || 'engagement → desire → action'}
- Color palette: ${(videoAnalysis.colorPalette || []).join(', ')}
- Camera movement: ${videoAnalysis.cameraMovement || 'mixed'}
- Music vibe: ${videoAnalysis.musicVibe || 'uplifting'}
${videoAnalysis.scenes && videoAnalysis.scenes.length > 0 ? `Original scenes: ${JSON.stringify(videoAnalysis.scenes)}` : ''}

New product: ${productName}
${productDescription ? `Product description: ${productDescription}` : ''}
${productVisualDescription ? `Product visual: ${productVisualDescription}` : ''}

Target duration: ${duration} seconds
Aspect ratio: ${aspectRatio}

Create a ${duration}-second video script adapted for ${productName}. Keep the SAME hook structure, emotion arc, visual style, and pacing from the winning ad. Replace ALL product references with ${productName}.

Return ONLY valid JSON array (3-6 scenes):
[
  {
    "scene": 1,
    "duration": "0-3s",
    "description": "detailed scene description",
    "visualStyle": "visual style notes",
    "cameraAngle": "camera angle/movement"
  }
]`;

  const scriptRaw = await chatCompletion({
    model: config.models.chat,
    messages: [
      { role: 'system', content: 'You are a video director. Return only valid JSON array.' },
      { role: 'user', content: scriptPrompt },
    ],
    maxTokens: 1000,
    temperature: 0.8,
  });

  let videoScript = [];
  try {
    const jsonMatch = scriptRaw.match(/\[[\s\S]*\]/);
    if (jsonMatch) videoScript = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.warn('Could not parse video script:', e.message);
  }

  // Step 3: Compile scene descriptions into single video prompt
  const sceneDescriptions = videoScript.length > 0
    ? videoScript.map((s) => `[${s.duration}] ${s.description}`).join(' | ')
    : `Product showcase for ${productName}, ${videoAnalysis.overallStyle || 'professional style'}`;

  const videoPromptRaw = await chatCompletion({
    model: config.models.chat,
    messages: [
      {
        role: 'system',
        content: 'You are an expert at writing prompts for AI video generators (Kling, Runway, Sora). Write in English. Be cinematic and specific.',
      },
      {
        role: 'user',
        content: `Write a single cohesive video generation prompt for this ${duration}-second Meta Ad video.

Product: ${productName}
${productVisualDescription ? `Product visual: ${productVisualDescription}` : ''}
Scene sequence: ${sceneDescriptions}
Style: ${videoAnalysis.overallStyle || 'professional, warm'}
Color palette: ${(videoAnalysis.colorPalette || []).join(', ')}
Emotion arc: ${videoAnalysis.emotionArc || 'engagement to action'}
Pacing: ${videoAnalysis.pacing || 'moderate'}
Music vibe: ${videoAnalysis.musicVibe || 'uplifting'}
Aspect ratio: ${aspectRatio} (${aspectRatio === '9:16' ? 'portrait/vertical' : 'square'})

Write a detailed video prompt (150-200 words). No text overlays or typography. Start with: "A ${duration}-second professional Meta Ads video, "

Output ONLY the prompt, no explanations.`,
      },
    ],
    maxTokens: 400,
    temperature: 0.8,
  });

  const videoPrompt = videoPromptRaw.trim();

  // Step 4: Submit to apimart video generation
  const videoResult = await generateVideo({ prompt: videoPrompt, aspectRatio, duration });
  const taskId = videoResult.id || videoResult.taskId || videoResult.task_id || null;

  res.json({
    taskId,
    videoScript,
    videoPrompt,
    productVisualDescription,
    message: taskId
      ? 'Video generation started. Poll /status/:taskId for progress.'
      : 'Video generation submitted but no taskId returned.',
  });
});

/**
 * GET /api/scale-video/status/:taskId
 * Poll video generation status
 */
router.get('/status/:taskId', async (req, res) => {
  const { taskId } = req.params;
  try {
    const task = await getTask(taskId);
    const status = (task.status || '').toLowerCase();

    let videoUrl = null;
    if (status === 'completed' || status === 'succeed' || status === 'success') {
      videoUrl =
        task.result?.video_url ||
        task.result?.url ||
        task.video_url ||
        task.url ||
        task.output?.url ||
        null;
    }

    const failed = ['failed', 'error', 'cancelled'].includes(status);

    res.json({
      taskId,
      status: failed ? 'failed' : status === 'completed' || status === 'succeed' || status === 'success' ? 'completed' : 'processing',
      videoUrl,
      progress: task.progress || null,
      error: failed ? (task.message || task.error || 'Generation failed') : null,
      raw: task,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
