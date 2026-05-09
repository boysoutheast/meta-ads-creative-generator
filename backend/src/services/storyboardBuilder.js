/**
 * storyboardBuilder.js
 *
 * Generates a JSON-first storyboard for Grok video generation via GPT-4o.
 *
 * ARCHITECTURE
 * ─────────────
 * Each clip is a structured JSON object. The `grokPrompt` string is COMPILED
 * from the JSON fields — not written freehand. This mirrors GeminiGen's own
 * Advanced Prompt UI (mainSubject / action / setting / lighting / visualStyle /
 * cameraShot), which their "Show JSON" button exposes as a structured object.
 *
 * FIELD HIERARCHY
 * ─────────────────
 * ALWAYS PRESENT (core — matches GeminiGen Advanced UI fields):
 *   mainSubject   — primary subject (person, character, product, scene)
 *   action        — specific physical movement (never "appears"/"showcases")
 *   setting       — environment/location description
 *   lighting      — lighting type + color temperature
 *   visualStyle   — render/animation style
 *   cameraShot    — shot type + movement
 *
 * ALWAYS PRESENT (mandatory audio dimension):
 *   audioDimension  — { voiceType, voScript, soundDesign, ambientSounds }
 *   textOverlay     — { main, sub } — headline + tagline shown in video
 *   colorPalette    — specific colors for primary/secondary/accent/bg
 *   restrictions    — explicit list of what NOT to generate
 *
 * CONDITIONAL (only generated if brief mentions relevant subjects):
 *   world         — if environment/world/setting is described in detail
 *   character     — if a named character appears (design specs + @imageN)
 *   product       — if a specific product appears (container/label/content)
 *   sceneFlow     — 3-beat breakdown (always useful, especially for ads)
 *   effects       — if visual effects (glow, particles) are relevant
 *
 * AUDIO DIMENSION — voType controls how [VO]/[AUDIO] section is compiled:
 *   narration     — CTA: 5 connected benefit sentences, professional narrator
 *   dialogue      — Character speaks directly with accent/personality
 *   asmr          — No VO: pure textural sound design description
 *   demo          — Step-by-step instructional narration
 *   story         — Emotional narrative arc storytelling
 *
 * COMPILED grokPrompt = ordered sections built from the JSON fields above
 */

const { chatCompletion } = require('./apimart');

const MODEL = process.env.VISION_MODEL || 'gpt-4o';

// ── aspect ratio labels ───────────────────────────────────────────────────────
const ASPECT_RATIO_LABELS = {
  portrait:   '9:16',
  landscape:  '16:9',
  square:     '1:1',
  vertical:   '2:3',
  horizontal: '3:2',
};

// ── visual style presets ──────────────────────────────────────────────────────
const VISUAL_STYLE_PRESETS = {
  // Original 5
  premium_3d:     '3D semi-cartoon premium product ad, glossy surfaces, cinematic volumetric lighting, ultra-detailed render, smooth fluid animation',
  realistic:      'photorealistic live-action cinematic, natural lighting, shot on RED camera, shallow depth of field, 4K detail, film grain',
  anime:          'Japanese anime style, vibrant saturated colors, sharp expressive outlines, dynamic action lines, hand-drawn feel',
  cinematic:      'cinematic live-action commercial, anamorphic lens flare, golden hour color grade, Dolby Vision HDR, movie-quality production',
  cartoon:        '3D Pixar-style cartoon, bright cheerful colors, smooth rounded shapes, exaggerated expressions, family-friendly fun',
  // 5 new styles (Zopia-inspired)
  ghibli:         'Studio Ghibli animation style, hand-painted watercolor backgrounds, warm soft light, lush detailed nature, expressive wide-eyed characters, storybook magic',
  makoto_shinkai: 'Makoto Shinkai film aesthetic, hyperdetailed city backgrounds, chromatic lens flare, golden hour rays, hazy bokeh atmosphere, emotional color grading',
  chibi:          'Chibi anime style, super-deformed proportions, cute oversized heads, pastel color palette, big sparkly eyes, soft rounded shapes, kawaii energy',
  pixel_art:      'Retro pixel art style, 16-bit aesthetic, limited color palette, chunky detailed sprites, nostalgic game aesthetic, crisp pixel edges',
  chinese_cg:     '3D Chinese animation style (Donghua), wuxia aesthetic, ink wash mountain backgrounds, dramatic silk fabric physics, jade and gold accents, epic cinematic lighting',
};

const DEFAULT_VISUAL_STYLE = VISUAL_STYLE_PRESETS.premium_3d;

// ── project type instructions ─────────────────────────────────────────────────
/**
 * Returns system prompt addendum based on project type.
 * projectType: 'story' | 'product_promo' | 'digital_human' | 'default'
 */
