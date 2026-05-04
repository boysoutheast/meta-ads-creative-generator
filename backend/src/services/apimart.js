const axios = require('axios');
const config = require('../config');

/**
 * Apimart.ai client.
 *
 * Two distinct hosts/paths:
 *  - Chat:   https://apimart.ai/api/v1/chat/completions   (sync, OpenAI-compat)
 *  - Image:  https://api.apimart.ai/v1/images/generations (async, returns task_id)
 *  - Task:   https://api.apimart.ai/v1/tasks/:id          (poll for image result)
 *  - Video:  uses task pattern too via /v1/videos/...
 */

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

/**
 * Chat completion (sync).
 */
async function chatCompletion({ model, messages, maxTokens = 1500, temperature = 0.7 }) {
  const response = await chatClient.post('/chat/completions', {
    model: model || config.models.chat,
    messages,
    max_tokens: maxTokens,
    temperature,
  });
  return response.data.choices[0].message.content;
}

/**
 * Vision analysis - same chat endpoint with image_url part.
 */
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

/**
 * Submit image generation. Returns task_id.
 */
async function submitImageJob({ prompt, size = '1024x1024', model, n = 1 }) {
  const response = await imageClient.post('/images/generations', {
    model: model || config.models.image,
    prompt,
    size,
    n,
  });
  // Async response: { code: 200, data: [ { status: "submitted", task_id: "..." } ] }
  // Or sync (rare): { code: 200, data: [ { url: "..." } ] }
  const data = response.data?.data;
  if (!Array.isArray(data) || !data.length) {
    throw new Error('Invalid image-generation response: ' + JSON.stringify(response.data).slice(0, 200));
  }
  return data[0]; // { task_id, status } or { url }
}

/**
 * Poll a task. Returns the data object.
 */
async function getTask(taskId) {
  const response = await imageClient.get(`/tasks/${taskId}`);
  return response.data.data;
}

/**
 * Submit + poll until terminal. Returns the first image URL or throws.
 */
async function generateImage({ prompt, size = '1024x1024', model, pollIntervalMs = 4000, timeoutMs = 180000 }) {
  const submitted = await submitImageJob({ prompt, size, model });

  // Sync path
  if (submitted.url) return [{ url: Array.isArray(submitted.url) ? submitted.url[0] : submitted.url }];

  const taskId = submitted.task_id || submitted.taskId || submitted.id;
  if (!taskId) {
    throw new Error('No task_id returned: ' + JSON.stringify(submitted).slice(0, 200));
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const task = await getTask(taskId);
    if (task.status === 'completed') {
      const images = task.result?.images;
      if (!images?.length) {
        throw new Error('Task completed but no images: ' + JSON.stringify(task).slice(0, 200));
      }
      const url = Array.isArray(images[0].url) ? images[0].url[0] : images[0].url;
      return [{ url }];
    }
    if (task.status === 'failed' || task.status === 'error') {
      throw new Error('Image generation task failed: ' + JSON.stringify(task).slice(0, 200));
    }
  }
  throw new Error(`Image generation timed out after ${timeoutMs}ms (task ${taskId})`);
}

/**
 * Submit video generation (similar async pattern).
 */
async function generateVideo({ prompt, duration = 5, aspectRatio = '16:9', model }) {
  const response = await imageClient.post('/videos/generations', {
    model: model || config.models.video,
    prompt,
    duration,
    aspect_ratio: aspectRatio,
  });
  return response.data?.data?.[0] || response.data;
}

async function checkVideoStatus(taskId) {
  return await getTask(taskId);
}

module.exports = {
  chatCompletion,
  analyzeImage,
  submitImageJob,
  generateImage,
  getTask,
  generateVideo,
  checkVideoStatus,
};
