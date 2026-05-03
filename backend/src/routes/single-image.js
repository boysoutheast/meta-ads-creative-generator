const express = require('express');
const { z } = require('zod');
const router = express.Router();

const prisma = require('../db/prisma');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { processSingleImageJob } = require('../services/singleImageWorker');
const logger = require('../lib/logger');

const ANGLES = [
  'fomo',
  'price_anchor',
  'social_proof',
  'problem_agitation',
  'transformation',
  'authority',
  'curiosity_gap',
  'risk_reversal',
];

const FORMATS = ['1:1', '9:16', '4:5', '16:9'];

const CreateJobSchema = z.object({
  angle: z.enum(ANGLES),
  productName: z.string().min(1).max(120),
  copy: z.string().min(1).max(500),
  cta: z.string().min(1).max(40),
  format: z.enum(FORMATS).default('1:1'),
});

router.get('/angles', (req, res) => {
  res.json({ angles: ANGLES, formats: FORMATS });
});

router.post('/', requireAuth, async (req, res) => {
  const parsed = CreateJobSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.flatten().fieldErrors });
  }

  const job = await prisma.generationJob.create({
    data: {
      userId: req.userId,
      type: 'single_image',
      angle: parsed.data.angle,
      status: 'pending',
      inputPayload: parsed.data,
    },
  });

  await audit({
    userId: req.userId,
    action: 'generation_started',
    metadata: { jobId: job.id, type: 'single_image', angle: parsed.data.angle },
    req,
  });

  // Fire and forget. Worker writes status back to DB.
  setImmediate(() => {
    processSingleImageJob(job.id).catch((err) =>
      logger.error({ err: err.message, jobId: job.id }, 'worker_unhandled_error')
    );
  });

  res.status(202).json({ jobId: job.id, status: job.status });
});

router.get('/jobs/:id', requireAuth, async (req, res) => {
  const job = await prisma.generationJob.findUnique({ where: { id: req.params.id } });
  if (!job || job.userId !== req.userId) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json({
    id: job.id,
    type: job.type,
    angle: job.angle,
    status: job.status,
    resultUrl: job.resultUrl,
    resultPrompt: job.resultPrompt,
    errorMessage: job.errorMessage,
    durationMs: job.durationMs,
    costUsd: job.costUsd,
    inputPayload: job.inputPayload,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  });
});

module.exports = router;