function getProjectTypeRules(projectType) {
  switch (projectType) {
    case 'product_promo':
      return `
PROJECT TYPE: PRODUCT PROMO (commercial ad)
CRITICAL RULES for product_promo:
- EVERY clip MUST prominently feature the product — product appearance is FIXED, never alter
- Clip 1 (Hook): eye-catching product reveal or problem statement
- Middle clips: product features, benefits, texture/use demonstration
- Last clip: strong CTA (Call to Action) + brand name + product close-up
- Action: always show the product DOING something — dripping, rotating, being applied, being held
- Setting: always product-centric — beauty flat-lay, studio hero shot, lifestyle in-use`;

    case 'story':
      return `
PROJECT TYPE: STORY VIDEO (narrative film)
CRITICAL RULES for story_video:
- Build a clear narrative arc: Setup → Rising tension → Climax → Resolution across clips
- Characters must have personality — name them, give them clear motivation
- Clip 1: establish the world and main character, hook viewer emotionally
- Middle clips: develop the conflict or journey
- Last clip: emotional resolution + brand/product appears naturally as part of the story
- Prioritize emotional beats over direct product promotion`;

    case 'digital_human':
      return `
PROJECT TYPE: DIGITAL HUMAN AD (presenter showcase)
CRITICAL RULES for digital_human:
- Every clip MUST include an AI presenter/avatar character speaking to camera
- Presenter style: professional, approachable, relatable — like a real person
- Presenter MUST be consistent: same face, outfit, background across all clips
- Clip 1: Presenter introduces themselves and the product/topic with energy
- Middle clips: Presenter demonstrates or explains features (talking head + product shots)
- Last clip: Presenter delivers CTA directly to camera with confident smile
- character field REQUIRED in every clip — describe the presenter design in detail`;

    default:
      return `
PROJECT TYPE: GENERAL (default)
Create a balanced, premium ad video — engaging visuals, clear messaging, brand consistent.`;
  }
}

// ── output language map ───────────────────────────────────────────────────────
const OUTPUT_LANGUAGE_NAMES = {
  id: 'Bahasa Indonesia',
  en: 'English',
  th: 'Thai (ภาษาไทย)',
  vi: 'Vietnamese (Tiếng Việt)',
  zh: 'Mandarin Chinese (普通话)',
  hi: 'Hindi (हिन्दी)',
  es: 'Spanish (Español)',
  pt: 'Portuguese (Português)',
  ar: 'Arabic (العربية)',
  ko: 'Korean (한국어)',
  ja: 'Japanese (日本語)',
};

// ── Audio dimension rules by voType + clip duration ──────────────────────────
/**
 * Returns rules + JSON spec for the audio dimension block.
 * voType: 'narration' | 'dialogue' | 'asmr' | 'demo' | 'story'
 */
function getAudioRules(voType, clipDuration) {
  const type = voType || 'narration';

  // Speaking pace: ~130-150 WPM — sentence counts by duration
  const sentences = clipDuration <= 6 ? 3 : clipDuration <= 10 ? 5 : 7;
  const wordRange = clipDuration <= 6 ? '18–28' : clipDuration <= 10 ? '38–52' : '60–80';

  switch (type) {

    case 'asmr':
      return {
        type: 'asmr',
        sentenceCount: null,
        wordRange: null,
        rules: `AUDIO DIMENSION — ASMR Mode (${clipDuration}s):
- NO voiceover narration — pure sound design experience
- soundDesign: describe EVERY physical sound in precise ASMR detail
  Examples: "soft wet pop as cream lid opens", "slow scraping of spatula on glass", "muffled crunching of ice", "liquid dripping into bowl with echoing drip"
- Sequence sounds: list what happens in order across the clip timeline
- ambientSounds: gentle background (silence, soft ambient music, rain, distant birds)
- NEVER generic — be specific about texture, speed, intensity of each sound`,
        spec: `"voScript": null,
  "audioDimension": {
    "voiceType": null,
    "voScript": null,
    "soundDesign": "<ASMR: list each physical sound in order — texture, speed, intensity: e.g. 'slow lid pop, cream scraping, soft drip'>",
    "ambientSounds": "<background: silence / soft lo-fi / rain / gentle nature — pick one>"
  }`,
      };

    case 'dialogue':
      return {
        type: 'dialogue',
        sentenceCount: sentences,
        wordRange,
        rules: `AUDIO DIMENSION — Character Dialogue Mode (${clipDuration}s):
- Character speaks directly in ${sentences} natural conversational lines (${wordRange} words total)
- voiceType: MUST name the character + accent + personality trait
  Example: "Kapten Tara, confident Indonesian female, warm & energetic" or "Monkey mascot, Jamaican accent, casual & funny"
- voScript: authentic character speech — NOT narrator text. Character talks to viewer directly
- Conversational, personality-driven — the character's VOICE must be felt
- ambientSounds: environment sounds behind the character (ship hum, crowd, ocean waves, city noise)`,
        spec: `"voScript": "<character's dialogue — ${sentences} conversational lines, ${wordRange} words, Bahasa Indonesia>",
  "audioDimension": {
    "voiceType": "<character name + accent + personality — e.g. 'Kapten Tara, Indonesian female, confident & warm'>",
    "voScript": "<same dialogue as voScript above>",
    "soundDesign": null,
    "ambientSounds": "<environment audio: ship hum / crowd noise / ocean waves / city ambiance — be specific>"
  }`,
      };

    case 'demo':
      return {
        type: 'demo',
        sentenceCount: sentences,
        wordRange,
        rules: `AUDIO DIMENSION — Demo/Tutorial Mode (${clipDuration}s):
- EXACTLY ${sentences} clear instructional sentences (${wordRange} words total)
- Step-by-step educational narration: "First... → Then... → After that... → You'll notice... → Result..."
- voiceType: expert educator, clear and approachable — like a trusted beauty advisor
- Each sentence = one actionable step or observable result
- ambientSounds: clean product sounds, soft ambient music`,
        spec: `"voScript": "<${sentences} instructional steps in sequence, ${wordRange} words, Bahasa Indonesia>",
  "audioDimension": {
    "voiceType": "<expert educator voice — e.g. 'beauty advisor, clear & knowledgeable, approachable tone'>",
    "voScript": "<same as voScript above>",
    "soundDesign": null,
    "ambientSounds": "<soft background music + optional product sounds (click, squeeze, apply)>"
  }`,
      };

    case 'story':
      return {
        type: 'story',
        sentenceCount: sentences,
        wordRange,
        rules: `AUDIO DIMENSION — Story/Emotional Mode (${clipDuration}s):
- EXACTLY ${sentences} emotionally connected sentences (${wordRange} words total)
- Narrative arc: setup → tension/longing → turning point → transformation → emotional close
- voiceType: warm, intimate storytelling voice — like confiding in a close friend
- Sentences should evoke emotion and connection — sell through story, not direct CTA
- ambientSounds: cinematic ambient that mirrors the emotional arc`,
        spec: `"voScript": "<${sentences} story sentences with emotional arc, ${wordRange} words, Bahasa Indonesia>",
  "audioDimension": {
    "voiceType": "<warm intimate storytelling voice — e.g. 'gentle Indonesian female, confessional & relatable'>",
    "voScript": "<same as voScript above>",
    "soundDesign": null,
    "ambientSounds": "<cinematic ambient: soft strings / rain / heartbeat / crowd fading to silence — match story mood>"
  }`,
      };

    default: // 'narration' (CTA default)
      return {
        type: 'narration',
        sentenceCount: sentences,
        wordRange,
        rules: `AUDIO DIMENSION — CTA Narration Mode (${clipDuration}s):
- EXACTLY ${sentences} connected sentences in Bahasa Indonesia (${wordRange} words total)
- Story beats: hook → problem → solution → proof → CTA
- Sentences must FLOW into each other — one connected narration, not ${sentences} separate points
- voiceType: professional narrator — warm, persuasive, confident
- Example (10s): "Di balik tampilan wajah kusam, ada potensi kulit cerah yang menunggu. Rutinitas malam yang tepat bisa jadi jawabannya. Melastop Night Cream dengan Niacinamide 11% bekerja aktif saat kamu tidur. Mencerahkan tampilan dan meratakan warna kulit secara perlahan. Bangun dengan rasa percaya diri — wajah lebih cerah dari hari pertama."`,
        spec: `"voScript": "<EXACTLY ${sentences} connected sentences, ${wordRange} words total, flowing Bahasa Indonesia narration>",
  "audioDimension": {
    "voiceType": "<narrator personality — e.g. 'warm professional Indonesian narrator, confident & persuasive'>",
    "voScript": "<same as voScript above>",
    "soundDesign": null,
    "ambientSounds": "<optional: soft background music type — e.g. 'gentle uplifting instrumental'>"
  }`,
      };
  }
}

