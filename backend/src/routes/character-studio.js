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
const prisma = require('../db/prisma');
const { requireAuth } = require('../middleware/auth');
const { chatCompletion } = require('../services/apimart');
const { buildCharacterSheet } = require('../services/translatePromptService');
const config = require('../config');

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

  const characterBlock = characterSheet
    ? `CHARACTER: "${characterSheet.characterName}"
Appearance: ${characterSheet.appearanceSummary || ''}
Prompt prefix: ${characterSheet.promptPrefix || ''}
Constraints: ${(characterSheet.constraints || []).join(' | ')}
Voice: ${characterSheet.voiceDirection || ''}`
    : '';

  try {
    const raw = await chatCompletion({
      model: config.models.scalingChat || config.models.chat,
      messages: [
        {
          role: 'system',
          content: 'You are a senior video ad director specializing in animated Indonesian skincare/FMCG ads. Generate complete, production-ready scene configurations for GeminiGen grok-3 video generation. Return only valid JSON, no markdown.',
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
[CHARACTER] appearance + constraints
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
    res.json({ storyboard: config2 });
  } catch (e) {
    console.error('[character-studio/build-scene]', e.message);
    res.status(500).json({ error: e.message || 'Failed to build scene config' });
  }
});

module.exports = router;
