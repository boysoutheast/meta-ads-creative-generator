/**
 * sessionStore.js — 3-tier session persistence for Reels generation
 *
 * Tier 1 (Primary)  : Redis  — survives server restarts, shared across instances
 * Tier 2 (Backup)   : /tmp JSON files — survives process crashes within same host
 * Tier 3 (Fallback) : in-memory Map — always available, lost on restart
 *
 * Every write goes to all 3 tiers. Every read tries tier 1 → 2 → 3.
 * Session TTL: 24 hours.
 */

const Redis = require('ioredis');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24h
const BACKUP_DIR = path.join('/tmp', 'reels-sessions');
const AUDIT_RETENTION_MS = 48 * 60 * 60 * 1000; // keep audit 48h after done

// ── in-memory fallback ────────────────────────────────────────────────────────
const memStore = new Map();

// ── Redis client (lazy init) ──────────────────────────────────────────────────
let redisClient = null;
let redisReady = false;

function getRedis() {
  if (redisClient) return redisClient;
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('[SessionStore] REDIS_URL not set — using memory+file fallback only');
    return null;
  }
  redisClient = new Redis(url, {
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
  redisClient.on('ready', () => {
    redisReady = true;
    console.info('[SessionStore] ✅ Redis connected — primary session store active');
  });
  redisClient.on('error', (err) => {
    redisReady = false;
    console.error('[SessionStore] ❌ Redis error — falling back to file+memory:', err.message);
  });
  redisClient.on('reconnecting', () => {
    console.warn('[SessionStore] ⚠️  Redis reconnecting…');
  });
  redisClient.connect().catch((err) => {
    console.error('[SessionStore] ❌ Redis connect failed — using file+memory fallback:', err.message);
  });
  return redisClient;
}

// ── backup dir ────────────────────────────────────────────────────────────────
function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function backupPath(sessionId) {
  return path.join(BACKUP_DIR, `${sessionId}.json`);
}

// ── hash helpers ──────────────────────────────────────────────────────────────
function sha256json(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

// ── core ops ──────────────────────────────────────────────────────────────────

async function saveSession(session) {
  session.updatedAt = new Date().toISOString();
  session._hash = sha256json(session);

  const json = JSON.stringify(session);
  const key = `reels:session:${session.sessionId}`;

  // Tier 3 — always
  memStore.set(session.sessionId, session);

  // Tier 2 — file backup
  try {
    ensureBackupDir();
    fs.writeFileSync(backupPath(session.sessionId), json, 'utf8');
  } catch (e) {
    console.warn('[SessionStore] File backup write failed:', e.message);
  }

  // Tier 1 — Redis
  const redis = getRedis();
  if (redis && redisReady) {
    try {
      await redis.setex(key, SESSION_TTL_SECONDS, json);
    } catch (e) {
      console.warn('[SessionStore] Redis write failed:', e.message);
    }
  }
}

async function getSession(sessionId) {
  // Tier 3 — memory (fastest)
  if (memStore.has(sessionId)) return memStore.get(sessionId);

  // Tier 1 — Redis
  const redis = getRedis();
  if (redis && redisReady) {
    try {
      const raw = await redis.get(`reels:session:${sessionId}`);
      if (raw) {
        const session = JSON.parse(raw);
        memStore.set(sessionId, session); // warm memory
        return session;
      }
    } catch (e) {
      console.warn('[SessionStore] Redis read failed:', e.message);
    }
  }

  // Tier 2 — file backup
  try {
    const fp = backupPath(sessionId);
    if (fs.existsSync(fp)) {
      const session = JSON.parse(fs.readFileSync(fp, 'utf8'));
      memStore.set(sessionId, session);
      return session;
    }
  } catch (e) {
    console.warn('[SessionStore] File backup read failed:', e.message);
  }

  return null;
}

async function deleteSession(sessionId) {
  memStore.delete(sessionId);

  try {
    const fp = backupPath(sessionId);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch (e) {}

  const redis = getRedis();
  if (redis && redisReady) {
    try {
      await redis.del(`reels:session:${sessionId}`);
    } catch (e) {}
  }
}

// ── factory ───────────────────────────────────────────────────────────────────

function createSession({ prompt, mode, duration, aspectRatio = 'portrait', resolution = '720p', clipDuration = 10, voType = 'narration', visualStyle = 'premium_3d', projectType = 'default', outputLanguage = 'id', scriptText = null }) {
  return {
    sessionId: uuidv4(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // Status lifecycle: pending → reviewing → generating → partial | merging → done | error
    status: 'pending',
    prompt,
    mode,
    duration,
    totalClips: Math.ceil(duration / clipDuration),
    // Video generation config
    aspectRatio,    // portrait (9:16) | landscape (16:9) | square (1:1) | vertical (2:3) | horizontal (3:2)
    resolution,     // 480p | 720p
    clipDuration,   // 6 | 10 | 15 seconds per clip
    voType,         // narration | dialogue | asmr | demo | story
    visualStyle,    // premium_3d | realistic | anime | cinematic | cartoon | ghibli | makoto_shinkai | chibi | pixel_art | chinese_cg
    projectType,    // default | story | product_promo | digital_human
    outputLanguage, // id | en | th | vi | zh | hi | es | pt | ar | ko | ja
    scriptText,     // null (brief mode) | string (adapt existing script)
    storyboard: [],          // { clipNumber, visualSummary, voScript, grokPrompt, sceneImageUrl, technicalConfig }
    referenceImageUrls: [],  // { tag, label, url } — user-uploaded reference images
    clips: [],               // { index, status, uuid, videoUrl, thumbnailUrl, attempts, completedAt, error }
    mergedPath: null,
    mergedHash: null,
    sizeBytes: null,         // merged file size in bytes — set after FFmpeg, shown in results UI
    downloadReady: false,
    downloadedAt: null,
    audit: [],
    _hash: null,
  };
}

// ── audit helpers ─────────────────────────────────────────────────────────────

function auditLog(session, level, event, detail = {}) {
  session.audit.push({
    ts: new Date().toISOString(),
    level,          // info | warn | error
    event,          // e.g. SESSION_CREATED, CLIP_1_DONE, MERGE_START, etc.
    ...detail,
  });
}

// ── TTL cleanup of old sessions (called on server start) ─────────────────────

async function cleanupOldSessions() {
  try {
    ensureBackupDir();
    const files = fs.readdirSync(BACKUP_DIR);
    const cutoff = Date.now() - AUDIT_RETENTION_MS;
    for (const f of files) {
      const fp = path.join(BACKUP_DIR, f);
      const stat = fs.statSync(fp);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(fp);
      }
    }
  } catch (e) {
    console.warn('[SessionStore] Cleanup failed:', e.message);
  }
}

module.exports = {
  saveSession,
  getSession,
  deleteSession,
  createSession,
  auditLog,
  cleanupOldSessions,
  sha256json,
};