// ── prompt compiler: JSON fields → grokPrompt string ─────────────────────────
function compileGrokPrompt(fields, arLabel, clipDuration, voType) {
  const type = voType || 'narration';
  const parts = [];

  // [FORMAT] — always first
  parts.push(`[FORMAT] ${arLabel}, ${clipDuration}s, ${fields.visualStyle || '3D semi-cartoon premium skincare, glossy, cinematic, high detail'}`);

  // [REFERENCES] — if reference images exist, list them so GeminiGen knows what @imageN maps to
  if (fields.referenceImages && fields.referenceImages.length > 0) {
    const refList = fields.referenceImages.map(r => `${r.tag}="${r.label}" (${classifyRefImage(r)})`).join(', ');
    parts.push(`\n[REFERENCES] ${refList} — maintain EXACT visual design from these images in every frame`);
  }

  // [WORLD] — conditional: only if world/environment is richly described
  if (fields.world) {
    parts.push(`\n[WORLD] ${fields.world}`);
  }

  // [CHARACTER] — conditional: only if named character in this clip
  if (fields.character) {
    parts.push(`\n[CHARACTER] ${fields.character}`);
  }

  // [PRODUCT] — conditional: only if product appears in this clip
  if (fields.product) {
    parts.push(`\n[PRODUCT] ${fields.product}`);
  }

  // [SCENE] — always: setting + mainSubject
  parts.push(`\n[SCENE] ${fields.setting || 'a clean studio environment'}`);

  // [SCENE_FLOW] — conditional: 3-beat breakdown (always useful for ads)
  if (fields.sceneFlow) {
    parts.push(`\n[SCENE_FLOW]\n${fields.sceneFlow}`);
  }

  // [ACTION] — always: specific physical movement
  parts.push(`\n[ACTION] ${fields.action || 'moves confidently through the scene'}`);

  // [EFFECTS] — conditional: only if glow/particles/effects described
  if (fields.effects) {
    parts.push(`\n[EFFECTS] ${fields.effects}`);
  }

  // [CAMERA] — always
  parts.push(`\n[CAMERA] ${fields.cameraShot || 'medium shot, slow push-in, cinematic'}`);

  // ── AUDIO DIMENSION — varies by voType ──────────────────────────────────────
  const ad = fields.audioDimension || {};
  const voiceType = ad.voiceType || fields.voiceOver?.characterType || '';
  const voScript  = ad.voScript  || fields.voiceOver?.text || '';
  const soundDesign   = ad.soundDesign   || '';
  const ambientSounds = ad.ambientSounds || '';

  if (type === 'asmr') {
    // ASMR: no narration — pure sound design
    parts.push(`\n[AUDIO] ASMR Sound Design: ${soundDesign || 'tactile product sounds, textural audio'}`);
    if (ambientSounds) parts.push(` / Ambient: ${ambientSounds}`);
    parts.push(` / NO voiceover narration`);
  } else if (type === 'dialogue') {
    // Dialogue: character speaks directly
    parts.push(`\n[AUDIO] Character: ${voiceType || 'character voice'} speaks`);
    if (voScript) parts.push(` / Dialogue: "${voScript}"`);
    if (ambientSounds) parts.push(` / Ambient: ${ambientSounds}`);
  } else {
    // narration / demo / story: professional narration
    const label = type === 'demo' ? 'Tutorial' : type === 'story' ? 'Story' : 'Narration';
    parts.push(`\n[VO] Voice: ${voiceType || 'professional narrator'} / ${label}: "${voScript}"`);
    if (ambientSounds) parts.push(` / Ambient: ${ambientSounds}`);
  }

  // [TEXT_OVERLAY] — always
  parts.push(`\n[TEXT_OVERLAY] Main: "${fields.textOverlay?.main || 'DISCOVER MORE'}" / Sub: "${fields.textOverlay?.sub || ''}" / Style: clean bold font, premium placement, legible`);

  // [COLOR_PALETTE] — always
  if (fields.colorPalette) {
    parts.push(`\n[COLOR_PALETTE] ${fields.colorPalette}`);
  }

  // [STYLE] — always
  parts.push(`\n[STYLE] ${fields.visualStyle || '3D semi-cartoon premium skincare'}; cinematic volumetric lighting; smooth fluid animation; ultra-detailed render; glossy surfaces`);

  // [RESTRICTIONS] — always
  parts.push(`\n[RESTRICTIONS] ${fields.restrictions || 'No gore, no horror, no realistic medical visuals, no subtitles except TEXT_OVERLAY above'}`);

  return parts.join('');
}

