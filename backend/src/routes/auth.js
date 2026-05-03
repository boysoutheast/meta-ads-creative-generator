const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const router = express.Router();

const prisma = require('../db/prisma');
const config = require('../config');
const { audit } = require('../services/audit');
const { requireAuth } = require('../middleware/auth');

const RegisterSchema = z.object({
  name: z.string().min(2, 'Nama minimal 2 karakter').max(80),
  email: z.string().email('Email tidak valid').toLowerCase(),
  password: z.string().min(8, 'Password minimal 8 karakter').max(128),
});

const LoginSchema = z.object({
  email: z.string().email('Email tidak valid').toLowerCase(),
  password: z.string().min(1, 'Password wajib diisi'),
});

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: user.role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt };
}

router.post('/register', async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.flatten().fieldErrors });
  }
  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await audit({ action: 'register_fail', metadata: { email, reason: 'email_taken' }, req });
    return res.status(409).json({ error: 'Email sudah terdaftar' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, role: 'user' },
  });

  await audit({ userId: user.id, action: 'register_success', metadata: { email }, req });

  const token = signToken(user);
  res.status(201).json({ token, user: publicUser(user) });
});

router.post('/login', async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.flatten().fieldErrors });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    await audit({ action: 'login_fail', metadata: { email, reason: 'no_user' }, req });
    return res.status(401).json({ error: 'Email atau password salah' });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    await audit({ userId: user.id, action: 'login_fail', metadata: { reason: 'bad_password' }, req });
    return res.status(401).json({ error: 'Email atau password salah' });
  }

  await audit({ userId: user.id, action: 'login_success', req });
  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(user) });
});

router.patch('/me', requireAuth, async (req, res) => {
  const Schema = z.object({ name: z.string().min(2).max(80).optional() });
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.flatten().fieldErrors });
  }
  const user = await prisma.user.update({
    where: { id: req.userId },
    data: parsed.data,
  });
  await audit({ userId: user.id, action: 'profile_update', metadata: parsed.data, req });
  res.json({ user: publicUser(user) });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const Schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128),
  });
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.flatten().fieldErrors });
  }
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  const ok = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Password lama salah' });

  const hash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
  await audit({ userId: user.id, action: 'password_change', req });
  res.json({ ok: true });
});

module.exports = router;
