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
function buildConditionalContext(prompt, referenceImages) {
  const lower = prompt.toLowerCase();
  const hasCharacter = /karakter|character|maskot|mascot|kapten|figure|tokoh|hero|villain|persona/.test(lower);
  const hasProduct = /produk|product|cream|serum|lotion|bottle|jar|packaging|skincare|sabun|toner|moisturizer/.test(lower);
  const hasWorld = /kota|city|world|dunia|realm|kingdom|scene|environment|landscape|alam|studio/.test(lower);
  const hasEffects = /glow|cahaya|sparkle|particles|partikel|magic|aura|glitter|shimmer|energi|effect|efek/.test(lower);
  const hasCharacterRef = referenceImages.some(r =>
    /karakter|character|maskot|mascot|person|tokoh|hero/.test(r.label.toLowerCase())
  );
  const hasProductRef = referenceImages.some(r =>
    /produk|product|cream|jar|bottle|packaging|skincare/.test(r.label.toLowerCase())
  );

  return {
    needsCharacter: hasCharacter || hasCharacterRef,
    needsProduct: hasProduct || hasProductRef,
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
    const refTags = referenceImages
      .filter(r => /karakter|character|maskot|person|tokoh|hero/.test(r.label.toLowerCase()))
      .map(r => r.tag).join(', ') || '@image1';
    conditionalFields.push(`    "character": "<character name> — exact design: outfit colors/material, accessories, distinguishing features; Maintain exact design from ${refTags} — DO NOT alter outfit/face/accessories; Frozen: never change [list specific features]"`);
  }

  if (flags.needsProduct) {
    const refTags = referenceImages
      .filter(r => /produk|product|cream|jar|bottle|packaging/.test(r.label.toLowerCase()))
      .map(r => r.tag).join(', ') || '@image1';
    conditionalFields.push(`    "product": "<product name> — Container: [color, material, finish]; Label: [color, exact text/logo]; Content: [color/texture if visible]; Maintain exact product from ${refTags}; Frozen: jar stays [color], label stays [text]"`);
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

async function buildStoryboard({ prompt, mode, duration, referenceImages = [], aspectRatio = 'portrait', clipDuration = 10, voType = 'narration' }) {
  const totalClips = Math.ceil(duration / clipDuration);
  const arLabel = ASPECT_RATIO_LABELS[aspectRatio] || '9:16';
  const audio = getAudioRules(voType, clipDuration);
  const flags = buildConditionalContext(prompt, referenceImages);

  // Reference images context
  const refCtx = referenceImages.length > 0
    ? `
USER REFERENCE IMAGES (${referenceImages.length} uploaded — assign relevant @imageN in character/product fields):
${referenceImages.map(r => `  ${r.tag} = "${r.label}"`).join('\n')}
- Use @imageN tags in character/product fields for visual freeze
- Reference the SAME tags in restrictions as freeze rules
`
    : '';

  const clipSchema = buildClipSchema(arLabel, clipDuration, flags, referenceImages, audio, totalClips);

  const voSentenceNote = audio.sentenceCount
    ? `- audioDimension.voScript: MUST be ${audio.sentenceCount} connected sentences that flow as one ${audio.type === 'dialogue' ? 'character speech' : 'narration'}`
    : `- soundDesign: be ASMR-specific — list every physical sound in sequence`;

  const systemPrompt = `You are a world-class AI video director and ad copywriter for premium Indonesian brands.

You generate STRUCTURED JSON storyboards for Grok AI video generation.
Each clip is a JSON object with structured fields that mirror GeminiGen's Advanced Prompt UI.
The grokPrompt is compiled automatically from these fields — you just fill the JSON precisely.

MISSION: Produce ad-agency quality briefs. Every field must be film-director specific — not vague, not generic.

FORMAT CONTEXT:
- ${clipDuration}s per clip, ${arLabel} aspect ratio, ${mode || 'normal'} generation mode
- Clips are independently generated (no chaining) — each must be visually self-contained
- All voScript/audioDimension text in Bahasa Indonesia; all other fields in English
${refCtx}
${audio.rules}

CORE FIELD QUALITY STANDARDS:
- mainSubject: name the subject precisely (not "a character" — use their actual name or description)
- action: MUST have Enter/Mid/Peak sub-beats. NEVER write "appears", "showcases", "presents"
- setting: name the location + describe its visual atmosphere in 1-2 sentences
- lighting: be specific — color temperature, direction, source type
- visualStyle: name the render style + key visual qualities
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

  const userPrompt = `Create a ${totalClips}-clip premium ad storyboard for:

"${prompt}"

Mode: ${mode || 'normal'} | Format: ${arLabel} | ${clipDuration}s per clip | Total: ${duration}s | Audio: ${audio.type.toUpperCase()}

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

  return parseClipsFromResponse(raw, totalClips, 1, arLabel, clipDuration, voType);
}

// ── refresh from a specific clip index ───────────────────────────────────────

async function refreshFromIndex({ prompt, mode, existingClips, fromIndex, totalClips, hint, referenceImages = [], aspectRatio = 'portrait', clipDuration = 10, voType = 'narration' }) {
  const clipsToKeep = existingClips.slice(0, fromIndex);
  const clipsToGenerate = totalClips - fromIndex;
  const arLabel = ASPECT_RATIO_LABELS[aspectRatio] || '9:16';
  const audio = getAudioRules(voType, clipDuration);
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

  const refCtx = referenceImages.length > 0
    ? `\nReference images: ${referenceImages.map(r => `${r.tag}="${r.label}"`).join(', ')}\n`
    : '';

  const clipSchema = buildClipSchema(arLabel, clipDuration, flags, referenceImages, audio, totalClips);

  const systemPrompt = `You are a world-class AI video director continuing an existing ad storyboard.
Generate clips that naturally continue the narrative, maintaining visual and brand consistency.
${clipDuration}s per clip, ${arLabel} aspect ratio, independently generated.
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

  const newClips = parseClipsFromResponse(raw, clipsToGenerate, fromIndex + 1, arLabel, clipDuration, voType);
  return [...clipsToKeep, ...newClips];
}

// ── parse helper + compile grokPrompt from JSON fields ───────────────────────

function parseClipsFromResponse(raw, expectedCount, startNumber = 1, arLabel = '9:16', clipDuration = 10, voType = 'narration') {
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

module.exports = { buildStoryboard, refreshFromIndex };