// ── brief analysis: detect what conditional sections to include ───────────────
const CHARACTER_LABEL_RE = /karakter|character|maskot|mascot|person|tokoh|hero|talent|model|artis/i;
const PRODUCT_LABEL_RE   = /produk|product|cream|serum|lotion|bottle|jar|packaging|skincare|sabun|toner|moisturizer|brand|logo/i;

/**
 * Classify a reference image's role.
 * - If label explicitly matches character keywords → 'character'
 * - If label explicitly matches product keywords → 'product'
 * - Default: treat as 'product' (most common use-case — brand/packaging shot)
 */
function classifyRefImage(r) {
  const l = r.label.toLowerCase();
  if (CHARACTER_LABEL_RE.test(l)) return 'character';
  if (PRODUCT_LABEL_RE.test(l))   return 'product';
  return 'product'; // fallback: unknown label → assume product reference
}

function buildConditionalContext(prompt, referenceImages) {
  const lower = prompt.toLowerCase();
  const hasCharacter = /karakter|character|maskot|mascot|kapten|figure|tokoh|hero|villain|persona/.test(lower);
  const hasProduct = /produk|product|cream|serum|lotion|bottle|jar|packaging|skincare|sabun|toner|moisturizer/.test(lower);
  const hasWorld = /kota|city|world|dunia|realm|kingdom|scene|environment|landscape|alam|studio/.test(lower);
  const hasEffects = /glow|cahaya|sparkle|particles|partikel|magic|aura|glitter|shimmer|energi|effect|efek/.test(lower);

  // Classify all reference images — anything not explicitly a character defaults to product
  const hasCharacterRef = referenceImages.some(r => classifyRefImage(r) === 'character');
  const hasProductRef   = referenceImages.some(r => classifyRefImage(r) === 'product');

  return {
    needsCharacter: hasCharacter || hasCharacterRef,
    // needsProduct: true if brief mentions a product OR if ANY non-character reference image exists
    needsProduct:   hasProduct || hasProductRef || (referenceImages.length > 0 && !hasCharacterRef),
    needsWorld: hasWorld,
    needsEffects: hasEffects,
    needsSceneFlow: true, // always useful for 10s ad clips
  };
}

