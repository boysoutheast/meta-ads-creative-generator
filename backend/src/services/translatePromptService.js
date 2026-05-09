/**
 * translatePromptService.js
 *
 * Given a video analysis + user intent + asset (product/character/none),
 * use GPT-4o to produce a detailed GeminiGen video prompt + per-scene
 * storyboard with Indonesian VO and rich imagePrompts for GPT-image-2.
 *
 * CHARACTER MODE:
 *   - Analyzes ALL character photos (up to 10) in parallel via GPT-4o vision
 *   - Merges into a comprehensive "character sheet" (hair, skin, outfit, features)
 *   - Injects character appearance into EVERY scene imagePrompt explicitly
 *   - All character photos passed as referenceImages to GPT-image-2 later
 */

const { chatCompletion, analyzeImage } = require('./apimart');
const config = require('../config');

/**
 * Analyze multiple character photos in parallel and build a merged
 * visual character sheet from all descriptions.
 * @param {string[]} photosBase64 - array of base64 data URLs or raw base64 strings
 * @returns {Promise<string>} - merged character appearance description
 */
async function buildCharacterSheet(photosBase64, characterName) {
  if (!photosBase64 || photosBase64.length === 0) return '';

  // Analyze up to 10 photos in parallel
  const toAnalyze = photosBase64.slice(0, 10);
  const descriptions = await Promise.all(
    toAnalyze.map((raw, i) => {
      // Strip data: prefix if present
      const hasPrefix = raw.startsWith('data:');
      const mimeMatch = hasPrefix ? raw.match(/^data:([^;]+);base64,/) : null;
      const mimeType = mimeMatch?.[1] || 'image/jpeg';
      const base64 = hasPrefix ? raw.replace(/^data:[^;]+;base64,/, '') : raw;

      return analyzeImage({
        imageBase64: base64,
        mimeType,
        prompt: `This is reference photo ${i + 1} of ${toAnalyze.length} for character "${characterName}".
Extract these specific details for AI image generation:
- FACE: skin tone, eye shape/color, eyebrow style, facial structure, any distinctive features
- HAIR: color, length, style/texture (straight/wavy/curly), bangs or not
- BUILD: approximate height (tall/average/petite), body type
- OUTFIT in this photo: specific clothing items, colors, patterns, materials
- ACCESSORIES: glasses, jewelry, bags, hats, etc.
- EXPRESSION/ENERGY: default expression style, overall vibe/personality

Be very specific. Under 80 words. Use descriptive adjectives an AI image model would use.`,
      }).catch(() => null);
    })
  );

  const valid = descriptions.filter(Boolean);
  if (valid.length === 0) return '';

  // If multiple photos, use GPT-4o to merge into a unified coherent character sheet
  if (valid.length === 1) return valid[0];

  const mergeRaw = await chatCompletion({
    model: config.models.scalingChat || config.models.chat,
    messages: [
      {
        role: 'system',
        content: 'You are a character designer. Merge multiple photo descriptions into one precise, consistent character sheet for AI image generation. Return plain text only, no JSON.',
      },
      {
        role: 'user',
        content: `Merge these ${valid.length} descriptions of the SAME character "${characterName}" into one coherent character sheet.
Focus on the MOST CONSISTENT features across photos. If outfit varies, describe their signature style.
Output: Under 100 words, highly specific, using terms AI image models understand.

${valid.map((d, i) => `Photo ${i + 1}: ${d}`).join('\n\n')}`,
      },
    ],
    maxTokens: 200,
  }).catch(() => valid[0]); // fallback to first description if merge fails

  return mergeRaw || valid[0];
}

