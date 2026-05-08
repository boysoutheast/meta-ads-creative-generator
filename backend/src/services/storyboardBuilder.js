/**
 * storyboardBuilder.js
 *
 * Uses GPT-4o (via apimart) to generate a structured storyboard for a Grok reel.
 *
 * Architecture:
 *   - Every clip is independently generated (no extend chain)
 *   - Each clip gets a scene preview image (gpt-image-2) via sceneImageService
 *   - The scene image + grokPrompt are both passed to GeminiGen at generation time
 *   - grokPrompt describes MOTION/ANIMATION; scene image gives the visual reference
 *
 * Each clip object returned:
 *   {
 *     clipNumber     : 1-based index
 *     visualSummary  : 2-3 sentences describing the scene arc (Bahasa Indonesia)
 *     voScript       : EXACTLY 3 long sentences, 35-50 words (Bahasa Indonesia)
 *     grokPrompt     : structured English prompt using [FORMAT][SCENE]...[RESTRICTIONS]
 *     sceneImageUrl  : null initially — filled by sceneImageService after storyboard builds
 *     technicalConfig: { mainSubject, action, setting, lighting, visualStyle, cameraShot, additionalDetails }
 *   }
 */

const { chatCompletion } = require('./apimart');

const MODEL = process.env.VISION_MODEL || 'gpt-4o';

// ── build full storyboard from scratch ───────────────────────────────────────

async function buildStoryboard({ prompt, mode, duration, referenceImages = [] }) {
  const totalClips = Math.ceil(duration / 10);

  // Build reference images info for GPT-4o — only for @image tag usage in CHARACTER section
  const refImagesContext = referenceImages.length > 0
    ? `\nUSER REFERENCE IMAGES (uploaded character/product designs):\n${referenceImages.map(r => `  ${r.tag} = "${r.label}"`).join('\n')}\nIn [CHARACTER] section, write "Maintain exact design from ${referenceImages[0].tag}" when that subject appears.\n`
    : '';

  const systemPrompt = `You are an expert AI video director and copywriter specialising in short-form social media ads.
Your task is to create a detailed, clip-by-clip video storyboard for a Grok AI video generator.

Architecture:
- Each clip is exactly 10 seconds long and generated INDEPENDENTLY (no chaining)
- Each clip will receive its own scene reference image (pre-generated) + grokPrompt
- grokPrompt describes MOTION and ANIMATION — the scene image already handles the visual look
- Clips must flow narratively but each clip is visually self-contained
- visualSummary and voScript in Bahasa Indonesia
- grokPrompt MUST be in English using the structured template below
${refImagesContext}
VOICEOVER DENSITY RULES (critical):
- voScript: EXACTLY 3 long, information-dense sentences in Bahasa Indonesia
- Each sentence must carry real content — benefit, feature, or story beat
- Total words: 35–50 words across the 3 sentences — enough for 10 seconds of spoken audio
- Real TV/Instagram ad voiceover energy: energetic, benefit-driven, brand-aligned
- NEVER write less than 3 sentences. NEVER write vague filler.
- Good example: "Kulit kusam bukan takdir — itu tanda kulit butuh pertolongan ekstra setiap hari. Melastop mengandung Niacinamide 11% yang bekerja aktif mencerahkan tampilan kulit secara merata dari hari pertama. Dengan Tranexamic Acid 3%, tampilan flek dan noda hitam mulai memudar setelah pemakaian rutin selama 14 hari."

VISUAL SUMMARY RULES:
- visualSummary: 2-3 sentences describing the FULL visual arc — opening shot, mid action, closing moment

GROKPROMPT TEMPLATE (use this exact structure — describes MOTION, not just appearance):
[FORMAT] Vertical 9:16, 10 seconds, [style — e.g. 3D semi-cartoon premium skincare, glossy, cinematic, high detail]
[SCENE] [scene name/theme + world context]
[CHARACTER] [who appears; for user reference subjects: "Maintain exact design from @imageN"]
[ACTION] [specific physical movement — NEVER "appears" or "showcases"; e.g. "walks carrying a sack of dull dust, laughs mischievously while sprinkling particles"]
[CAMERA] [shot type + movement + feel — e.g. "dynamic medium shot, camera follows character, slight shake for chaos"]
[VO] Voice character type: [type] / Narration: "[exact voiceover text in Indonesian]"
[TEXT OVERLAY] Main text: "[HEADLINE IN CAPS]" / Sub text: "[supporting detail]"
[MOOD] [emotional tone — e.g. playful villain chaos, premium brand-friendly]
[RESTRICTIONS] No [unwanted elements — e.g. blood, horror, subtitles other than overlay above]

Generation mode hints:
- normal: cinematic, clean, premium
- extremely-crazy: wild camera moves, unexpected transitions, surreal elements
- extremely-spicy-or-crazy: maximum chaos, extreme visual creativity, bold colours
- custom: balanced creative freedom

Return ONLY a valid JSON array with exactly ${totalClips} clip objects. No markdown, no explanation.`;

  const userPrompt = `Create a ${totalClips}-clip video storyboard (${duration} seconds total) for this ad:

"${prompt}"

Generation mode: ${mode || 'normal'}

CRITICAL RULES:
1. voScript = EXACTLY 3 long sentences, 35–50 words, Bahasa Indonesia, real TV ad energy. No filler.
2. grokPrompt = use [FORMAT][SCENE][CHARACTER][ACTION][CAMERA][VO][TEXT OVERLAY][MOOD][RESTRICTIONS] template
3. ACTION = specific physical movement (not "appears" or "showcases")
4. VO inside grokPrompt = SAME text as voScript field
${referenceImages.length > 0 ? `5. Use @imageN tags in [CHARACTER] when user reference subjects appear` : ''}

Return JSON array with exactly ${totalClips} objects:
{
  "clipNumber": <number 1-${totalClips}>,
  "visualSummary": "<2-3 sentences in Bahasa Indonesia: opening shot → mid action → closing moment>",
  "voScript": "<EXACTLY 3 long sentences in Bahasa Indonesia, 35-50 words total>",
  "grokPrompt": "<structured English prompt using [FORMAT][SCENE][CHARACTER][ACTION][CAMERA][VO][TEXT OVERLAY][MOOD][RESTRICTIONS]>",
  "technicalConfig": {
    "mainSubject": "<who/what>",
    "action": "<specific movement>",
    "setting": "<where>",
    "lighting": "<lighting type>",
    "visualStyle": "<style>",
    "cameraShot": "<shot type>",
    "additionalDetails": "<extra>"
  }
}`;

  const raw = await chatCompletion({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    maxTokens: 4000,
    temperature: 0.8,
  });

  return parseClipsFromResponse(raw, totalClips);
}