// ── JSON schema for GPT-4o to fill ───────────────────────────────────────────
function buildClipSchema(arLabel, clipDuration, flags, referenceImages, audioRules, totalClips) {
  const conditionalFields = [];

  if (flags.needsWorld) {
    conditionalFields.push(`    "world": "<detailed environment: location name, atmosphere, ambient colors, background elements, particle effects, surface textures>"`);
  }

  if (flags.needsCharacter) {
    // Use character-classified images, fall back to ALL images if none match
    const charRefs = referenceImages.filter(r => classifyRefImage(r) === 'character');
    const refTags = (charRefs.length > 0 ? charRefs : referenceImages).map(r => r.tag).join(', ') || '@image1';
    conditionalFields.push(`    "character": "<character name> — exact design: outfit colors/material, accessories, distinguishing features; Maintain EXACT design from ${refTags} — DO NOT alter outfit/face/accessories; Frozen: never change [list specific features]"`);
  }

  if (flags.needsProduct) {
    // Use product-classified images, fall back to ALL images if none specifically match
    const prodRefs = referenceImages.filter(r => classifyRefImage(r) === 'product');
    const refTags = (prodRefs.length > 0 ? prodRefs : referenceImages).map(r => r.tag).join(', ') || '@image1';
    conditionalFields.push(`    "product": "<product name> — Describe ONLY what you see in ${refTags}; Container: [color, material, finish from image]; Label: [exact text/logo from image]; Content: [color/texture if visible]; MUST reference ${refTags} — Frozen: keep EXACT colors and label from image, never alter"`);
  }

  if (flags.needsSceneFlow) {
    const beat1 = Math.round(clipDuration * 0.3);
    const beat2 = Math.round(clipDuration * 0.75);
    conditionalFields.push(`    "sceneFlow": "• Opening (0–${beat1}s): [what viewer sees first]\\n• Mid (${beat1}–${beat2}s): [main action + highlight moment]\\n• Close (${beat2}–${clipDuration}s): [final beat, product/emotion payoff]"`);
  }

  if (flags.needsEffects) {
    conditionalFields.push(`    "effects": "<glow: color(s), spread radius, intensity>; <particles: type, color, movement direction>; <environment reaction: what changes in the world>; <shimmer/sparkle details>"`);
  }

  const conditionalStr = conditionalFields.length > 0
    ? '\n' + conditionalFields.join(',\n') + ','
    : '';

  return `{
  "clipNumber": <1–${totalClips}>,
  "visualSummary": "<2-3 sentences Bahasa Indonesia: opening shot → main action → closing moment>",
  ${audioRules.spec},
  "fields": {
    "mainSubject": "<primary subject — who or what is the focus of this clip>",
    "action": "<specific physical movement — Enter: [X], Mid: [Y], Peak: [Z] — NEVER 'appears'/'showcases'>",
    "setting": "<environment + location with visual atmosphere details>",
    "lighting": "<lighting type, color temperature, direction — e.g. 'soft rim lighting, warm gold tones, backlighting from window'>",
    "visualStyle": "<exact render + animation style — e.g. '3D semi-cartoon premium skincare, glossy surfaces, cinematic'>",
    "cameraShot": "<shot progression: opening shot → camera movement → closing frame — e.g. 'wide establishing → slow push-in → medium close on product'>",${conditionalStr}
    "textOverlay": {
      "main": "<HEADLINE IN ALL CAPS — max 4 words, no typos>",
      "sub": "<supporting tagline in sentence case — no typos>"
    },
    "colorPalette": "Primary: [dominant color]; Secondary: [supporting]; Accent: [glow/highlight]; BG: [background tone]",
    "restrictions": "No gore, no horror, no realistic medical; No subtitles except TEXT_OVERLAY; <character freeze rules if applicable>; <product freeze rules if applicable>"
  }
}`;
}

// ── build full storyboard from scratch ───────────────────────────────────────

