const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const router = express.Router();

const prisma = require('../db/prisma');
const { requireAuth } = require('../middleware/auth');

// Memory-based upload — max 10 photos, 5MB each
const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  },
});

const characterSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
});

function filesToBase64(files) {
  if (!files || files.length === 0) return null;
  return files.map((f) => `data:${f.mimetype};base64,${f.buffer.toString('base64')}`);
}

function photoUrls(photos) {
  if (!photos || !Array.isArray(photos)) return [];
  return photos.filter((p) => typeof p === 'string' && p.startsWith('data:'));
}

// GET /api/characters
router.get('/', requireAuth, async (req, res) => {
  const characters = await prisma.character.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ characters: characters.map((c) => ({ ...c, photos: photoUrls(c.photos) })) });
});

// POST /api/characters
router.post('/', requireAuth, memUpload.array('photos', 10), async (req, res) => {
  const parsed = characterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const photos = filesToBase64(req.files);
  const character = await prisma.character.create({
    data: {
      userId: req.user.id,
      name: parsed.data.name,
      description: parsed.data.description || null,
      photos: photos || [],
    },
  });
  res.status(201).json({ character: { ...character, photos: photoUrls(character.photos) } });
});

// PUT /api/characters/:id
router.put('/:id', requireAuth, memUpload.array('photos', 10), async (req, res) => {
  const existing = await prisma.character.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!existing) return res.status(404).json({ error: 'Character not found' });

  const parsed = characterSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  // If new photos uploaded, replace all. Otherwise keep existing.
  const newPhotos = req.files && req.files.length > 0 ? filesToBase64(req.files) : undefined;

  const character = await prisma.character.update({
    where: { id: req.params.id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.description !== undefined && { description: parsed.data.description }),
      ...(newPhotos !== undefined && { photos: newPhotos }),
    },
  });
  res.json({ character: { ...character, photos: photoUrls(character.photos) } });
});

// DELETE /api/characters/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const existing = await prisma.character.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!existing) return res.status(404).json({ error: 'Character not found' });
  await prisma.character.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

module.exports = router;
