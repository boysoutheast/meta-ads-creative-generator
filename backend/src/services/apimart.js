const axios = require('axios');
const config = require('../config');

/**
 * Apimart.ai client - OpenAI-compatible API wrapper
 */
const apimartClient = axios.create({
  baseURL: config.apimart.baseUrl,
  headers: {
    Authorization: `Bearer ${config.apimart.apiKey}`,
    'Content-Type': 'application/json',
  },
  timeout: 120000, // 2 minutes for image/video generation
});

/**
 * Chat completion (for prompt generation & video analysis)
 */
async function chatCompletion({ model, messages, maxTokens = 1500, temperature = 0.7 }) {
  const response = await apimartClient.post('/chat/completions', {
    model: model || config.models.chat,
    messages,
    max_tokens: maxTokens,
    temperature,
  });
  return response.data.choices[0].message.content;
}

/**
 * Vision analysis - analyze image/video frame
 */
async function analyzeImage({ imageBase64, mimeType = 'image/jpeg', prompt }) {
  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${imageBase64}`,
          },
        },
        {
          type: 'text',
          text: prompt,
        },
      ],
    },
  ];

  return await chatCompletion({
    model: config.models.vision,
    messages,
    maxTokens: 2000,
  });
}

/**
 * Generate image via apimart.ai (DALL-E compatible)
 */
async function generateImage({ prompt, size = '1024x1024', quality = 'standard', n = 1, style = 'vivid' }) {
  const response = await apimartClient.post('/images/generations', {
    model: config.models.image,
    prompt,
    size,
    quality,
    n,
    style,
    response_format: 'url',
  });
  return response.data.data;
}

/**
 * Generate video via apimart.ai
 */
async function generateVideo({ prompt, duration = 5, aspectRatio = '16:9', model }) {
  const response = await apimartClient.post('/video/generations', {
    model: model || config.models.video,
    prompt,
    duration,
    aspect_ratio: aspectRatio,
  });
  return response.data;
}

/**
 * Check video generation status
 */
async function checkVideoStatus(taskId) {
  const response = await apimartClient.get(`/video/generations/${taskId}`);
  return response.data;
}

module.exports = {
  chatCompletion,
  analyzeImage,
  generateImage,
  generateVideo,
  checkVideoStatus,
};