async function buildStoryboard({ prompt, mode, duration, referenceImages = [], aspectRatio = 'portrait', clipDuration = 10, voType = 'narration', visualStyle = 'premium_3d', scriptText = null, projectType = 'default', outputLanguage = 'id' }) {
  const totalClips = Math.ceil(duration / clipDuration);
  const arLabel = ASPECT_RATIO_LABELS[aspectRatio] || '9:16';
  const audio = getAudioRules(voType, clipDuration);
  const styleDesc = VISUAL_STYLE_PRESETS[visualStyle] || DEFAULT_VISUAL_STYLE;
  const projectRules = getProjectTypeRules(projectType);
  const langName = OUTPUT_LANGUAGE_NAMES[outputLanguage] || 'Bahasa Indonesia';
  // When scriptText is provided, also use it as the brief context for conditional detection
  const contextForDetection = scriptText ? `${prompt}\n${scriptText}` : prompt;
  const flags = buildConditionalContext(contextForDetection, referenceImages);

  // Reference images context — classify each image and build enforcement rules
  let refCtx = '';
  if (referenceImages.length > 0) {
    const classified = referenceImages.map(r => ({
      ...r,
      role: classifyRefImage(r),
    }));
    const productRefs  = classified.filter(r => r.role === 'product');
    const characterRefs = classified.filter(r => r.role === 'character');

    refCtx = `
⚠️ REFERENCE IMAGES — CRITICAL ENFORCEMENT (${referenceImages.length} uploaded):
${classified.map(r => `  ${r.tag} = "${r.label}" [${r.role.toUpperCase()} reference]`).join('\n')}
${productRefs.length > 0 ? `
PRODUCT REFERENCE (${productRefs.map(r => r.tag).join(', ')}):
- The product's visual design comes EXCLUSIVELY from these images
- EVERY clip's "product" field MUST include "${productRefs.map(r => r.tag).join(', ')}"
- DO NOT invent product colors, labels, or packaging — describe ONLY what is in the image
- Frozen: product appearance must stay 100% identical across ALL clips` : ''}
${characterRefs.length > 0 ? `
CHARACTER REFERENCE (${characterRefs.map(r => r.tag).join(', ')}):
- Character design comes EXCLUSIVELY from these images
- EVERY clip's "character" field MUST include "${characterRefs.map(r => r.tag).join(', ')}"
- DO NOT alter outfit, face, accessories from what is shown` : ''}
- Include "${classified.map(r => r.tag).join(', ')}" in the restrictions field of EVERY clip as freeze rules
`;
  }

  const clipSchema = buildClipSchema(arLabel, clipDuration, flags, referenceImages, audio, totalClips);

  const voSentenceNote = audio.sentenceCount
    ? `- audioDimension.voScript: MUST be ${audio.sentenceCount} connected sentences in ${langName} that flow as one ${audio.type === 'dialogue' ? 'character speech' : 'narration'}`
    : `- soundDesign: be ASMR-specific — list every physical sound in sequence`;

  const systemPrompt = `You are a world-class AI video director and ad copywriter creating premium video content.

You generate STRUCTURED JSON storyboards for Grok AI video generation.
Each clip is a JSON object with structured fields that mirror GeminiGen's Advanced Prompt UI.
The grokPrompt is compiled automatically from these fields — you just fill the JSON precisely.

MISSION: Produce ad-agency quality briefs. Every field must be film-director specific — not vague, not generic.

FORMAT CONTEXT:
- ${clipDuration}s per clip, ${arLabel} aspect ratio, ${mode || 'normal'} generation mode
- Clips are independently generated (no chaining) — each must be visually self-contained
- All voScript/audioDimension text in ${langName}; all other fields in English
- VISUAL STYLE (apply to every clip): ${styleDesc}
${projectRules}
${refCtx}
${audio.rules}

CORE FIELD QUALITY STANDARDS:
- mainSubject: name the subject precisely (not "a character" — use their actual name or description)
- action: MUST have Enter/Mid/Peak sub-beats. NEVER write "appears", "showcases", "presents"
- setting: name the location + describe its visual atmosphere in 1-2 sentences
- lighting: be specific — color temperature, direction, source type
- visualStyle: MUST match the preset style: "${styleDesc}" — keep this consistent across ALL clips
- cameraShot: describe the full progression — opening frame → movement → closing frame
${voSentenceNote}
- textOverlay: real ad copy — punchy, no typos, brand-relevant
- colorPalette: name actual colors (e.g. "deep lilac", "warm peach", "silver-white shimmer")
- restrictions: always freeze character + product designs if they exist in the brief

CONDITIONAL FIELDS (include ONLY if relevant to brief):
${flags.needsWorld ? '✓ world — environment IS mentioned in this brief' : '✗ world — omit if environment not central'}
${flags.needsCharacter ? '✓ character — named character IS present' : '✗ character — omit if no specific character'}
${flags.needsProduct ? '✓ product — product IS mentioned' : '✗ product — omit if no specific product'}
${flags.needsSceneFlow ? '✓ sceneFlow — include 3-beat progression for every ad clip' : ''}
${flags.needsEffects ? '✓ effects — visual effects ARE mentioned in this brief' : '✗ effects — omit if no special effects'}

GENERATION MODE STYLE:
- normal: cinematic, clean, premium brand
- extremely-crazy: wild camera, surreal transitions, chaotic energy
- extremely-spicy-or-crazy: max chaos, bold colors, hyper-creative
- custom: balanced creative freedom

Return ONLY a valid JSON array with exactly ${totalClips} clip objects. No markdown, no text outside JSON.`;

  // Script mode: adapt existing script text into clips instead of generating from scratch
  const userPrompt = scriptText
    ? `You have an existing ad script to adapt into a ${totalClips}-clip video storyboard.

BRAND BRIEF: "${prompt}"

EXISTING AD SCRIPT:
"""
${scriptText}
"""

Your job: Break this script into exactly ${totalClips} clips of ${clipDuration}s each.
- Divide the script text evenly across clips — each clip gets its own section of copy
- The voScript per clip = the dialogue/narration for THAT clip's time slot
- Visual scenes must match and amplify what the script copy says
- Mode: ${mode || 'normal'} | Format: ${arLabel} | Audio: ${audio.type.toUpperCase()}

MANDATORY RULES:
1. voScript per clip = the EXACT portion of the script for that clip's ${clipDuration}s slot
2. Each clip must be visually self-contained — no "continued from previous"
3. action = Enter/Mid/Peak sub-beats only — NEVER "appears"/"showcases"
4. ONLY include conditional fields if relevant to the brief

Return JSON array of exactly ${totalClips} objects:
${clipSchema}`
    : `Create a ${totalClips}-clip premium ad storyboard for:

"${prompt}"

Mode: ${mode || 'normal'} | Format: ${arLabel} | ${clipDuration}s per clip | Total: ${duration}s | Audio: ${audio.type.toUpperCase()} | Style: ${visualStyle}

MANDATORY RULES:
1. Audio type = ${audio.type.toUpperCase()} — follow the audio dimension rules exactly
2. action = Enter/Mid/Peak sub-beats, specific physical movements only
3. ONLY include conditional fields (world/character/product/effects) if relevant to this brief
${audio.sentenceCount ? `4. All ${audio.sentenceCount} sentences must build a CONNECTED arc — not ${audio.sentenceCount} separate ideas` : '4. soundDesign = list every ASMR sound in sequence — specific textures, no generic descriptions'}

Return JSON array of exactly ${totalClips} objects with this structure per clip:
${clipSchema}`;

  const raw = await chatCompletion({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    maxTokens: 6000,
    temperature: 0.8,
  });

  return parseClipsFromResponse(raw, totalClips, 1, arLabel, clipDuration, voType, referenceImages);
}

