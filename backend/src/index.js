require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const config = require('./config');
const logger = require('./lib/logger');
const requestLogger = require('./middleware/requestLogger');

// Existing creative routes (kept for back-compat with v1 frontend)
const generateRoutes = require('./routes/generate');
const analyzeRoutes = require('./routes/analyze');
const scaleRoutes = require('./routes/scale');
const createRoutes = require('./routes/create');

// Phase 1 new routes
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const libraryRoutes = require('./routes/library');
const singleImageRoutes = require('./routes/single-image');
const productRoutes = require('./routes/products');
const { requireAuth } = require('./middleware/auth');
const { getTask } = require('./services/apimart');

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl, server-to-server
      const allowed = [config.frontendUrl, 'http://localhost:3000'];
      const isVercelPreview = /\.vercel\.app$/.test(new URL(origin).hostname);
      if (allowed.includes(origin) || isVercelPreview) return cb(null, true);
      return cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);
app.use(requestLogger);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.resolve(config.upload.uploadDir)));

// Health (split — pure liveness must NEVER touch DB)
app.use('/health', healthRoutes);

// API
app.use('/api/auth', authRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/scale/single-image', singleImageRoutes);

// Generic task polling for async video jobs
app.get('/api/tasks/:id', requireAuth, async (req, res) => {
  const task = await getTask(req.params.id);
  res.json(task);
});

// Existing v1 routes
app.use('/api/generate', generateRoutes);
app.use('/api/analyze', analyzeRoutes);
app.use('/api/scale', scaleRoutes);
app.use('/api/scale-video', require('./routes/scale-video'));
app.use('/api/create', createRoutes);

// ─── Audit endpoint ─────────────────────────────────────────────────────────
app.get('/api/audit', requireAuth, async (req, res) => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const checks = [];

  // DB connectivity
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({ name: 'database', status: 'ok' });
  } catch (e) {
    checks.push({ name: 'database', status: 'error', message: e.message });
  } finally {
    await prisma.$disconnect();
  }

  // APIMART key (used for image/video/vision generation)
  checks.push({
    name: 'apimart_key',
    status: process.env.APIMART_API_KEY ? 'ok' : 'missing',
  });

  // JWT secret
  checks.push({
    name: 'jwt_secret',
    status: process.env.JWT_SECRET ? 'ok' : 'missing',
  });

  // Uploads dir
  const fs = require('fs');
  const uploadDir = config.upload?.uploadDir || 'uploads';
  try {
    fs.accessSync(path.resolve(uploadDir), fs.constants.W_OK);
    checks.push({ name: 'uploads_dir', status: 'ok' });
  } catch {
    checks.push({ name: 'uploads_dir', status: 'error', message: 'Not writable or missing' });
  }

  const allOk = checks.every((c) => c.status === 'ok');
  res.status(allOk ? 200 : 207).json({
    ok: allOk,
    timestamp: new Date().toISOString(),
    checks,
  });
});

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

app.use((err, req, res, next) => {
  req.log?.error({ err: err.message, stack: err.stack }, 'request_error');
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: `File too large. Max size: ${config.upload.maxFileSizeMB}MB` });
  }
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(config.nodeEnv !== 'production' && { stack: err.stack }),
  });
});

const PORT = config.port;
app.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT, env: config.nodeEnv }, 'server_started');
});

module.exports = app;
