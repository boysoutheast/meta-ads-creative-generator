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

async function analyzeImage({ imageBase64, mimeType = 'image/jpeg', prompt }) {
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        { type: 'text', text: prompt },
      ],
    },
  ];
  return await chatCompletion({ model: config.models.vision, messages, maxTokens: 2000 });
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

async function generateImage({ prompt, size = '1024x1024', model, imageUrl, pollIntervalMs = 5000, timeoutMs = 180000 }) {
  let effectiveModel = model || config.models.image;
  let payload;

  if (imageUrl) {
    // Product photo available → flux-kontext-pro for accurate product reference (img2img)
    effectiveModel = 'flux-kontext-pro';
    const aspectMap = {
      '1024x1024': '1:1',
      '1024x1536': '9:16',
      '1536x1024': '16:9',
      '1024x1792': '9:16',
      '1792x1024': '16:9',
    };
    payload = {
      model: effectiveModel,
      prompt,
      n: 1,
      image_url: imageUrl,
      aspect_ratio: aspectMap[size] || '1:1',
    };
  } else {
    // No product photo → gpt-image-2 (best text rendering + scene quality)
    const normalizedSize = GPT_IMAGE_SIZE_MAP[size] || '1024x1024';
    payload = {
      model: effectiveModel,
      prompt,
      n: 1,
      size: normalizedSize,
    };
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

async function generateVideo({ prompt, duration = 5, aspectRatio = '16:9', model }) {
  const payload = {
    model: model || config.models.video,
    prompt,
    duration,
    aspect_ratio: aspectRatio,
  };
  const response = await imageClient.post('/videos/generations', payload);
  const rawData = response.data?.data;
  return Array.isArray(rawData) ? rawData[0] : (rawData || response.data);
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
  uploadImageToApimart,
  generateImage,
  getTask,
  generateVideo,
  pollVideoTask,
  checkVideoStatus,
};
