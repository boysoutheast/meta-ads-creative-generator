require('dotenv').config();

const required = (name) => {
  const v = process.env[name];
  if (!v && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
};

module.exports = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-in-prod',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },

  database: {
    url: required('DATABASE_URL') || 'postgresql://localhost:5432/dev',
  },

  apimart: {
    apiKey: process.env.APIMART_API_KEY || '',
    baseUrl: process.env.APIMART_BASE_URL || 'https://apimart.ai/api/v1',
  },

  models: {
    image: process.env.IMAGE_MODEL || 'gpt-image-2',
    remake: process.env.REMAKE_MODEL || 'doubao-seedance-2-0',
    vision: process.env.VISION_MODEL || 'gpt-4o',
    chat: process.env.CHAT_MODEL || 'gpt-4o',
    // Separate model for scaling prompt/copy generation — use Sonnet for better quality
    scalingChat: process.env.SCALING_CHAT_MODEL || process.env.CHAT_MODEL || 'gpt-4o',
    // Scene preview image generation for storyboard cards (Gemini Image 2.0)
    sceneImage: process.env.SCENE_IMAGE_MODEL || 'gemini-2.0-flash-preview-image-generation',
  },

  // Public-facing backend URL — used to construct static file URLs for video clips
  backendPublicUrl:
    process.env.BACKEND_PUBLIC_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : 'http://localhost:4000'),

  upload: {
    maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '50'),
    uploadDir: process.env.UPLOAD_DIR || './uploads',
  },
};
