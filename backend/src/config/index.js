require('dotenv').config();

module.exports = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  apimart: {
    apiKey: process.env.APIMART_API_KEY || '',
    baseUrl: process.env.APIMART_BASE_URL || 'https://apimart.ai/api/v1',
  },

  models: {
    image: process.env.IMAGE_MODEL || 'dall-e-3',
    video: process.env.VIDEO_MODEL || 'runway-gen3',
    vision: process.env.VISION_MODEL || 'gpt-4o',
    chat: process.env.CHAT_MODEL || 'gpt-4o',
  },

  upload: {
    maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '50'),
    uploadDir: process.env.UPLOAD_DIR || './uploads',
  },
};
