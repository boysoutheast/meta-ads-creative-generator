const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { analyzeImage, chatCompletion } = require('./apimart');
const config = require('../config');

/**
 * Extract frames from video using ffmpeg (if available) or use first frame approach
 * Since ffmpeg might not be available in all environments, we handle both cases
 */
async function extractVideoFrames(videoPath, maxFrames = 5) {
  try {
    // Try ffmpeg approach
    const { execSync } = require('child_process');
    const framesDir = path.join(path.dirname(videoPath), 'frames_' + Date.now());
    fs.mkdirSync(framesDir, { recursive: true });

    // Extract frames at intervals
    execSync(
      `ffmpeg -i "${videoPath}" -vf "fps=1/5,scale=512:-1" -frames:v ${maxFrames} "${framesDir}/frame%03d.jpg" -y`,
      { timeout: 30000 }
    );

    const frames = fs.readdirSync(framesDir)
      .filter((f) => f.endsWith('.jpg'))
      .sort()
      .slice(0, maxFrames)
      .map((f) => {
        const framePath = path.join(framesDir, f);
        const data = fs.readFileSync(framePath);
        return data.toString('base64');
      });

    // Cleanup
    fs.rmSync(framesDir, { recursive: true, force: true });
    return frames;
  } catch (error) {
    console.warn('ffmpeg not available, skipping frame extraction:', error.message);
    return [];
  }
}

/**
 * Analyze image reference for visual style, composition, mood
 */
async function analyzeImageReference(imagePath) {
  const imageBuffer = fs.readFileSync(imagePath);
  const imageBase64 = imageBuffer.toString('base64');

  const ext = path.extname(imagePath).toLowerCase();
  const mimeTypeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  const mimeType = mimeTypeMap[ext] || 'image/jpeg';

  const analysisPrompt = `Analyze this image as a creative director for Meta Ads. Describe:
1. Visual composition and layout
2. Color palette and mood
3. Lighting style
4. Subject and setting
5. Overall aesthetic/style
6. What makes this effective as an ad visual?

Be specific and detailed. This analysis will be used to recreate a similar style for a new ad.`;

  const analysis = await analyzeImage({
    imageBase64,
    mimeType,
    prompt: analysisPrompt,
  });

  return analysis;
}

/**
 * Analyze video reference - extract key visual elements and style
 */
async function analyzeVideoReference(videoPath) {
  const frames = await extractVideoFrames(videoPath, 4);

  if (frames.length === 0) {
    return {
      analysis: 'Video uploaded but frame extraction not available. Please describe your video reference manually.',
      frames: 0,
    };
  }

  // Analyze first and middle frame
  const analyses = [];
  const framesToAnalyze = frames.length > 2 ? [frames[0], frames[Math.floor(frames.length / 2)]] : frames;

  for (const frameBase64 of framesToAnalyze) {
    const analysis = await analyzeImage({
      imageBase64: frameBase64,
      mimeType: 'image/jpeg',
      prompt: `Analyze this video frame for Meta Ads creative reference:
1. Visual style and aesthetic
2. Color scheme and mood
3. Subject matter and composition
4. Camera style (close-up, wide, etc.)
5. Lighting and atmosphere
Be concise but specific.`,
    });
    analyses.push(analysis);
  }

  // Synthesize all frame analyses
  const synthesis = await chatCompletion({
    model: config.models.chat,
    messages: [
      {
        role: 'system',
        content:
          'You are a creative director. Synthesize video frame analyses into a cohesive visual style guide for recreating a similar ad creative.',
      },
      {
        role: 'user',
        content: `Based on these video frame analyses, create a concise visual style guide:\n\n${analyses.join('\n\n---\n\n')}\n\nProvide a 100-150 word synthesis focusing on: overall visual style, color palette, mood, and key elements to replicate.`,
      },
    ],
    maxTokens: 400,
  });

  return {
    analysis: synthesis,
    frames: frames.length,
    frameAnalyses: analyses,
  };
}

/**
 * Generate video prompt from reference analysis
 */
async function generateVideoPromptFromReference(referenceAnalysis, productName, adGoal) {
  const videoPrompt = await chatCompletion({
    model: config.models.chat,
    messages: [
      {
        role: 'system',
        content:
          'You are an expert at writing prompts for AI video generation tools like Runway, Sora, and Kling. Create cinematic, detailed video prompts.',
      },
      {
        role: 'user',
        content: `Create a video generation prompt for a Meta Ad based on this reference style:

**Reference Style Analysis:**
${referenceAnalysis}

**Product/Service:** ${productName}
**Ad Goal:** ${adGoal}

Write a detailed video prompt (150-250 words) that:
- Replicates the visual style from the reference
- Features the product naturally
- Is optimized for a 15-30 second social media ad
- Includes: scene description, camera movement, lighting, color grade, mood, pacing
- Written in English for AI video generation

Output ONLY the video prompt, no explanations.`,
      },
    ],
    maxTokens: 400,
    temperature: 0.8,
  });

  return videoPrompt.trim();
}

module.exports = {
  analyzeImageReference,
  analyzeVideoReference,
  generateVideoPromptFromReference,
};
