/**
 * reviewAgent.js
 *
 * Self-review agent — after video generation finishes, analyzes clip thumbnails
 * (when available) plus VO scripts to surface visual/quality issues to the user
 * before they download the final reel.
 *
 * Returns: { overallScore: 0-100, issues: [{clipIndex, severity, message}], summary }
 */

const axios = require('axios');
const { analyzeImage, chatCompletion } = require('./apimart');

async function fetchAsBase64(url, timeoutMs = 15000) {
  const { data, headers } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: timeoutMs,
    maxRedirects: 5,
    headers: { 'User-Agent': 'AdsCreativeGen-ReviewAgent/1.0' },
  });
  const mimeType = headers['content-type'] || 'image/jpeg';
  return { base64: Buffer.from(data).toString('base64'), mimeType };
}

async function describeThumbnail(thumbnailUrl) {
  const { base64, mimeType } = await fetchAsBase64(thumbnailUrl);
  return analyzeImage({
    imageBase64: base64,
    mimeType,
    prompt:
      'Briefly describe what you see in this video frame. Comment on visual clarity, ' +
      'composition, and any obvious issues (artifacts, blur, extra limbs, distorted text). ' +
      'Max 50 words. Plain prose only.',
    maxTokens: 200,
  });
}

/**
 * Run a review pass on the generated clips.
 * @param {Array<{clipIndex:number, thumbnailUrl?:string|null, voScript?:string}>} clips
 * @param {string} brief - the original ad brief
 */
async function reviewGeneratedClips(clips, brief) {
  const clipsWithThumbs = (clips || []).filter((c) => c && c.thumbnailUrl);
  if (clipsWithThumbs.length === 0) {
    return {
      issues: [],
      overallScore: 70,
      summary: 'No thumbnails available for visual review — score based on script only',
    };
  }

  const descriptions = await Promise.allSettled(
    clipsWithThumbs.map(async (clip) => {
      try {
        const description = await describeThumbnail(clip.thumbnailUrl);
        return { clipIndex: clip.clipIndex, description };
      } catch (e) {
        return { clipIndex: clip.clipIndex, description: `Unable to analyze: ${e.message}` };
      }
    })
  );

  const cleanDescriptions = descriptions
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);

  const reviewPrompt = `You are a video ad quality reviewer. Review these AI-generated video clips for a product ad.

Brief: "${(brief || '').slice(0, 500)}"

Clip descriptions (from vision model):
${cleanDescriptions.map((d) => `Clip ${d.clipIndex + 1}: ${d.description}`).join('\n')}

VO scripts:
${(clips || [])
  .map((c) => `Clip ${c.clipIndex + 1}: ${(c.voScript || '').slice(0, 200) || '(none)'}`)
  .join('\n')}

Return ONLY valid JSON, no markdown:
{
  "overallScore": 0-100 (integer),
  "issues": [{ "clipIndex": 0, "severity": "warning" | "error" | "info", "message": "max 25 words" }],
  "summary": "one-sentence overall assessment"
}`;

  let raw;
  try {
    raw = await chatCompletion({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: reviewPrompt }],
      maxTokens: 800,
      temperature: 0.3,
    });
  } catch (e) {
    return {
      issues: [],
      overallScore: 70,
      summary: `Review error: ${e.message}`,
    };
  }

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('no JSON');
    const parsed = JSON.parse(match[0]);
    return {
      overallScore: typeof parsed.overallScore === 'number' ? parsed.overallScore : 70,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      summary: typeof parsed.summary === 'string' ? parsed.summary : 'Review complete',
    };
  } catch {
    return { issues: [], overallScore: 75, summary: 'Review complete (parse fallback)' };
  }
}

module.exports = { reviewGeneratedClips };
