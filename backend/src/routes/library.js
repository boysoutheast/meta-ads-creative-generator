const express = require('express');
const { z } = require('zod');
const router = express.Router();

const prisma = require('../db/prisma');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../services/audit');

const SaveSchema = z.object({
  jobId: z.string().optional(),
  type: z.enum(['single_image', 'carousel', 'video']),
  angle: z.string().optional(),
  title: z.string().min(1).max(160),
  imageUrl: z.string().url().nullable().optional(),
  videoUrl: z.string().url().nullable().optional(),
  prompt: z.string().nullable().optional(),
  copyHeadline: z.string().nullable().optional(),
  copySubtext: z.string().nullable().optional(),
  copyCta: z.string().nullable().optional(),
  metadata: z.any().optional(),
});

router.get('/', requireAuth, async (req, res) => {
  const { type, angle, limit = '50', offset = '0' } = req.query;
  const items = await prisma.libraryItem.findMany({
    where: {
      userId: req.userId,
      deletedAt: null,
      ...(type ? { type: String(type) } : {}),
      ...(angle ? { angle: String(angle) } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(parseInt(String(limit)) || 50, 100),
    skip: parseInt(String(offset)) || 0,
  });
  const total = await prisma.libraryItem.count({
    where: { userId: req.userId, deletedAt: null },
  });
  res.json({ items, total });
});

router.post('/', requireAuth, async (req, res) => {
  const parsed = SaveSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.flatten().fieldErrors });
  }

  // If jobId provided, validate ownership
  if (parsed.data.jobId) {
    const job = await prisma.generationJob.findUnique({ where: { id: parsed.data.jobId } });
    if (!job || job.userId !== req.userId) {
      return res.status(404).json({ error: 'Job not found' });
    }
  }

  const item = await prisma.libraryItem.create({
    data: { userId: req.userId, ...parsed.data },
  });

  await audit({
    userId: req.userId,
    action: 'library_save',
    metadata: { itemId: item.id, type: item.type, angle: item.angle },
    req,
  });

  res.status(201).json({ item });
});

router.get('/:id', requireAuth, async (req, res) => {
  const item = await prisma.libraryItem.findUnique({ where: { id: req.params.id } });
  if (!item || item.userId !== req.userId || item.deletedAt) {
    return res.status(404).json({ error: 'Item not found' });
  }
  res.json({ item });
});

router.delete('/:id', requireAuth, async (req, res) => {
  const item = await prisma.libraryItem.findUnique({ where: { id: req.params.id } });
  if (!item || item.userId !== req.userId || item.deletedAt) {
    return res.status(404).json({ error: 'Item not found' });
  }
  await prisma.libraryItem.update({
    where: { id: item.id },
    data: { deletedAt: new Date() },
  });
  await audit({
    userId: req.userId,
    action: 'library_delete',
    metadata: { itemId: item.id, type: item.type },
    req,
  });
  res.json({ ok: true });
});

router.get('/stats/summary', requireAuth, async (req, res) => {
  const [totalItems, totalJobs, completedJobs, totalCost, last7Days] = await Promise.all([
    prisma.libraryItem.count({ where: { userId: req.userId, deletedAt: null } }),
    prisma.generationJob.count({ where: { userId: req.userId } }),
    prisma.generationJob.count({ where: { userId: req.userId, status: 'completed' } }),
    prisma.generationJob.aggregate({
      where: { userId: req.userId, status: 'completed' },
      _sum: { costUsd: true },
    }),
    prisma.generationJob.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ]);
  res.json({
    totalItems,
    totalJobs,
    completedJobs,
    totalCostUsd: totalCost._sum.costUsd || 0,
    recentJobs: last7Days.map((j) => ({
      id: j.id,
      type: j.type,
      angle: j.angle,
      status: j.status,
      resultUrl: j.resultUrl,
      createdAt: j.createdAt,
    })),
  });
});

module.exports = router;
