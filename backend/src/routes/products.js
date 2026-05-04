const express = require('express');
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const router = express.Router();

const prisma = require('../db/prisma');
const { requireAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const config = require('../config');

const uploadDir = path.resolve(config.upload.uploadDir);

const productSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  texture: z.string().optional(),
  price: z.coerce.number().optional(),
  promoPrice: z.coerce.number().optional(),
});

function photoUrls(photos) {
  if (!photos || !Array.isArray(photos)) return [];
  return photos;
}

function buildPhotosFromFiles(files) {
  if (!files || files.length === 0) return null;
  return files.map((f) => `/uploads/${f.filename}`);
}

function deletePhotoFiles(photos) {
  if (!photos || !Array.isArray(photos)) return;
  for (const urlPath of photos) {
    const filename = path.basename(urlPath);
    const filepath = path.join(uploadDir, filename);
    fs.unlink(filepath, () => {});
  }
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
router.post('/', requireAuth, upload.array('photos', 5), async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) {
    // cleanup uploaded files
    if (req.files) deletePhotoFiles(req.files.map((f) => `/uploads/${f.filename}`));
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const data = parsed.data;
  const photos = buildPhotosFromFiles(req.files);

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
router.put('/:id', requireAuth, upload.array('photos', 5), async (req, res) => {
  const existing = await prisma.product.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!existing) {
    if (req.files) deletePhotoFiles(req.files.map((f) => `/uploads/${f.filename}`));
    return res.status(404).json({ error: 'Product not found' });
  }

  const parsed = productSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    if (req.files) deletePhotoFiles(req.files.map((f) => `/uploads/${f.filename}`));
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const data = parsed.data;

  let photos = undefined;
  if (req.files && req.files.length > 0) {
    // Delete old photos, save new ones
    deletePhotoFiles(photoUrls(existing.photos));
    photos = buildPhotosFromFiles(req.files);
  }

  const product = await prisma.product.update({
    where: { id: req.params.id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.texture !== undefined && { texture: data.texture }),
      ...(photos !== undefined && { photos }),
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

  deletePhotoFiles(photoUrls(existing.photos));
  await prisma.product.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

module.exports = router;
