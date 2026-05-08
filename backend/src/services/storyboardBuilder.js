/**
 * storyboardBuilder.js
 *
 * Uses GPT-4o (via apimart) to generate a structured storyboard for a Grok reel.
 *
 * Each clip object returned:
 *   {
 *     clipNumber     : 1-based index
 *     visualSummary  : 1-2 sentence description shown to user (Indonesian ok)
 *     voScript       : voiceover script text shown to user
 *     grokPrompt     : full optimised English prompt sent to GeminiGen (hidden from user)
 *     technicalConfig: { mainSubject, action, setting, lighting, visualStyle, cameraShot, additionalDetails }
 *   }
 */

const { chatCompletion } = require('./apimart');

const MODEL = process.env.VISION_MODEL || 'gpt-4o';

// ── build full storyboard from scratch ───────────────────────────────────────

async function buildStoryboard({ prompt, mode, duration }) {
  const totalClips = Math.ceil(duration / 10);

  const systemPrompt = `You are an expert AI video director and copywriter specialising in short-form social media ads.
Your task is to create a detailed, clip-by-clip video storyboard for a Grok AI video generator.

Rules:
- Each clip is exactly 10 seconds long
- Clips must flow visually and narratively — they are chained together (each extends the previous)
- visualSummary and voScript should be in Bahasa Indonesia
- grokPrompt MUST be in English, highly descriptive, optimised for Grok AI video generation
- grokPrompt should specify: subject, action, setting, lighting, camera movement, visual style, mood
- Keep each grokPrompt under 180 words but rich in visual detail
- technicalConfig fields are for internal use only

CONTENT DENSITY RULES (critical):
- voScript: write EXACTLY 2-3 punchy sentences totalling ~20-25 words — this is the spoken script for 10 seconds of audio. Must feel like a real TV/Instagram ad voiceover: energetic, benefit-driven, brand-aligned. NO single-sentence scripts.
- visualSummary: write 2-3 sentences describing the FULL visual arc of the 10s clip — opening shot, mid action, closing moment. Be specific about what the viewer sees from start to finish.

Generation mode hints:
- normal: cinematic, clean, premium
- extremely-crazy: wild camera moves, unexpected transitions, surreal elements
- extremely-spicy-or-crazy: maximum chaos, extreme visual creativity, bold colours
- custom: balanced creative freedom

Return ONLY a valid JSON array with exactly ${totalClips} clip objects. No markdown, no explanation.`;

  const userPrompt = `Create a ${totalClips}-clip video storyboard (${duration} seconds total) for this ad:

"${prompt}"

Generation mode: ${mode || 'normal'}

IMPORTANT: voScript must be 2-3 sentences (~20-25 words). visualSummary must describe the full 10s arc in 2-3 sentences.

Return JSON array with exactly ${totalClips} objects, each with these exact fields:
{
  "clipNumber": <number 1-${totalClips}>,
  "visualSummary": "<2-3 sentences in Bahasa Indonesia describing full visual arc of the 10s clip>",
  "voScript": "<2-3 punchy ad sentences in Bahasa Indonesia, ~20-25 words total, for 10s delivery>",
  "grokPrompt": "<full English prompt for Grok video AI>",
  "technicalConfig": {
    "mainSubject": "<who/what>",
    "action": "<what are they doing>",
    "setting": "<where>",
    "lighting": "<lighting type>",
    "visualStyle": "<style>",
    "cameraShot": "<shot type>",
    "additionalDetails": "<extra details>"
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

async function refreshFromIndex({ prompt, mode, existingClips, fromIndex, totalClips, hint }) {
  const clipsToKeep = existingClips.slice(0, fromIndex);
  const clipsToGenerate = totalClips - fromIndex;

  const contextStr = clipsToKeep.length > 0
    ? `\nExisting clips to keep as visual context (clips 1–${fromIndex}):\n${JSON.stringify(clipsToKeep.map(c => ({
        clipNumber: c.clipNumber,
        visualSummary: c.visualSummary,
        grokPrompt: c.grokPrompt,
      })), null, 2)}\n`
    : '';

  const hintStr = hint ? `\nUser hint for this section: "${hint}"` : '';

  const systemPrompt = `You are an expert AI video director creating a continuation of an existing video storyboard.
Generate new clips that naturally follow the visual style and narrative of the preceding clips.
Same rules apply: visualSummary and voScript in Bahasa Indonesia, grokPrompt in English.
Keep visual continuity — the clips will be extended from the last clip.
Return ONLY a valid JSON array. No markdown, no explanation.

CONTENT DENSITY RULES (critical):
- voScript: EXACTLY 2-3 punchy sentences totalling ~20-25 words for 10 seconds of spoken audio. Real ad voiceover energy.
- visualSummary: 2-3 sentences describing the FULL visual arc of the 10s clip from opening to closing shot.`;

  const userPrompt = `Continue this ${Math.ceil((totalClips * 10) / 1)}-second ad storyboard.
Original prompt: "${prompt}"
Generation mode: ${mode || 'normal'}
${contextStr}${hintStr}

Generate ${clipsToGenerate} new clip(s) starting from clip number ${fromIndex + 1} to ${totalClips}.

IMPORTANT: voScript must be 2-3 sentences (~20-25 words). visualSummary must describe the full 10s arc in 2-3 sentences.

Return JSON array with exactly ${clipsToGenerate} objects (clipNumber starts at ${fromIndex + 1}):
{
  "clipNumber": <number>,
  "visualSummary": "<2-3 sentences in Bahasa Indonesia describing full visual arc of the 10s clip>",
  "voScript": "<2-3 punchy ad sentences in Bahasa Indonesia, ~20-25 words total, for 10s delivery>",
  "grokPrompt": "<English, for Grok AI>",
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
  // Extract JSON array from response
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error(`GPT-4o returned invalid storyboard response: no JSON array found`);
  }

  let clips;
  try {
    clips = JSON.parse(match[0]);
  } catch (e) {
    throw new Error(`GPT-4o storyboard JSON parse error: ${e.message}`);
  }

  if (!Array.isArray(clips)) {
    throw new Error('GPT-4o storyboard: expected JSON array');
  }

  if (clips.length !== expectedCount) {
    throw new Error(`GPT-4o storyboard: expected ${expectedCount} clips, got ${clips.length}`);
  }

  // Validate and normalise each clip
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
