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
  targetDuration = 10,          // GeminiGen output = 10 seconds. Always 10 for scale-video.
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
          const voiceover = (s.voiceover || s.dialogue || '').trim();
          const desc = (s.description || '').slice(0, 80);
          return voiceover
            ? `Scene ${sceneNum} (${dur}): VO="${voiceover}" [visual: ${desc}]`
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
  // GeminiGen generates ONE 10-second clip. targetDuration is a multiple of 10.
  // Each 10s = 1 scene (= 1 GeminiGen clip). 10s=1 scene, 20s=2, 30s=3.
  const safeDuration = Math.min(120, Math.max(10, Math.round((targetDuration || 10) / 10) * 10));
  const targetSceneCount = safeDuration / 10; // 1 scene per 10s clip, max 12

  // ── GPT-4o call ───────────────────────────────────────────────────────────
  const raw = await chatCompletion({
    model: config.models.scalingChat || config.models.chat,
    messages: [
      {
        role: 'system',
        content: `You are a senior video ad director, AI prompt engineer, and Indonesian copywriter.
Your imagePrompts go directly to GeminiGen grok-3 (video generation) AND GPT-image-2 (storyboard preview).
Write prompts like a real director giving detailed instructions to an animator — specific, cinematic, complete.
Return ONLY valid JSON. No markdown, no code fences, no explanation outside the JSON.`,
      },
      {
        role: 'user',
        content: `A winning ad video has been analyzed. Adapt its creative DNA for a new ${safeDuration}s video.

═══ WINNING AD DNA ═══
${analysisStr}

═══ ORIGINAL SCENES + VO ═══
${scenesVoContext}

═══ USER INTENT ═══
"${userIntent}"

═══ ASSET ═══
${assetBlock}

${characterImagePromptPrefix}

═══ OUTPUT STRUCTURE ═══
Total: ${safeDuration}s = ${targetSceneCount} clip(s) × 10s each (GeminiGen generates ONE 10s clip per scene)
${Array.from({ length: targetSceneCount }, (_, i) => {
  const roles = ['HOOK — grab attention, stop the scroll instantly', 'BODY — agitate problem, reveal solution', 'CTA — drive action, close the sale'];
  const role = roles[Math.min(i, roles.length - 1)];
  return `- Clip ${i + 1} (${i * 10}-${(i + 1) * 10}s): ${role}`;
}).join('\n')}

═══ YOUR TASKS ═══

1. VIDEO PROMPT (200-300 words, English):
   Cinematic brief for the ENTIRE ${safeDuration}s video. Include:
   - Visual style, animation quality, color palette from winning ad DNA
   - ${adaptInstruction}
   - Shot progression across all ${targetSceneCount} clips
   - Lighting direction, music feel, overall mood

2. HOOK VARIANTS: 3 punchy opening lines (first 3s), adapted from winning ad hook style.

3. SCRIPT OUTLINE: hook → conflict → solution → CTA for ${safeDuration}s

4. ADAPTED SCENES — EXACTLY ${targetSceneCount} object(s) in the array. DO NOT return fewer.
   Each scene = one standalone 10s GeminiGen clip. Fields:

   a) voiceover (BAHASA INDONESIA — MANDATORY):
      - MINIMUM 3 kalimat padat per scene, dense and persuasive
      - Format: "[VOICE: tone karakter, contoh: suara laki-laki lucu energik] Kalimat 1. Kalimat 2. Kalimat 3."
      - Adapted from winning ad VO rhythm and energy

   b) imagePrompt (English — for GeminiGen video generation + GPT-image-2 storyboard):
      STRUCTURE YOUR imagePrompt LIKE THIS (use these exact section headers):
      [STYLE] Animation style, render quality, aspect ratio 9:16 vertical
      ${assetMode === 'character'
        ? `[CHARACTER] "${productName}" full appearance: ${characterSheet ? characterSheet.slice(0, 150) + '...' : 'describe based on name'} — DO NOT alter appearance`
        : assetMode === 'product'
        ? `[PRODUCT] "${productName}" exact appearance — DO NOT alter product look`
        : '[CONCEPT] Main visual concept for this scene'
      }
      [ENVIRONMENT] Detailed setting: location, atmosphere, background elements, particles, lighting mood
      [MOTION] Specific character/object movements in this 10s clip: entry, action, reaction, exit. Be very specific (e.g. "walks into frame from left, stops center, raises product toward camera, smiles confidently")
      [CAMERA] Shot type + movement (e.g. "Medium shot following character entry → slow push-in toward product in hand → end on product close-up")
      [MOOD] Emotional tone keywords
      [TEXT OVERLAY] Exact text to display in video (headline + subtext if applicable)
      [NEGATIVE] No gore, no horror, no realistic wounds, no medical imagery, no text errors

      Length: 250-400 words. More detail = better video quality.

   c) textOverlay: exact text shown in video (same as [TEXT OVERLAY] in imagePrompt, for frontend display)

   d) voiceDirection: one-line English description of the VO voice character (e.g. "Friendly male mascot voice, energetic, warm, like an edutainment host")

5. ADAPTED ANALYSIS (mirror exact fields from winning ad analysis):
   hookType, hookBreakdown {first3Seconds, hookWords, hookMechanism, viewerReaction},
   overallStyle, pacing, toneOfVoice, colorPalette (array of 3),
   emotionArc, musicVibe,
   scriptStructure {framework, hookLine, agitationPoints[], solutionReveal, ctaLine},
   keyMessages (array 3-4), ctaStrategy {type, wording, placement}, audioDirection

═══ JSON SCHEMA ═══
Return ONLY this JSON (no markdown):
{
  "videoPrompt": "200-300 word cinematic brief in English",
  "hookVariants": ["hook 1", "hook 2", "hook 3"],
  "scriptOutline": "hook → conflict → solution → CTA outline",
  "adaptedScenes": [
    {
      "scene": 1,
      "duration": "0-10s",
      "voiceover": "[VOICE: karakter suara] Kalimat 1. Kalimat 2. Kalimat 3.",
      "imagePrompt": "[STYLE] ... [CHARACTER/PRODUCT/CONCEPT] ... [ENVIRONMENT] ... [MOTION] ... [CAMERA] ... [MOOD] ... [TEXT OVERLAY] ... [NEGATIVE] ...",
      "textOverlay": "HEADLINE TEXT / subtext",
      "voiceDirection": "English voice character description"
    }
  ],
  "adaptedAnalysis": {
    "hookType": "...",
    "hookBreakdown": { "first3Seconds": "...", "hookWords": "...", "hookMechanism": "...", "viewerReaction": "..." },
    "overallStyle": "...",
    "pacing": "...",
    "toneOfVoice": "...",
    "colorPalette": ["color1", "color2", "color3"],
    "emotionArc": "...",
    "musicVibe": "...",
    "scriptStructure": { "framework": "...", "hookLine": "...", "agitationPoints": ["...", "..."], "solutionReveal": "...", "ctaLine": "..." },
    "keyMessages": ["...", "...", "..."],
    "ctaStrategy": { "type": "...", "wording": "...", "placement": "..." },
    "audioDirection": "..."
  }
}

CRITICAL: adaptedScenes array MUST have exactly ${targetSceneCount} element(s). Count before returning.`,
      },
    ],
    maxTokens: 6000,
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

module.exports = { translateVideoPrompt, buildCharacterSheet };
