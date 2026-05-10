/**
 * character-studio.js
 *
 * Routes for Character Studio — 3 tools in one:
 * 1. Character Sheet Builder  — analyze photos → rich JSON character sheet
 * 2. Prompt Template Manager  — CRUD reusable scene templates per character
 * 3. Scene Storyboard Builder — brief → full scene config JSON ready for scale-video
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../db/prisma');
const { requireAuth } = require('../middleware/auth');
const { chatCompletion, uploadImageToApimart } = require('../services/apimart');
const { buildCharacterSheet } = require('../services/translatePromptService');
const { batchGenerateVideos } = require('../services/scalingService');
const { downloadClips, mergeClips, getMergedPath, cleanupAll } = require('../services/reelsMerger');
const config = require('../config');

// ─── In-memory job store for async video generation ───────────────────────────
// TTL: 2h — GC'd automatically.
const STUDIO_VIDEO_JOBS = new Map();
function _gcJob(id) { setTimeout(() => STUDIO_VIDEO_JOBS.delete(id), 2 * 60 * 60 * 1000); }

// ─── 1. CHARACTER SHEET BUILDER ───────────────────────────────────────────────

/**
 * POST /api/character-studio/build-sheet
 * Analyze character photos → build rich JSON character sheet
 * Body: { characterId?, characterName, photosBase64: string[] }
 */
router.post('/build-sheet', requireAuth, async (req, res) => {
  const { characterId, characterName, photosBase64 = [] } = req.body || {};
  if (!characterName) return res.status(400).json({ error: 'characterName is required' });

  // If characterId given, also pull photos from DB
  let allPhotos = Array.isArray(photosBase64) ? photosBase64 : [];
  if (characterId) {
    try {
      const char = await prisma.character.findFirst({
        where: { id: characterId, userId: req.user.id },
      });
      if (char?.photos && Array.isArray(char.photos)) {
        allPhotos = [...char.photos, ...allPhotos];
      }
    } catch (e) {
      console.warn('[character-studio/build-sheet] DB lookup non-fatal:', e.message);
    }
  }

  if (allPhotos.length === 0) {
    return res.status(400).json({ error: 'At least one photo is required to build a character sheet' });
  }

  try {
    // Build visual appearance description from photos
    const appearanceDesc = await buildCharacterSheet(allPhotos.slice(0, 10), characterName);

    // Build full structured character sheet via GPT-4o
    const raw = await chatCompletion({
      model: config.models.scalingChat || config.models.chat,
      messages: [
        {
          role: 'system',
          content: 'You are a character designer for animated video ads. Build a comprehensive, structured character sheet from appearance descriptions. Return only valid JSON, no markdown.',
        },
        {
          role: 'user',
          content: `Build a complete character sheet for "${characterName}" for use in AI video generation.

APPEARANCE DESCRIPTION FROM PHOTOS:
${appearanceDesc}

Return this JSON structure:
{
  "characterName": "${characterName}",
  "appearanceSummary": "1-2 sentence description for quick reference",
  "appearance": {
    "face": "skin tone, eye shape/color, eyebrow, facial structure, distinctive features",
    "hair": "color, length, style, texture",
    "build": "height, body type",
    "signature": "most distinctive visual trait that must always be preserved"
  },
  "outfitSignature": "describe signature outfit style and colors",
  "accessories": "glasses, jewelry, hats, bags, etc.",
  "personality": "3-5 personality traits visible in their appearance/vibe",
  "voiceDirection": "suggested VO voice character (gender, tone, energy, e.g. friendly male mascot, warm energetic)",
  "animationStyle": "recommended 3D style (e.g. 3D semi-cartoon premium, glossy cinematic)",
  "colorPalette": ["primary color associated with character", "secondary color", "accent color"],
  "constraints": [
    "DO NOT alter [specific feature] — this is the character's signature look",
    "Maintain [specific outfit element] in all scenes",
    "Never change [product/accessory name] appearance"
  ],
  "negativePrompt": "no gore, no horror, no realistic wounds, no medical imagery — list any other constraints specific to this character",
  "promptPrefix": "Ready-to-use prefix for imagePrompts: start every scene prompt with this exact text to ensure character consistency"
}`,
        },
      ],
      maxTokens: 1500,
    });

    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return res.status(500).json({ error: 'Failed to parse character sheet response' });

    const sheet = JSON.parse(m[0]);
    res.json({ characterSheet: sheet, rawAppearance: appearanceDesc });
  } catch (e) {
    console.error('[character-studio/build-sheet]', e.message);
    res.status(500).json({ error: e.message || 'Failed to build character sheet' });
  }
});