/**
 * Main translate function.
 * @param {object} opts
 * @param {object} opts.videoAnalysis
 * @param {string} opts.userIntent
 * @param {string} opts.productName
 * @param {string} [opts.productDescription]
 * @param {'product'|'character'|'none'} [opts.assetMode]
 * @param {string[]} [opts.characterPhotosBase64]  - ALL character photos (data URLs or raw base64), up to 10
 * @param {string} [opts.productPhotoBase64]       - single product photo (raw base64) for product mode
 * @param {string} [opts.productPhotoMime]
 * @param {number} [opts.targetDuration]           - desired output duration in seconds (multiples of 10, default 30)
 * @returns {Promise<{ videoPrompt, hookVariants, scriptOutline, adaptedScenes, adaptedAnalysis }>}
 */
async function translateVideoPrompt({
  videoAnalysis,
  userIntent,
  productName,
  productDescription = '',
  assetMode = 'product',
  characterPhotosBase64 = [],   // replaces single characterPhotoBase64
  characterPhotoBase64 = null,  // legacy fallback
  characterPhotoMime = 'image/jpeg',
  productPhotoBase64 = null,
  targetDuration = 30,          // new: duration in seconds, multiples of 10
}) {
  const analysisStr = JSON.stringify({
    overallStyle: videoAnalysis.overallStyle,
    pacing: videoAnalysis.pacing,
    hookType: videoAnalysis.hookType,
    colorPalette: videoAnalysis.colorPalette,
    cameraMovement: videoAnalysis.cameraMovement,
    emotionArc: videoAnalysis.emotionArc,
    musicVibe: videoAnalysis.musicVibe,
    scriptStructure: videoAnalysis.scriptStructure,
    toneOfVoice: videoAnalysis.toneOfVoice,
    keyMessages: videoAnalysis.keyMessages,
    hookWords: videoAnalysis.hookWords,
  }, null, 2);

  // Per-scene VO context from Gemini analysis
  const originalScenes = Array.isArray(videoAnalysis.scenes) ? videoAnalysis.scenes : [];
  const scenesVoContext = originalScenes.length > 0
    ? originalScenes
        .map((s) => {
          const sceneNum = s.sceneNumber ?? '?';
          const dur = s.duration ?? '';
          const dialogue = (s.dialogue || '').trim();
          const desc = (s.description || '').slice(0, 80);
          return dialogue
            ? `Scene ${sceneNum} (${dur}): "${dialogue}" [visual: ${desc}]`
            : `Scene ${sceneNum} (${dur}): [silent / no VO] [visual: ${desc}]`;
        })
        .join('\n')
    : (videoAnalysis.transcript
        ? `Full transcript: "${(videoAnalysis.transcript || '').slice(0, 600)}"`
        : 'No transcript available');

  // ── Character mode: build comprehensive character sheet from ALL photos ────
  let characterSheet = '';
  if (assetMode === 'character') {
    // Merge legacy single-photo with array
    const allPhotos = [
      ...characterPhotosBase64,
      ...(characterPhotoBase64 ? [characterPhotoBase64] : []),
    ].filter(Boolean);

    if (allPhotos.length > 0) {
      console.log(`[translatePrompt] Analyzing ${allPhotos.length} character photo(s) for "${productName}"…`);
      characterSheet = await buildCharacterSheet(allPhotos, productName).catch((e) => {
        console.warn('[translatePrompt] characterSheet build failed:', e.message);
        return '';
      });
      if (characterSheet) console.log('[translatePrompt] Character sheet built:', characterSheet.slice(0, 120));
    }
  }

  // ── Product mode: optional visual description from product photo ──────────
  let productVisualDesc = '';
  if (assetMode === 'product' && productPhotoBase64) {
    try {
      productVisualDesc = await analyzeImage({
        imageBase64: productPhotoBase64.replace(/^data:[^;]+;base64,/, ''),
        mimeType: 'image/jpeg',
        prompt: 'Describe this product for AI image generation: shape, color, packaging, label/logo, size, texture. Under 60 words.',
      });
    } catch (e) {
      console.warn('[translatePrompt] product photo analysis non-fatal:', e.message);
    }
  }

  // ── Build asset block for GPT-4o prompt ──────────────────────────────────
  const assetBlock = assetMode === 'character'
    ? `CHARACTER NAME: "${productName}"
${characterSheet ? `CHARACTER APPEARANCE (from ${[...characterPhotosBase64, ...(characterPhotoBase64 ? [characterPhotoBase64] : [])].filter(Boolean).length} reference photos):
${characterSheet}` : '(no photo provided — describe character based on name and intent only)'}
${productDescription ? `ADDITIONAL CONTEXT: ${productDescription}` : ''}`
    : assetMode === 'none'
    ? 'ASSET: None — build prompt around user intent and winning ad DNA. No specific product or character.'
    : `PRODUCT: "${productName}"
${productVisualDesc ? `PRODUCT APPEARANCE: ${productVisualDesc}` : ''}
${productDescription ? `PRODUCT DESCRIPTION: ${productDescription}` : ''}`;

  const characterImagePromptPrefix = characterSheet
    ? `MANDATORY: Every imagePrompt MUST start with "CHARACTER '${productName}': ${characterSheet.slice(0, 120)}. " then describe the scene action.`
    : assetMode === 'character'
    ? `MANDATORY: Every imagePrompt MUST start with "CHARACTER '${productName}' in scene: " then describe scene.`
    : '';

  const adaptInstruction = assetMode === 'character'
    ? `Showcase the character "${productName}" (appearance described above) — they must appear in every scene`
    : assetMode === 'none'
    ? 'Express the concept from user intent — no specific character or product branding'
    : `Showcase product "${productName}"${productVisualDesc ? ' (appearance described above)' : ''}`;

  // ── Duration-aware scene count ────────────────────────────────────────────
  const safeDuration = Math.max(10, Math.round((targetDuration || 30) / 10) * 10);
  // Rule of thumb: ~5s per scene, min 2, max 15
  const targetSceneCount = Math.min(15, Math.max(2, Math.round(safeDuration / 5)));

  // ── GPT-4o call ───────────────────────────────────────────────────────────
  const raw = await chatCompletion({
    model: config.models.scalingChat || config.models.chat,
    messages: [
      {
        role: 'system',
        content: 'You are an expert video ad director, copywriter, and AI prompt engineer. Your imagePrompts will be used directly with GPT-image-2 + character reference photos to generate storyboard frames. Be extremely specific about visual appearance. Return only valid JSON, no markdown.',
      },
      {
        role: 'user',
        content: `A winning ad video has been analyzed. Adapt its creative DNA for a new asset with a TARGET DURATION of ${safeDuration} seconds.

WINNING AD DNA:
${analysisStr}

ORIGINAL SCENES + VOICEOVER (from winning ad):
${scenesVoContext}

USER INTENT:
"${userIntent}"

${assetBlock}

${characterImagePromptPrefix}

TARGET OUTPUT DURATION: ${safeDuration} seconds total → generate approximately ${targetSceneCount} scenes (each ~${Math.round(safeDuration / targetSceneCount)}s)

YOUR TASKS:

1. VIDEO PROMPT (150-200 words, English) for GeminiGen grok-3:
   - Replicate visual style, pacing, camera movement, color palette of winning ad
   - ${adaptInstruction}
   - Incorporate user intent: "${userIntent}"
   - Paced for ${safeDuration} seconds total
   - Include cinematic details: shot types, lighting, transitions, music direction

2. HOOK VARIANTS: 3 opening lines (first 3 seconds), adapted from winning ad's hook style.

3. SCRIPT OUTLINE: step-by-step structure (hook → conflict/problem → resolution/solution → CTA) adapted for ${safeDuration}s

4. ADAPTED SCENES — generate exactly ${targetSceneCount} scenes totaling ~${safeDuration}s:
   - Each scene: duration, voiceover (Bahasa Indonesia, ALWAYS), imagePrompt (English)
   - voiceover: match emotional arc + timing of original. ALWAYS Indonesian.
   - imagePrompt: English prompt for GPT-image-2 (image generation AI). Rules:
     ${assetMode === 'character'
       ? `* MUST start with full character description: "CHARACTER '${productName}': [physical appearance]. "
       * Then describe: exact pose/action in this scene, setting/environment, lighting, color grade, camera angle
       * Include enough visual detail that GPT-image-2 can draw the scene without additional info
       * Under 120 words per scene`
       : assetMode === 'product'
       ? `* Describe the scene including the product "${productName}" prominently
       * Include: setting, lighting, color grade, camera angle, mood
       * Under 120 words per scene`
       : `* Describe scene: setting, mood, visual style, lighting, camera angle. Under 100 words.`
     }

5. ADAPTED ANALYSIS — mirror the winning ad analysis structure but adapted for this new ${safeDuration}s video:
   - hookType: adapted hook type label
   - hookBreakdown: { first3Seconds, hookWords, hookMechanism, viewerReaction }
   - overallStyle: adapted style description (keep similar visual DNA but for new product)
   - emotionArc: adapted emotion journey (hook → conflict → relief → excitement → CTA)
   - scriptStructure: { framework, hookLine, agitationPoints (array), solutionReveal, ctaLine }
   - keyMessages: array of strings (top 3-4 messages adapted for new product)
   - ctaStrategy: { type, wording, placement }
   - audioDirection: string — music/VO direction for the adapted video

Return ONLY valid JSON — no markdown fences:
{
  "videoPrompt": "150-200 word cinematic video prompt in English",
  "hookVariants": ["hook 1", "hook 2", "hook 3"],
  "scriptOutline": "1) hook: ... 2) conflict: ... 3) solution: ... 4) CTA: ...",
  "adaptedScenes": [
    {
      "scene": 1,
      "duration": "0-Xs",
      "voiceover": "teks VO bahasa Indonesia scene 1",
      "imagePrompt": "GPT-image-2 prompt for scene 1${assetMode === 'character' ? ` — must start with CHARACTER '${productName}': [appearance]...` : ''}"
    }
  ],
  "adaptedAnalysis": {
    "hookType": "adapted hook type",
    "hookBreakdown": {
      "first3Seconds": "what happens in first 3s of adapted video",
      "hookWords": "opening words for adapted video",
      "hookMechanism": "why it stops scroll",
      "viewerReaction": "intended viewer reaction"
    },
    "overallStyle": "visual style description adapted for product",
    "emotionArc": "emotion journey adapted",
    "scriptStructure": {
      "framework": "framework name (e.g. PAS, AIDA)",
      "hookLine": "adapted hook line",
      "agitationPoints": ["pain point 1 adapted", "pain point 2 adapted"],
      "solutionReveal": "how product/character solves it",
      "ctaLine": "adapted CTA line in Indonesian"
    },
    "keyMessages": ["message 1 adapted", "message 2 adapted", "message 3 adapted"],
    "ctaStrategy": {
      "type": "CTA type",
      "wording": "CTA wording in Indonesian",
      "placement": "when CTA appears"
    },
    "audioDirection": "music and VO direction for adapted video"
  }
}`,
      },
    ],
    maxTokens: 3500,
  });

  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      if (!Array.isArray(parsed.adaptedScenes)) parsed.adaptedScenes = [];
      if (!parsed.adaptedAnalysis) parsed.adaptedAnalysis = null;
      return parsed;
    }
  } catch (e) {
    console.warn('[translatePromptService] JSON parse failed:', e.message);
  }

  return {
    videoPrompt: raw.slice(0, 400) || 'Video prompt generation failed.',
    hookVariants: [],
    scriptOutline: '',
    adaptedScenes: [],
    adaptedAnalysis: null,
  };
}

module.exports = { translateVideoPrompt };