// ── refresh from a specific clip index ───────────────────────────────────────

async function refreshFromIndex({ prompt, mode, existingClips, fromIndex, totalClips, hint, referenceImages = [], aspectRatio = 'portrait', clipDuration = 10, voType = 'narration', visualStyle = 'premium_3d', projectType = 'default', outputLanguage = 'id' }) {
  const clipsToKeep = existingClips.slice(0, fromIndex);
  const clipsToGenerate = totalClips - fromIndex;
  const arLabel = ASPECT_RATIO_LABELS[aspectRatio] || '9:16';
  const audio = getAudioRules(voType, clipDuration);
  const styleDesc = VISUAL_STYLE_PRESETS[visualStyle] || DEFAULT_VISUAL_STYLE;
  const projectRules = getProjectTypeRules(projectType);
  const langName = OUTPUT_LANGUAGE_NAMES[outputLanguage] || 'Bahasa Indonesia';
  const flags = buildConditionalContext(prompt, referenceImages);

  const contextStr = clipsToKeep.length > 0
    ? `\nPrevious clips (for narrative continuity):\n${JSON.stringify(
        clipsToKeep.map(c => ({
          clipNumber: c.clipNumber,
          visualSummary: c.visualSummary,
          action: c.technicalConfig?.action,
          setting: c.technicalConfig?.setting,
        })), null, 2
      )}\n`
    : '';

  const hintStr = hint ? `\nCreative direction: "${hint}"\n` : '';

  let refCtx = '';
  if (referenceImages.length > 0) {
    const classified = referenceImages.map(r => ({ ...r, role: classifyRefImage(r) }));
    const productRefs = classified.filter(r => r.role === 'product');
    refCtx = `\n⚠️ REFERENCE IMAGES (CRITICAL — use @imageN in every clip):
${classified.map(r => `  ${r.tag} = "${r.label}" [${r.role}]`).join('\n')}
${productRefs.length > 0 ? `EVERY clip's product field MUST reference: ${productRefs.map(r => r.tag).join(', ')}` : ''}
`;
  }

  const clipSchema = buildClipSchema(arLabel, clipDuration, flags, referenceImages, audio, totalClips);

  const systemPrompt = `You are a world-class AI video director continuing an existing ad storyboard.
Generate clips that naturally continue the narrative, maintaining visual and brand consistency.
${clipDuration}s per clip, ${arLabel} aspect ratio, independently generated.
VISUAL STYLE (apply to every clip): ${styleDesc}
All voScript/audioDimension text in ${langName}; all other fields in English.
${projectRules}
${refCtx}
${audio.rules}
Same quality standards: specific actions, detailed settings, proper audio dimension, proper conditional fields only.`;

  const userPrompt = `Continue this ${totalClips * clipDuration}s ad storyboard. Generate clips ${fromIndex + 1}–${totalClips}.

Brief: "${prompt}"
Mode: ${mode || 'normal'} | Audio: ${audio.type.toUpperCase()}
${contextStr}${hintStr}
RULES:
1. Follow ${audio.type.toUpperCase()} audio rules exactly
${audio.sentenceCount ? `2. audioDimension.voScript = EXACTLY ${audio.sentenceCount} connected sentences, ${audio.wordRange} words` : '2. soundDesign = specific ASMR sounds in sequence'}
3. action = Enter/Mid/Peak specific body movements
4. Include conditional fields only if relevant to brief

Return JSON array of exactly ${clipsToGenerate} objects (clipNumber starts at ${fromIndex + 1}):
${clipSchema}`;

  const raw = await chatCompletion({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    maxTokens: 6000,
    temperature: 0.8,
  });

  const newClips = parseClipsFromResponse(raw, clipsToGenerate, fromIndex + 1, arLabel, clipDuration, voType, referenceImages);
  return [...clipsToKeep, ...newClips];
}

// ── parse helper + compile grokPrompt from JSON fields ───────────────────────

function parseClipsFromResponse(raw, expectedCount, startNumber = 1, arLabel = '9:16', clipDuration = 10, voType = 'narration', referenceImages = []) {
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
    const f = c.fields || {};

    if (!f.action && !f.mainSubject) {
      throw new Error(`Clip ${clipNumber} missing required fields`);
    }

    // audioDimension — top-level from GPT-4o response
    const ad = c.audioDimension || {};

    // Derive voScript for display:
    // - ASMR: show sound design summary
    // - others: the narration/dialogue text
    const isAsmr = voType === 'asmr';
    const voScript = isAsmr
      ? (ad.soundDesign ? `[ASMR] ${ad.soundDesign}` : '')
      : (c.voScript || ad.voScript || '');

    // Compile grokPrompt from structured JSON fields
    const grokPrompt = compileGrokPrompt({
      mainSubject:    f.mainSubject    || '',
      action:         f.action         || '',
      setting:        f.setting        || '',
      lighting:       f.lighting       || 'cinematic lighting',
      visualStyle:    f.visualStyle    || '3D semi-cartoon premium skincare, glossy',
      cameraShot:     f.cameraShot     || 'medium shot, slow push-in',
      world:          f.world          || null,
      character:      f.character      || null,
      product:        f.product        || null,
      sceneFlow:      f.sceneFlow      || null,
      effects:        f.effects        || null,
      referenceImages,  // pass through so [REFERENCES] section is compiled
      audioDimension: {
        voiceType:    ad.voiceType    || '',
        voScript:     ad.voScript     || c.voScript || '',
        soundDesign:  ad.soundDesign  || '',
        ambientSounds: ad.ambientSounds || '',
      },
      // legacy fallback so older compileGrokPrompt paths still work
      voiceOver: { characterType: ad.voiceType || '', text: ad.voScript || c.voScript || '' },
      textOverlay:    f.textOverlay    || { main: 'DISCOVER MORE', sub: '' },
      colorPalette:   f.colorPalette   || null,
      restrictions:   f.restrictions   || 'No gore, no horror, no realistic medical visuals',
    }, arLabel, clipDuration, voType);

    return {
      clipNumber,
      visualSummary:  c.visualSummary || `Clip ${clipNumber}`,
      voScript,
      grokPrompt,
      sceneImageUrl:  null,  // filled later by sceneImageService
      technicalConfig: {
        mainSubject:      f.mainSubject      || '',
        characterDesign:  f.character        || '',
        productDesign:    f.product          || '',
        worldBuilding:    f.world            || '',
        sceneFlow:        f.sceneFlow        || '',
        action:           f.action           || '',
        effects:          f.effects          || '',
        colorPalette:     f.colorPalette     || '',
        lighting:         f.lighting         || 'Cinematic',
        visualStyle:      f.visualStyle      || '3D semi-cartoon premium',
        cameraShot:       f.cameraShot       || 'Medium Shot',
        additionalDetails: '',
        // Audio dimension fields
        voType:           voType,
        voiceType:        ad.voiceType       || '',
        soundDesign:      ad.soundDesign     || '',
        ambientSounds:    ad.ambientSounds   || '',
      },
    };
  });
}

// ── A/B Hook Variants generator ───────────────────────────────────────────────
/**
 * Generate 5 alternative hook variations for clip 1 of an ad.
 * Each hook has a different psychological angle.
 *
 * @param {object} params
 * @param {string} params.brief - The original ad brief
 * @param {string} params.projectType - 'story' | 'product_promo' | 'digital_human' | 'default'
 * @param {string} params.voType - VO type for the hook
 * @param {string} params.outputLanguage - Language code e.g. 'id', 'en'
 * @param {string} params.visualStyle - visual style preset key
 * @param {number} params.clipDuration - seconds per clip
 * @returns {Promise<Array<{ type, label, voScript, opening, angle }>>}
 */
async function generateHookVariants({ brief, projectType = 'default', voType = 'narration', outputLanguage = 'id', visualStyle = 'premium_3d', clipDuration = 10 }) {
  const langName = OUTPUT_LANGUAGE_NAMES[outputLanguage] || 'Bahasa Indonesia';
  const audio = getAudioRules(voType, clipDuration);
  const sentences = audio.sentenceCount || 3;
  const wordRange = audio.wordRange || '38–52';

  const systemPrompt = `You are a world-class ad copywriter and video director specializing in viral social media hooks.
Generate 5 distinctly different opening hooks for the first clip of an ad video.
Each hook uses a different psychological angle to capture attention in the first 3 seconds.
All VO scripts must be in ${langName}.`;

  const userPrompt = `Ad Brief: "${brief}"
Project Type: ${projectType}
VO Style: ${voType}
Clip Duration: ${clipDuration}s (hook must fill exactly ${sentences} sentences, ${wordRange} words)

Generate exactly 5 hook variants. Each must be fundamentally different in approach.

Required hook types:
1. PROBLEM HOOK: Opens with the audience's pain point ("Capek dengan...?" / "Tired of...?")
2. CURIOSITY HOOK: Opens with a surprising claim or unexpected fact
3. SOCIAL_PROOF HOOK: Opens with results, numbers, or testimonial angle ("Ribuan orang sudah..." / "10,000 people...")
4. DIRECT HOOK: Opens by immediately naming the product/benefit (no lead-up)
5. EMOTIONAL HOOK: Opens with a relatable emotional moment or story beat

Return ONLY valid JSON array with exactly 5 objects:
[
  {
    "type": "problem",
    "label": "Problem Hook",
    "voScript": "<${sentences} connected sentences in ${langName}, ${wordRange} words — hook must be the opening ${clipDuration}s of a full ad>",
    "opening": "<first 8-10 words only — the actual opening line>",
    "angle": "<1 sentence describing the psychological angle used>"
  },
  ... (5 total)
]`;

  const raw = await chatCompletion({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    maxTokens: 1500,
    temperature: 0.9,
  });

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Failed to generate hook variants: no JSON array found');

  try {
    const hooks = JSON.parse(match[0]);
    if (!Array.isArray(hooks) || hooks.length === 0) throw new Error('Empty hooks array');
    return hooks;
  } catch (e) {
    throw new Error(`Hook variant parsing failed: ${e.message}`);
  }
}

module.exports = { buildStoryboard, refreshFromIndex, generateHookVariants };
