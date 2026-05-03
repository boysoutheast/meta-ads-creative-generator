const express = require('express');
const router = express.Router();
const prisma = require('../db/prisma');
const config = require('../config');

// Pure liveness — no DB, no external. Must always return 200 if process up.
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    env: config.nodeEnv,
    uptime: Math.round(process.uptime()),
  });
});

// DB readiness
router.get('/db', async (req, res) => {
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', durationMs: Date.now() - start });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

// External dependencies (apimart) — light HEAD/GET
router.get('/external', async (req, res) => {
  const checks = {};
  // apimart key presence
  checks.apimart = config.apimart.apiKey ? 'configured' : 'missing_key';
  res.json({ status: 'ok', checks });
});

module.exports = router;
