const express = require('express');
const { z } = require('zod');
const router = express.Router();

const prisma = require('../db/prisma');
const { requireAuth } = require('../middleware/auth');

const productSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  usp: z.string().optional(),
  targetAudience: z.string().optional(),
  adGoal: z.string().optional(),
  brandColors: z.string().optional(),
  isDefault: z.boolean().optional(),
});

router.get('/', requireAuth, async (req, res) => {
  const products = await prisma.product.findMany({
    where: { userId: req.user.id },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
  res.json({ products });
});

router.post('/', requireAuth, async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data = parsed.data;

  if (data.isDefault) {
    await prisma.product.updateMany({
      where: { userId: req.user.id },
      data: { isDefault: false },
    });
  }

  const product = await prisma.product.create({
    data: {
      userId: req.user.id,
      name: data.name,
      description: data.description || null,
      usp: data.usp || null,
      targetAudience: data.targetAudience || null,
      adGoal: data.adGoal || null,
      brandColors: data.brandColors || null,
      isDefault: data.isDefault || false,
    },
  });
  res.status(201).json({ product });
});

router.put('/:id', requireAuth, async (req, res) => {
  const existing = await prisma.product.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  const parsed = productSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data = parsed.data;

  if (data.isDefault) {
    await prisma.product.updateMany({
      where: { userId: req.user.id, id: { not: req.params.id } },
      data: { isDefault: false },
    });
  }

  const product = await prisma.product.update({
    where: { id: req.params.id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.usp !== undefined && { usp: data.usp }),
      ...(data.targetAudience !== undefined && { targetAudience: data.targetAudience }),
      ...(data.adGoal !== undefined && { adGoal: data.adGoal }),
      ...(data.brandColors !== undefined && { brandColors: data.brandColors }),
      ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
    },
  });
  res.json({ product });
});

router.delete('/:id', requireAuth, async (req, res) => {
  const existing = await prisma.product.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  await prisma.product.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

module.exports = router;
