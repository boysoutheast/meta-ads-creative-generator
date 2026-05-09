/**
 * sceneImageService.js
 *
 * Generates one preview image per storyboard clip using gpt-image-2 via apimart.
 * These images serve two purposes:
 *   1. User preview — shows what each scene will look like before video generation
 *   2. Video reference — passed as image_urls[] to GeminiGen for fresh clips
 *
 * Image prompt is built from technicalConfig fields (subject, action, setting,
 * lighting, visualStyle, cameraShot) in portrait 9:16 format.
 */

const { generateImage } = require('./apimart');
const config = require('../config');

// Use the same model as other image generations (gpt-image-2 via apimart)
const SCENE_IMAGE_MODEL = config.models.image;
const PORTRAIT_SIZE = '1024x1536'; // closest 9:16 portrait supported by apimart

/**
 * Build a concise English image prompt from a storyboard clip's technicalConfig.
 * Falls back to grokPrompt excerpt if technicalConfig is sparse.
 */
/**
 * Build a rich English image prompt from a storyboard clip's technicalConfig.
 * Leverages the power template fields: characterDesign, productDesign, worldBuilding,
 * colorPalette, effects — for a much more accurate scene preview image.
 */
function buildSceneImagePrompt(clip) {
  const tc = clip.technicalConfig || {};

  const parts = [];

  // Rich fields from the power template (new)
  if (tc.worldBuilding)    parts.push(tc.worldBuilding);
  if (tc.mainSubject)      parts.push(tc.mainSubject);
  if (tc.characterDesign)  parts.push(`Character: ${tc.characterDesign}`);
  if (tc.productDesign)    parts.push(`Product: ${tc.productDesign}`);
  if (tc.action)           parts.push(tc.action);
  if (tc.effects)          parts.push(tc.effects);
  if (tc.colorPalette)     parts.push(`Color palette: ${tc.colorPalette}`);
  if (tc.lighting)         parts.push(tc.lighting);
  if (tc.visualStyle)      parts.push(`${tc.visualStyle} style`);
  if (tc.cameraShot)       parts.push(tc.cameraShot);
  if (tc.additionalDetails) parts.push(tc.additionalDetails);

  // Fallback: if still sparse, extract visual sections from the grokPrompt directly
  if (parts.length < 4 && clip.grokPrompt) {
    const visualSections = ['WORLD', 'CHARACTER', 'PRODUCT', 'EFFECTS', 'STYLE'];
    for (const s of visualSections) {
      const m = clip.grokPrompt.match(new RegExp(`\\[${s}\\]\\s*([^\\[]+)`, 'i'));
      if (m) parts.push(m[1].replace(/\n/g, ' ').trim().slice(0, 150));
    }
  }

  const base = parts.filter(Boolean).join(', ');
  return `${base}, vertical 9:16 aspect ratio, high quality 3D render, cinematic lighting, ultra detailed, premium glossy finish`;
}

/**
 * Generate scene preview images for all clips in parallel (max 5 concurrent).
 *
 * @param {Array} storyboard - array of clip objects from storyboardBuilder
 * @returns {Promise<Array<{ clipNumber, sceneImageUrl }>>}
 */
async function generateSceneImages(storyboard) {
  const CONCURRENCY = 5;
  const results = new Array(storyboard.length).fill(null);

  // Process in batches to avoid rate-limit hammering
  for (let i = 0; i < storyboard.length; i += CONCURRENCY) {
    const batch = storyboard.slice(i, i + CONCURRENCY);

    const batchResults = await Promise.allSettled(
      batch.map(async (clip) => {
        const prompt = buildSceneImagePrompt(clip);

        const images = await generateImage({
          prompt,
          size: PORTRAIT_SIZE,
          model: SCENE_IMAGE_MODEL,
          pollIntervalMs: 2000,
          timeoutMs: 90000,
        });

        const url = images?.[0]?.url;
        if (!url) throw new Error(`No URL returned for clip ${clip.clipNumber}`);

        return { clipNumber: clip.clipNumber, sceneImageUrl: url };
      })
    );

    batchResults.forEach((outcome, j) => {
      const clip = batch[j];
      if (outcome.status === 'fulfilled') {
        results[i + j] = outcome.value;
      } else {
        // Log but don't hard-fail — scene image is non-blocking for video generation
        console.warn(`[SceneImage] clip ${clip.clipNumber} failed:`, outcome.reason?.message);
        results[i + j] = { clipNumber: clip.clipNumber, sceneImageUrl: null, error: outcome.reason?.message };
      }
    });
  }

  return results;
}

/**
 * Generate scene image for a single clip (used when refreshing from a clip index).
 */
async function generateSingleSceneImage(clip) {
  const prompt = buildSceneImagePrompt(clip);
  try {
    const images = await generateImage({
      prompt,
      size: PORTRAIT_SIZE,
      model: SCENE_IMAGE_MODEL,
      pollIntervalMs: 2000,
      timeoutMs: 90000,
    });
    const url = images?.[0]?.url;
    if (!url) throw new Error('No URL returned');
    return { clipNumber: clip.clipNumber, sceneImageUrl: url };
  } catch (err) {
    console.warn(`[SceneImage] single clip ${clip.clipNumber} failed:`, err.message);
    return { clipNumber: clip.clipNumber, sceneImageUrl: null, error: err.message };
  }
}

module.exports = { generateSceneImages, generateSingleSceneImage, buildSceneImagePrompt };