// ─── 2. PROMPT TEMPLATE MANAGER ──────────────────────────────────────────────

// GET /api/character-studio/templates
router.get('/templates', requireAuth, async (req, res) => {
  const { characterId } = req.query;
  const where = { userId: req.user.id };
  if (characterId) where.characterId = characterId;

  const templates = await prisma.promptTemplate.findMany({
    where,
    include: { character: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ templates });
});

// POST /api/character-studio/templates
router.post('/templates', requireAuth, async (req, res) => {
  const {
    characterId = null,
    name,
    sceneType = 'custom',
    imagePrompt,
    voiceover = null,
    voiceDirection = null,
    textOverlay = null,
    cameraMovement = null,
    mood = null,
    style = null,
    negativePrompt = null,
    tags = [],
  } = req.body || {};

  if (!name || !imagePrompt) {
    return res.status(400).json({ error: 'name and imagePrompt are required' });
  }

  // Verify character belongs to user if provided
  if (characterId) {
    const char = await prisma.character.findFirst({ where: { id: characterId, userId: req.user.id } });
    if (!char) return res.status(403).json({ error: 'Character not found or access denied' });
  }

  const template = await prisma.promptTemplate.create({
    data: {
      userId: req.user.id,
      characterId: characterId || null,
      name, sceneType, imagePrompt, voiceover, voiceDirection,
      textOverlay, cameraMovement, mood, style, negativePrompt,
      tags: Array.isArray(tags) ? tags : [],
    },
    include: { character: { select: { id: true, name: true } } },
  });
  res.status(201).json({ template });
});

// PUT /api/character-studio/templates/:id
router.put('/templates/:id', requireAuth, async (req, res) => {
  const existing = await prisma.promptTemplate.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!existing) return res.status(404).json({ error: 'Template not found' });

  const {
    name, sceneType, imagePrompt, voiceover, voiceDirection,
    textOverlay, cameraMovement, mood, style, negativePrompt, tags, characterId,
  } = req.body || {};

  const template = await prisma.promptTemplate.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(sceneType !== undefined && { sceneType }),
      ...(imagePrompt !== undefined && { imagePrompt }),
      ...(voiceover !== undefined && { voiceover }),
      ...(voiceDirection !== undefined && { voiceDirection }),
      ...(textOverlay !== undefined && { textOverlay }),
      ...(cameraMovement !== undefined && { cameraMovement }),
      ...(mood !== undefined && { mood }),
      ...(style !== undefined && { style }),
      ...(negativePrompt !== undefined && { negativePrompt }),
      ...(tags !== undefined && { tags }),
      ...(characterId !== undefined && { characterId: characterId || null }),
    },
    include: { character: { select: { id: true, name: true } } },
  });
  res.json({ template });
});

