const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const router = express.Router();

const prisma = require('../db/prisma');
const { requireAuth } = require('../middleware/auth');

// Memory-based upload — no disk writes, survives Railway redeploys
const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  },
});

const productSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  texture: z.string().optional(),
  price: z.coerce.number().optional(),
  promoPrice: z.coerce.number().optional(),
});

function filesToBase64(files) {
  if (!files || files.length === 0) return null;
  return files.map((f) => `data:${f.mimetype};base64,${f.buffer.toString('base64')}`);
}

function photoUrls(photos) {
  if (!photos || !Array.isArray(photos)) return [];
  return photos;
}

// GET /api/products
router.get('/', requireAuth, async (req, res) => {
  const products = await prisma.product.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
  });
  const result = products.map((p) => ({
    ...p,
    photos: photoUrls(p.photos),
  }));
  res.json({ products: result });
});

// POST /api/products
router.post('/', requireAuth, memUpload.array('photos', 5), async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const data = parsed.data;
  const photos = filesToBase64(req.files);

  const product = await prisma.product.create({
    data: {
      userId: req.user.id,
      name: data.name,
      description: data.description || null,
      texture: data.texture || null,
      photos: photos || [],
      price: data.price ?? null,
      promoPrice: data.promoPrice ?? null,
    },
  });
  res.status(201).json({ product: { ...product, photos: photoUrls(product.photos) } });
});

// PUT /api/products/:id
router.put('/:id', requireAuth, memUpload.array('photos', 5), async (req, res) => {
  const existing = await prisma.product.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  const parsed = productSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const data = parsed.data;

  // Only replace photos if new ones were uploaded
  const newPhotos = req.files && req.files.length > 0
    ? filesToBase64(req.files)
    : undefined;

  const product = await prisma.product.update({
    where: { id: req.params.id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.texture !== undefined && { texture: data.texture }),
      ...(newPhotos !== undefined && { photos: newPhotos }),
      ...(data.price !== undefined && { price: data.price }),
      ...(data.promoPrice !== undefined && { promoPrice: data.promoPrice }),
    },
  });
  res.json({ product: { ...product, photos: photoUrls(product.photos) } });
});

// DELETE /api/products/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const existing = await prisma.product.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  await prisma.product.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

module.exports = router;
