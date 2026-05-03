require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const config = require('./config');

const generateRoutes = require('./routes/generate');
const analyzeRoutes = require('./routes/analyze');
const scaleRoutes = require('./routes/scale');
const createRoutes = require('./routes/create');

const app = express();

// Security & middleware
app.use(helmet());
app.use(
  cors({
    origin: [config.frontendUrl, 'http://localhost:3000', 'https://*.vercel.app'],
    credentials: true,
  })
);
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded files temporarily
app.use('/uploads', express.static(path.resolve(config.upload.uploadDir)));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    env: config.nodeEnv,
  });
});

// API Routes
app.use('/api/generate', generateRoutes);
app.use('/api/analyze', analyzeRoutes);
app.use('/api/scale', scaleRoutes);   // Menu 1: Scaling Konten Winning
app.use('/api/create', createRoutes); // Menu 2: Create with Reference

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  if (config.nodeEnv !== 'production') {
    console.error(err.stack);
  }

  // Multer errors
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
  console.log(`🚀 Server running on port ${PORT} [${config.nodeEnv}]`);
  console.log(`📡 API: http://localhost:${PORT}/api`);
  console.log(`❤️  Health: http://localhost:${PORT}/health`);
});

module.exports = app;
