const axios = require('axios');
const FormData = require('form-data');
const config = require('../config');

const CHAT_BASE = config.apimart.baseUrl; // https://apimart.ai/api/v1
const IMAGE_BASE = process.env.APIMART_IMAGE_BASE || 'https://api.apimart.ai/v1';

const chatClient = axios.create({
  baseURL: CHAT_BASE,
  headers: {
    Authorization: `Bearer ${config.apimart.apiKey}`,
    'Content-Type': 'application/json',
  },
  timeout: 120000,
});

const imageClient = axios.create({
  baseURL: IMAGE_BASE,
  headers: {
    Authorization: `Bearer ${config.apimart.apiKey}`,
    'Content-Type': 'application/json',
  },
  timeout: 60000,
});

async function chatCompletion({ model, messages, maxTokens = 1500, temperature = 0.7 }) {
  const response = await chatClient.post('/chat/completions', {
    model: model || config.models.chat,
    messages,
    max_tokens: maxTokens,
    temperature,
  });
  return response.data.choices[0].message.content;
}

async function analyzeImage({ imageBase64, mimeType = 'image/jpeg', prompt, maxTokens = 6000 }) {
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        { type: 'text', text: prompt },
      ],
    },
  ];
  return await chatCompletion({ model: config.models.vision, messages, maxTokens });
}

async function submitImageJob({ prompt, size = '1024x1024', model, n = 1 }) {
  const payload = {
    model: model || config.models.image,
    prompt,
    size,
    n,
  };
  return submitImageJobPayload(payload);
}

async function submitImageJobPayload(payload) {
  const response = await imageClient.post('/images/generations', payload);
  // Async: { code:200, data:[{ status:"submitted", task_id:"..." }] }
  // Sync:  { code:200, data:[{ url:"..." }] }
  // Also handle: { data: { task_id: "..." } } flat shape
  const rawData = response.data?.data;
  const firstItem = Array.isArray(rawData) ? rawData[0] : rawData;
  if (!firstItem) {
    throw new Error('Invalid image-generation response: ' + JSON.stringify(response.data).slice(0, 300));
  }
  return firstItem;
}

async function getTask(taskId) {
  const response = await imageClient.get(`/tasks/${taskId}`);
  // Handle both { data: {...} } and { data: { data: {...} } }
  return response.data?.data ?? response.data;
}

/**
 * Upload a base64 image to apimart and return a public URL.
 * Used for passing product photos as reference to flux-kontext-pro.
 * @param {string} base64Data - raw base64 (no data: prefix)
 * @param {string} mimeType - e.g. 'image/jpeg'
 * @returns {Promise<string|null>} public URL or null on failure
 */
async function uploadImageToApimart(base64Data, mimeType = 'image/jpeg') {
  const buffer = Buffer.from(base64Data, 'base64');
  const fd = new FormData();
  fd.append('file', buffer, {
    filename: `product-${Date.now()}.jpg`,
    contentType: mimeType,
  });
  const response = await imageClient.post('/uploads/images', fd, {
    headers: { ...fd.getHeaders() },
    timeout: 30000,
  });
  // Response shape: { url: "..." } or { data: { url: "..." } }
  return response.data?.url || response.data?.data?.url || null;
}

// Map legacy sizes to gpt-image-2 supported sizes
const GPT_IMAGE_SIZE_MAP = {
  '1024x1024': '1024x1024',
  '1024x1792': '1024x1536',
  '1792x1024': '1536x1024',
  '1024x1536': '1024x1536',
  '1536x1024': '1536x1024',
};

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

  // Sync path — url returned immediately
  if (submitted.url) {
    const url = Array.isArray(submitted.url) ? submitted.url[0] : submitted.url;
    return [{ url }];
  }

  const taskId = submitted.task_id || submitted.taskId || submitted.id;
  if (!taskId) {
    throw new Error('No task_id in image response: ' + JSON.stringify(submitted).slice(0, 300));
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const task = await getTask(taskId);
    const status = (task.status || '').toLowerCase();

    if (status === 'completed' || status === 'succeed' || status === 'success') {
      // Various result shapes from different providers
      const images =
        task.result?.images ||
        task.images ||
        task.result?.data ||
        task.output?.images ||
        [];
      if (images.length) {
        const url = Array.isArray(images[0].url) ? images[0].url[0] : (images[0].url || images[0]);
        return [{ url }];
      }
      // Some providers put url directly on result
      const directUrl = task.result?.url || task.url || task.output?.url;
      if (directUrl) return [{ url: directUrl }];
      throw new Error('Task completed but no images found: ' + JSON.stringify(task).slice(0, 300));
    }

    if (['failed', 'error', 'cancelled'].includes(status)) {
      throw new Error('Image generation task failed: ' + JSON.stringify(task).slice(0, 300));
    }
    // status pending/processing/queued — keep polling
  }
  throw new Error(`Image generation timed out after ${timeoutMs}ms (task ${taskId})`);
}

