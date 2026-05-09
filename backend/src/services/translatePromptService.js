/**
 * translatePromptService.js
 *
 * Given a video analysis + user intent + asset (product/character/none),
 * use GPT-4o via apimart to produce a detailed, ready-to-use GeminiGen grok-3
 * video prompt tailored for the chosen asset mode.
 */

const { chatCompletion, analyzeImage } = require('./apimart');
const config = require('../config');

/**
 * @param {object} opts
 * @param {object} opts.videoAnalysis       - result from analyzeVideoFromUrl.analysis
 * @param {string} opts.userIntent          - free-text: "untuk apa video ini?"
 * @param {string} opts.productName         - product / character name (or 'Generic' for none)
 * @param {string} [opts.productDescription]
 * @param {'product'|'character'|'none'} [opts.assetMode]
 * @param {string|null} [opts.characterPhotoBase64]  - base64 (no data: prefix) for character mode
 * @param {string} [opts.characterPhotoMime]         - default 'image/jpeg'
 * @returns {Promise<{ videoPrompt, hookVariants, scriptOutline }>}
 */
async function translateVideoPrompt({
  videoAnalysis,
  userIntent,
  productName,
  productDescription = '',
  assetMode = 'product',
  characterPhotoBase64 = null,
  characterPhotoMime = 'image/jpeg',
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

  // Character mode: analyze the character photo first to get appearance details
  let characterVisualDesc = '';
  if (assetMode === 'character' && characterPhotoBase64) {
    try {
      characterVisualDesc = await analyzeImage({
        imageBase64: characterPhotoBase64,
        mimeType: characterPhotoMime || 'image/jpeg',
        prompt: 'Describe this character: appearance, outfit, hair, skin tone, expression, style. Under 60 words. For use in AI video generation prompts.',
      });
    } catch (e) {
      console.warn('[translatePrompt] character photo analysis non-fatal:', e.message);
    }
  }

  // Build the asset block conditionally per mode
  const assetBlock =
    assetMode === 'character'
      ? `CHARACTER NAME: ${productName}
${characterVisualDesc ? `CHARACTER APPEARANCE: ${characterVisualDesc}` : ''}
${productDescription ? `ADDITIONAL INFO: ${productDescription}` : ''}`
      : assetMode === 'none'
      ? 'ASSET: None — create a generic/conceptual video prompt without a specific product or character. Build the scene around the user intent and the winning ad DNA only.'
      : `PRODUCT: ${productName}
${productDescription ? `PRODUCT DESCRIPTION: ${productDescription}` : ''}`;

  const adaptInstruction =
    assetMode === 'character'
      ? `Adapts the content to showcase the character "${productName}"${characterVisualDesc ? ` (whose appearance is described above — keep them consistent throughout)` : ''}`
      : assetMode === 'none'
      ? 'Adapts the content to express the concept described in the user intent (no specific product / character branding)'
      : `Adapts the content to showcase "${productName}"`;

  const raw = await chatCompletion({
    model: config.models.scalingChat || config.models.chat,
    messages: [
      {
        role: 'system',
        content: 'You are an expert video ad copywriter and prompt engineer for AI video generation tools. Return only valid JSON, no markdown.',
      },
      {
        role: 'user',
        content: `A winning ad video has been analyzed. You must adapt its creative DNA for a new asset.

WINNING AD DNA:
${analysisStr}

USER INTENT:
"${userIntent}"

${assetBlock}

Your tasks:
1. Write a detailed 150-200 word video generation prompt (for GeminiGen grok-3) that:
   - Replicates the visual style, pacing, camera movement, and color palette of the winning ad
   - ${adaptInstruction}
   - Incorporates the user's intent: "${userIntent}"
   - Includes specific cinematic details (shot types, lighting, transitions, music direction)

2. Write 3 hook variants (first 3 seconds) adapted from the winning ad's hook style.

3. Write a script outline adapted from the winning ad's structure.

Return ONLY valid JSON:
{
  "videoPrompt": "the full 150-200 word cinematic video prompt in English",
  "hookVariants": [
    "Hook variant 1 (adapt style from winning ad)",
    "Hook variant 2",
    "Hook variant 3"
  ],
  "scriptOutline": "step-by-step script outline: 1) hook, 2) problem, 3) solution, 4) CTA — adapted from winning ad structure"
}`,
      },
    ],
    maxTokens: 800,
  });

  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
  } catch (e) {
    console.warn('[translatePromptService] JSON parse failed:', e.message);
  }

  return {
    videoPrompt: raw.slice(0, 400) || 'Video prompt generation failed.',
    hookVariants: [],
    scriptOutline: '',
  };
}

module.exports = { translateVideoPrompt };