// ── refresh from a specific clip index (keeps previous clips) ────────────────

async function refreshFromIndex({ prompt, mode, existingClips, fromIndex, totalClips, hint, referenceImages = [] }) {
  const clipsToKeep = existingClips.slice(0, fromIndex);
  const clipsToGenerate = totalClips - fromIndex;

  const contextStr = clipsToKeep.length > 0
    ? `\nExisting clips to keep for narrative context (clips 1–${fromIndex}):\n${JSON.stringify(clipsToKeep.map(c => ({
        clipNumber: c.clipNumber,
        visualSummary: c.visualSummary,
        grokPrompt: c.grokPrompt,
      })), null, 2)}\n`
    : '';

  const hintStr = hint ? `\nUser direction for this section: "${hint}"` : '';

  const refImagesContext = referenceImages.length > 0
    ? `\nReference images: ${referenceImages.map(r => `${r.tag} = "${r.label}"`).join(', ')}\nUse @imageN tags in [CHARACTER] when those subjects appear.\n`
    : '';

  const systemPrompt = `You are an expert AI video director creating a continuation of an existing video storyboard.
Generate new clips that follow the narrative of the preceding clips.
Each clip is independently generated — visually self-contained. Same template rules apply.
${refImagesContext}
VOICEOVER: EXACTLY 3 long sentences in Bahasa Indonesia, 35–50 words total. Real TV ad energy. No filler.
VISUAL SUMMARY: 2-3 sentences, opening shot → mid action → closing moment.
GROKPROMPT: [FORMAT][SCENE][CHARACTER][ACTION][CAMERA][VO][TEXT OVERLAY][MOOD][RESTRICTIONS] template. ACTION must be specific movement.

Return ONLY a valid JSON array. No markdown, no explanation.`;

  const userPrompt = `Continue this ${totalClips * 10}s ad storyboard.
Original prompt: "${prompt}"
Mode: ${mode || 'normal'}
${contextStr}${hintStr}

Generate ${clipsToGenerate} new clip(s) starting from clip ${fromIndex + 1} to ${totalClips}.

CRITICAL: voScript = EXACTLY 3 sentences, 35–50 words. grokPrompt uses full template. ACTION must be specific physical movement.

Return JSON array with exactly ${clipsToGenerate} objects (clipNumber starts at ${fromIndex + 1}):
{
  "clipNumber": <number>,
  "visualSummary": "<2-3 sentences Bahasa Indonesia: opening → mid → closing>",
  "voScript": "<EXACTLY 3 long sentences Bahasa Indonesia, 35-50 words>",
  "grokPrompt": "<structured English prompt>",
  "technicalConfig": {
    "mainSubject": "", "action": "", "setting": "",
    "lighting": "", "visualStyle": "", "cameraShot": "", "additionalDetails": ""
  }
}`;

  const raw = await chatCompletion({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    maxTokens: 4000,
    temperature: 0.8,
  });

  const newClips = parseClipsFromResponse(raw, clipsToGenerate, fromIndex + 1);
  return [...clipsToKeep, ...newClips];
}

// ── parse helper ──────────────────────────────────────────────────────────────

function parseClipsFromResponse(raw, expectedCount, startNumber = 1) {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('GPT-4o returned invalid storyboard: no JSON array found');

  let clips;
  try {
    clips = JSON.parse(match[0]);
  } catch (e) {
    throw new Error(`GPT-4o storyboard JSON parse error: ${e.message}`);
  }

  if (!Array.isArray(clips)) throw new Error('GPT-4o storyboard: expected JSON array');
  if (clips.length !== expectedCount) {
    throw new Error(`GPT-4o storyboard: expected ${expectedCount} clips, got ${clips.length}`);
  }

  return clips.map((c, i) => {
    const clipNumber = startNumber + i;
    if (!c.grokPrompt || typeof c.grokPrompt !== 'string') {
      throw new Error(`Clip ${clipNumber} missing grokPrompt`);
    }
    return {
      clipNumber,
      visualSummary: c.visualSummary || `Clip ${clipNumber}`,
      voScript: c.voScript || '',
      grokPrompt: c.grokPrompt.trim(),
      sceneImageUrl: null, // filled later by sceneImageService
      technicalConfig: {
        mainSubject: c.technicalConfig?.mainSubject || '',
        action: c.technicalConfig?.action || '',
        setting: c.technicalConfig?.setting || '',
        lighting: c.technicalConfig?.lighting || 'Natural Daylight',
        visualStyle: c.technicalConfig?.visualStyle || 'Cinematic',
        cameraShot: c.technicalConfig?.cameraShot || 'Medium Shot',
        additionalDetails: c.technicalConfig?.additionalDetails || '',
      },
    };
  });
}

module.exports = { buildStoryboard, refreshFromIndex };