/**
 * doubao-seedance-2.0 video-to-video (base mode).
 * Preserves motion structure of reference clip, swaps product/context via prompt.
 * @param {Object} opts
 * @param {string} opts.videoUrl   - Public URL of source clip (3-10s)
 * @param {string} opts.prompt     - Descriptive prompt for the remade clip
 * @param {number} opts.duration   - Output duration 3-10s (default 7)
 * @param {string} opts.aspectRatio
 * @param {string} [opts.resolution] - '480p' | '720p' (default '720p')
 * @param {string} [opts.model]
 */
async function generateVideoFromReference({
  videoUrl,
  prompt,
  duration = 7,
  aspectRatio = '9:16',
  resolution = '720p',
  model,
}) {
  const effectiveModel = model || config.models.remake || 'doubao-seedance-2-0';
  const payload = {
    model: effectiveModel,
    prompt,
    duration,
    resolution,
    aspect_ratio: aspectRatio,
    video_url: videoUrl,
    videoReferType: 'base',
    watermark: false,
  };

  console.log(`[generateVideoFromReference] model=${effectiveModel} aspect=${aspectRatio} dur=${duration}s videoUrl=${videoUrl?.slice(0, 60)}`);

  const response = await imageClient.post('/videos/generations', payload, { timeout: 60000 });

  const code = response.data?.code;
  if (code && code !== 200 && code !== 201) {
    const msg = response.data?.message || response.data?.error || JSON.stringify(response.data).slice(0, 200);
    throw new Error(`Video API error (code ${code}): ${msg}`);
  }

  const rawData = response.data?.data;
  const item = Array.isArray(rawData) ? rawData[0] : (rawData || response.data);
  const taskId = item?.task_id || item?.taskId || item?.id;
  console.log(`[generateVideoFromReference] task_id=${taskId} raw keys=${Object.keys(item || {}).join(',')}`);
  return item;
}

async function generateVideo({ prompt, duration = 10, aspectRatio = '9:16', model, imageUrl }) {
  const effectiveModel = model || config.models.video;
  const payload = {
    model: effectiveModel,
    prompt,
    duration,
    aspect_ratio: aspectRatio,
  };
  // image-to-video: pass product photo as reference when available
  if (imageUrl) {
    payload.image_url = imageUrl;
  }

  console.log(`[generateVideo] submitting ${effectiveModel} | aspect=${aspectRatio} | duration=${duration}s`);
  const response = await imageClient.post('/videos/generations', payload, { timeout: 60000 });

  // Detect API-level errors (code !== 200/201) before extracting task_id
  const code = response.data?.code;
  if (code && code !== 200 && code !== 201) {
    const msg = response.data?.message || response.data?.error || JSON.stringify(response.data).slice(0, 200);
    throw new Error(`Video API error (code ${code}): ${msg}`);
  }

  const rawData = response.data?.data;
  const item = Array.isArray(rawData) ? rawData[0] : (rawData || response.data);

  // Normalise task_id — kling sometimes uses 'id' or 'taskId'
  const taskId = item?.task_id || item?.taskId || item?.id;
  console.log(`[generateVideo] response task_id=${taskId} | raw keys=${Object.keys(item || {}).join(',')}`);

  return item;
}

async function pollVideoTask({ taskId, pollIntervalMs = 5000, timeoutMs = 300000 }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const task = await getTask(taskId);
    const status = (task.status || '').toLowerCase();

    if (status === 'completed' || status === 'succeed' || status === 'success') {
      const videoUrl =
        task.result?.video_url ||
        task.result?.url ||
        task.video_url ||
        task.url ||
        task.output?.url;
      return { status: 'completed', videoUrl };
    }
    if (['failed', 'error', 'cancelled'].includes(status)) {
      return { status: 'failed', error: JSON.stringify(task).slice(0, 200) };
    }
    return { status: task.status || 'processing', progress: task.progress };
  }
  return { status: 'timeout' };
}

async function checkVideoStatus(taskId) {
  return await getTask(taskId);
}

module.exports = {
  chatCompletion,
  analyzeImage,
  submitImageJob,
  submitImageJobPayload,
  uploadImageToApimart,
  generateImage,
  getTask,
  generateVideo,
  generateVideoFromReference,
  pollVideoTask,
  checkVideoStatus,
  GPT_IMAGE_SIZE_MAP,
};