// DELETE /api/character-studio/templates/:id
router.delete('/templates/:id', requireAuth, async (req, res) => {
  const existing = await prisma.promptTemplate.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!existing) return res.status(404).json({ error: 'Template not found' });
  await prisma.promptTemplate.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ─── 3. SCENE STORYBOARD BUILDER ─────────────────────────────────────────────

/**
 * POST /api/character-studio/build-scene
 * From a simple brief → generate full scene config JSON (motion, camera, overlay, VO)
 * Body: { brief, characterSheet?, productDesc?, sceneCount, style?, mood? }
 */
router.post('/build-scene', requireAuth, async (req, res) => {
  const {
    brief,
    characterSheet = null,      // JSON object from build-sheet
    productDesc = null,
    sceneCount = 3,
    style = '3D semi-cartoon premium, glossy, cinematic, smooth animation, vertical 9:16',
    mood = null,
    templateIds = [],           // optional: apply existing templates as context
  } = req.body || {};

  if (!brief) return res.status(400).json({ error: 'brief is required' });

  const safeCount = Math.min(12, Math.max(1, parseInt(sceneCount) || 3));

  // Pull template context if templateIds provided
  let templateContext = '';
  if (Array.isArray(templateIds) && templateIds.length > 0) {
    const templates = await prisma.promptTemplate.findMany({
      where: { id: { in: templateIds }, userId: req.user.id },
    });
    if (templates.length > 0) {
      templateContext = `\nREFERENCE TEMPLATES (for style consistency):\n${templates.map((t, i) =>
        `Template ${i + 1} (${t.sceneType}): ${t.imagePrompt.slice(0, 200)}`
      ).join('\n')}`;
    }
  }

  // Build a tight character lock string — used both in the GPT prompt AND as a hard inject
  // into every scene's [CHARACTER] block after GPT returns.
  const charLockParts = characterSheet ? [
    characterSheet.promptPrefix,
    characterSheet.appearanceSummary,
    characterSheet.outfitSignature,
    characterSheet.accessories,
    ...(characterSheet.constraints || []),
    characterSheet.negativePrompt,
  ].filter(Boolean) : [];
  const charLock = charLockParts.join('. ');

  const characterBlock = characterSheet
    ? `CHARACTER LOCK — copy [CHARACTER] block EXACTLY as follows, do NOT paraphrase:
"${characterSheet.characterName}": ${charLock}`
    : '';

  try {
    const raw = await chatCompletion({
      model: config.models.scalingChat || config.models.chat,
      messages: [
        {
          role: 'system',
          content: 'You are a senior video ad director specializing in animated Indonesian skincare/FMCG ads. Generate complete, production-ready scene configurations for GeminiGen grok-3 video generation. Return only valid JSON, no markdown. CRITICAL: When a CHARACTER LOCK is provided, you MUST copy it verbatim into every [CHARACTER] block — never summarize, paraphrase, or alter it.',
        },
        {
          role: 'user',
          content: `Generate a ${safeCount}-scene video storyboard config from this brief.

BRIEF: "${brief}"

${characterBlock}
${productDesc ? `PRODUCT: ${productDesc}` : ''}
${mood ? `MOOD: ${mood}` : ''}
STYLE: ${style}
${templateContext}

Generate exactly ${safeCount} scenes. Each scene = 1 standalone 10-second GeminiGen clip.
Structure each scene like this (use these section headers inside imagePrompt):
[STYLE] animation quality, aspect ratio
[CHARACTER] ${charLock ? `MUST start with: "${charLock.slice(0, 120)}..." then add pose/expression for this scene` : 'appearance + constraints'}
[ENVIRONMENT] setting, atmosphere, particles, lighting
[MOTION] specific character/object movements — very specific (entry, action, reaction)
[CAMERA] shot type + movement direction
[MOOD] emotional keywords
[TEXT OVERLAY] headline + subtext to show in video
[NEGATIVE] no gore, no horror, no wounds, no medical imagery

Return this JSON:
{
  "title": "short storyboard title",
  "totalDuration": ${safeCount * 10},
  "style": "${style}",
  "scenes": [
    {
      "scene": 1,
      "duration": "0-10s",
      "sceneType": "hook",
      "imagePrompt": "[STYLE] ... [CHARACTER] ... [ENVIRONMENT] ... [MOTION] ... [CAMERA] ... [MOOD] ... [TEXT OVERLAY] ... [NEGATIVE] ...",
      "voiceover": "[VOICE: karakter suara] Kalimat 1 hook kuat. Kalimat 2 agitasi. Kalimat 3 solusi.",
      "voiceDirection": "English description of voice character",
      "textOverlay": "HEADLINE / subtext",
      "cameraMovement": "specific shot type and movement",
      "mood": "mood keywords",
      "notes": "director notes for this scene"
    }
  ]
}`,
        },
      ],
      maxTokens: 5000,
    });

    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return res.status(500).json({ error: 'Failed to parse scene config response' });

    const config2 = JSON.parse(m[0]);
    if (!Array.isArray(config2.scenes)) config2.scenes = [];

    // ── Character lock: hard-inject character description into every scene's
    // [CHARACTER] block so GPT-image-2 gets the exact visual spec, not GPT's
    // paraphrase. This is the primary fix for character drift in preview images.
    if (charLock && config2.scenes.length > 0) {
      config2.scenes = config2.scenes.map((scene) => {
        if (!scene.imagePrompt) return scene;
        const imagePrompt = scene.imagePrompt.replace(
          /\[CHARACTER\]\s*[^\[]+/i,
          `[CHARACTER] ${charLock} `
        );
        // If [CHARACTER] tag not found at all, prepend it
        const finalPrompt = imagePrompt.includes('[CHARACTER]')
          ? imagePrompt
          : `[CHARACTER] ${charLock} ${imagePrompt}`;
        return { ...scene, imagePrompt: finalPrompt };
      });
    }

    res.json({ storyboard: config2 });
  } catch (e) {
    console.error('[character-studio/build-scene]', e.message);
    res.status(500).json({ error: e.message || 'Failed to build scene config' });
  }
});

// ─── 4. VIDEO GENERATION ─────────────────────────────────────────────────────

/**
 * POST /api/character-studio/generate-video
 * Async job: GeminiGen clips per scene → FFmpeg merge → final video URL.
 * Returns { jobId } immediately — poll GET /jobs/:id for status.
 *
 * Body: {
 *   scenes: [{ scene, duration, imagePrompt, voiceover, imageUrl?, textOverlay?, voiceDirection? }],
 *   characterPhotosBase64?: string[]   — base64 data URLs of character ref photos (fallback ref)
 *   aspectRatio?: '9:16' | '16:9' | '1:1'
 * }
 */
router.post('/generate-video', requireAuth, async (req, res) => {
  const { scenes, characterPhotosBase64 = [], aspectRatio = '9:16' } = req.body || {};
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return res.status(400).json({ error: 'scenes array is required' });
  }

  const safeScenes = scenes.slice(0, 12); // max 12 = 120s
  const id = uuidv4();
  const job = {
    id,
    status: 'generating',
    progress: 0,
    log: [],
    clips: [],
    finalVideoUrl: null,
    error: null,
    createdAt: Date.now(),
    // Store for retry — allows re-running only failed clips later
    _scenes: safeScenes,
    _characterPhotosBase64: characterPhotosBase64,
    _aspectRatio: aspectRatio,
  };
  STUDIO_VIDEO_JOBS.set(id, job);
  _gcJob(id);

  // Return jobId immediately — generation runs in background
  res.json({ jobId: id });

  _runStudioVideoJob(job, safeScenes, characterPhotosBase64, aspectRatio).catch((e) => {
    job.status = 'failed';
    job.error = e.message;
    console.error(`[studio-job:${id}] unhandled error:`, e.message);
  });
});

/**
 * GET /api/character-studio/jobs/:id
 * Poll async video generation job status.
 */
router.get('/jobs/:id', requireAuth, (req, res) => {
  const job = STUDIO_VIDEO_JOBS.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found or expired (max 2h)' });
  // Strip private fields from response
  const { _scenes, _characterPhotosBase64, _aspectRatio, ...pub } = job;
  res.json(pub);
});

/**
 * POST /api/character-studio/jobs/:id/retry
 * Retry only the failed clips from a completed/failed job, then re-merge.
 */
router.post('/jobs/:id/retry', requireAuth, async (req, res) => {
  const job = STUDIO_VIDEO_JOBS.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found or expired' });
  if (!['done', 'failed'].includes(job.status)) {
    return res.status(400).json({ error: 'Job is still running' });
  }
  if (!job._scenes) return res.status(400).json({ error: 'Scene data unavailable for retry' });

  const failedScenes = job._scenes.filter((s) => {
    const clip = job.clips.find((c) => c.scene === s.scene);
    return !clip?.videoUrl;
  });
  if (failedScenes.length === 0) {
    return res.status(400).json({ error: 'No failed clips to retry' });
  }

  // Reset job state (keep successful clips intact)
  job.status = 'generating';
  job.error = null;
  job.finalVideoUrl = null;
  job.progress = 0;
  job.log.push(`--- Retrying ${failedScenes.length} failed clip(s) ---`);

  res.json({ jobId: job.id });

  _retryFailedClips(job, failedScenes).catch((e) => {
    job.status = 'failed';
    job.error = e.message;
    console.error(`[studio-job:${job.id}] retry unhandled error:`, e.message);
  });
});

/**
 * Internal async runner for video generation + merge.
 */
async function _runStudioVideoJob(job, scenes, characterPhotosBase64, aspectRatio) {
  const addLog = (msg) => {
    job.log.push(msg);
    console.log(`[studio-job:${job.id}] ${msg}`);
  };

  try {
    // ── Phase 1: Build scene variations for batchGenerateVideos ──────────────
    addLog(`Building ${scenes.length} scene variation(s) for GeminiGen...`);

    const sceneVariations = scenes.map((s) => {
      const safeVO = (s.voiceover || '').replace(/[\r\n]+/g, ' ').replace(/"/g, "'").trim();
      const textOverlayBlock = s.textOverlay
        ? `\n\n[TEXT OVERLAY IN VIDEO]: "${s.textOverlay.replace(/"/g, "'")}"`
        : '';
      const voiceBlock = s.voiceDirection
        ? `\n[VO VOICE CHARACTER]: ${s.voiceDirection}`
        : '';
      const fullPrompt = `${s.imagePrompt}${textOverlayBlock}\n\nNARRATION (Bahasa Indonesia):${voiceBlock}\n${safeVO || '(no voiceover)'}`;
      // GPT-image-2 storyboard URL used as GeminiGen reference (must be public http URL)
      const sceneImageUrl =
        s.imageUrl && typeof s.imageUrl === 'string' && s.imageUrl.startsWith('http')
          ? s.imageUrl
          : null;
      if (sceneImageUrl) addLog(`Scene ${s.scene}: storyboard image → GeminiGen reference ✓`);
      return {
        imagePrompt: fullPrompt,
        angle: `scene_${s.scene}`,
        headline: '',
        sceneImageUrl,
      };
    });

    // ── Phase 2: Upload fallback character reference (used when scene has no imageUrl) ──
    let refImageUrl = null;
    const allPhotos = Array.isArray(characterPhotosBase64) ? characterPhotosBase64 : [];
    if (allPhotos.length > 0 && sceneVariations.some((v) => !v.sceneImageUrl)) {
      const raw = allPhotos[0].replace(/^data:[^;]+;base64,/, '');
      try {
        refImageUrl = await uploadImageToApimart(raw, 'image/jpeg');
        addLog(`Character reference uploaded for scenes without storyboard image ✓`);
      } catch (e) {
        addLog(`Character ref upload failed (non-fatal): ${e.message}`);
      }
    }

    // ── Phase 3: Generate GeminiGen video clips (batched 3 at a time) ─────────
    addLog(`Generating ${scenes.length} GeminiGen clip(s) — this takes ~2 min per clip...`);
    job.progress = 10;

    const results = await batchGenerateVideos(sceneVariations, aspectRatio, refImageUrl);

    // Map results back to per-scene structure
    job.clips = results.map((r, i) => ({
      scene: scenes[i]?.scene ?? i + 1,
      duration: scenes[i]?.duration ?? `${i * 10}-${(i + 1) * 10}s`,
      videoUrl: r.videoUrl || null,
      videoError: r.videoError || null,
    }));

    const successClips = results.filter((r) => r.videoUrl);
    addLog(`${successClips.length}/${scenes.length} clip(s) generated successfully`);
    job.progress = 70;

    if (successClips.length === 0) {
      job.status = 'failed';
      job.error = 'All video clips failed to generate. Check imagePrompts.';
      return;
    }

    // ── Phase 4: Single clip → no merge needed ─────────────────────────────────
    if (successClips.length === 1) {
      job.finalVideoUrl = successClips[0].videoUrl;
      job.status = 'done';
      job.progress = 100;
      addLog('Single clip — no merge needed. Done!');
      return;
    }

    // ── Phase 5: Multiple clips → download + FFmpeg concat ────────────────────
    job.status = 'merging';
    addLog(`Downloading ${successClips.length} clips for FFmpeg merge...`);
    job.progress = 75;

    // reelsMerger uses /tmp/reels/{sessionId}/clip-{i}.mp4 convention
    const sessionId = `studio_${job.id}`;

    try {
      // downloadClips expects { videoUrl } objects
      await downloadClips(sessionId, successClips, ({ clipIndex, total }) => {
        addLog(`Downloaded ${clipIndex + 1}/${total}`);
        job.progress = 75 + Math.round(((clipIndex + 1) / total) * 8);
      });

      addLog('Merging with FFmpeg...');
      job.progress = 85;

      await mergeClips(
        sessionId,
        successClips.length,
        ({ phase, progress }) => {
          job.progress = 85 + Math.round((progress || 0) * 0.08);
        },
        { exportResolution: '720p' }
      );

      const mergedLocalPath = getMergedPath(sessionId);

      // Copy to uploads dir for static serving
      const uploadDir = path.resolve(config.upload.uploadDir);
      const studioDir = path.join(uploadDir, 'studio_finals');
      fs.mkdirSync(studioDir, { recursive: true });
      const finalFileName = `studio_${job.id}.mp4`;
      const finalPath = path.join(studioDir, finalFileName);
      fs.copyFileSync(mergedLocalPath, finalPath);

      job.finalVideoUrl = `${config.backendPublicUrl}/uploads/studio_finals/${finalFileName}`;
      job.status = 'done';
      job.progress = 100;
      addLog(`Selesai! Final video (${scenes.length * 10}s): ${job.finalVideoUrl.slice(0, 60)}...`);
    } finally {
      // Always clean tmp session dir
      try { cleanupAll(sessionId); } catch {}
    }
  } catch (err) {
    addLog(`Fatal error: ${err.message}`);
    job.status = 'failed';
    job.error = err.message;
    throw err;
  }
}

/**
 * Retry only the failed clips, then re-merge with the existing successful ones.
 */
async function _retryFailedClips(job, failedScenes) {
  const addLog = (msg) => {
    job.log.push(msg);
    console.log(`[studio-job:${job.id}] ${msg}`);
  };

  try {
    addLog(`Regenerating ${failedScenes.length} failed clip(s)...`);

    const sceneVariations = failedScenes.map((s) => {
      const safeVO = (s.voiceover || '').replace(/[\r\n]+/g, ' ').replace(/"/g, "'").trim();
      const textOverlayBlock = s.textOverlay
        ? `\n\n[TEXT OVERLAY IN VIDEO]: "${s.textOverlay.replace(/"/g, "'")}"`
        : '';
      const voiceBlock = s.voiceDirection ? `\n[VO VOICE CHARACTER]: ${s.voiceDirection}` : '';
      const fullPrompt = `${s.imagePrompt}${textOverlayBlock}\n\nNARRATION (Bahasa Indonesia):${voiceBlock}\n${safeVO || '(no voiceover)'}`;
      const sceneImageUrl =
        s.imageUrl && typeof s.imageUrl === 'string' && s.imageUrl.startsWith('http')
          ? s.imageUrl
          : null;
      if (sceneImageUrl) addLog(`Scene ${s.scene}: storyboard image → GeminiGen reference ✓`);
      return { imagePrompt: fullPrompt, angle: `scene_${s.scene}`, headline: '', sceneImageUrl };
    });

    // Upload fallback ref if needed
    let refImageUrl = null;
    const allPhotos = Array.isArray(job._characterPhotosBase64) ? job._characterPhotosBase64 : [];
    if (allPhotos.length > 0 && sceneVariations.some((v) => !v.sceneImageUrl)) {
      try {
        const raw = allPhotos[0].replace(/^data:[^;]+;base64,/, '');
        refImageUrl = await uploadImageToApimart(raw, 'image/jpeg');
        addLog('Character ref re-uploaded ✓');
      } catch (e) {
        addLog(`Char ref upload failed (non-fatal): ${e.message}`);
      }
    }

    const results = await batchGenerateVideos(sceneVariations, job._aspectRatio || '9:16', refImageUrl);

    // Merge retry results back into job.clips
    results.forEach((r, i) => {
      const scene = failedScenes[i].scene;
      const idx = job.clips.findIndex((c) => c.scene === scene);
      const newClip = {
        scene,
        duration: failedScenes[i].duration,
        videoUrl: r.videoUrl || null,
        videoError: r.videoError || null,
      };
      if (idx >= 0) job.clips[idx] = newClip;
      else job.clips.push(newClip);
    });

    const successClips = job.clips.filter((c) => c.videoUrl);
    addLog(`${successClips.length}/${job._scenes.length} clip(s) successful after retry`);

    if (successClips.length === 0) {
      job.status = 'failed';
      job.error = 'All clips failed even after retry';
      return;
    }

    if (successClips.length === 1) {
      job.finalVideoUrl = successClips[0].videoUrl;
      job.status = 'done';
      job.progress = 100;
      addLog('Single clip — done!');
      return;
    }

    // Re-merge all successful clips
    job.status = 'merging';
    job.progress = 75;
    addLog(`Re-downloading ${successClips.length} clips for FFmpeg merge...`);

    const sessionId = `studio_${job.id}_r`;
    try {
      await downloadClips(sessionId, successClips, ({ clipIndex, total }) => {
        addLog(`Downloaded ${clipIndex + 1}/${total}`);
        job.progress = 75 + Math.round(((clipIndex + 1) / total) * 10);
      });

      addLog('Re-merging with FFmpeg...');
      job.progress = 87;

      await mergeClips(
        sessionId,
        successClips.length,
        ({ progress }) => { job.progress = 87 + Math.round((progress || 0) * 0.1); },
        { exportResolution: '720p' }
      );

      const mergedLocalPath = getMergedPath(sessionId);
      const uploadDir = path.resolve(config.upload.uploadDir);
      const studioDir = path.join(uploadDir, 'studio_finals');
      fs.mkdirSync(studioDir, { recursive: true });
      const finalFileName = `studio_${job.id}.mp4`; // overwrite previous merge
      fs.copyFileSync(mergedLocalPath, path.join(studioDir, finalFileName));

      job.finalVideoUrl = `${config.backendPublicUrl}/uploads/studio_finals/${finalFileName}`;
      job.status = 'done';
      job.progress = 100;
      addLog(`Retry selesai! ${successClips.length}/${job._scenes.length} clips merged.`);
    } finally {
      try { cleanupAll(sessionId); } catch {}
    }
  } catch (err) {
    addLog(`Retry error: ${err.message}`);
    job.status = 'failed';
    job.error = err.message;
    throw err;
  }
}

module.exports = router;
