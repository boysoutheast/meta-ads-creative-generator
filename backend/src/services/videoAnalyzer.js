const fs = require('fs');
const path = require('path');
const { analyzeImage, chatCompletion } = require('./apimart');
const config = require('../config');

async function extractVideoFrames(videoPath, maxFrames = 5) {
  try {
    const { execSync } = require('child_process');
    const framesDir = path.join(path.dirname(videoPath), 'frames_' + Date.now());
    fs.mkdirSync(framesDir, { recursive: true });

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

    fs.rmSync(framesDir, { recursive: true, force: true });
    return frames;
  } catch (error) {
    console.warn('ffmpeg not available:', error.message);
    return [];
  }
}

async function analyzeImageReference(imagePath) {
  const imageBuffer = fs.readFileSync(imagePath);
  const imageBase64 = imageBuffer.toString('base64');
  const ext = path.extname(imagePath).toLowerCase();
  const mimeTypeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  const mimeType = mimeTypeMap[ext] || 'image/jpeg';

  const analysisPrompt = `Analyze this image as a creative director for Meta Ads. Describe:
1. Visual composition and layout
2. Color palette and mood
3. Lighting style
4. Subject and setting
5. Overall aesthetic/style
6. What makes this effective as an ad visual?

Be specific and detailed.`;

  return analyzeImage({ imageBase64, mimeType, prompt: analysisPrompt });
}

async function analyzeVideoReference(videoPath) {
  const frames = await extractVideoFrames(videoPath, 4);

  if (frames.length === 0) {
    return {
      analysis: {
        scenes: [],
        overallStyle: 'Could not extract frames. Please describe manually.',
        pacing: 'unknown',
        hookType: 'unknown',
        colorPalette: [],
        cameraMovement: 'unknown',
        emotionArc: 'unknown',
        recommendedDuration: 30,
        musicVibe: 'unknown',
        raw: 'Frame extraction unavailable.',
      },
      frames: 0,
    };
  }

  const framesToAnalyze = frames.length > 2 ? [frames[0], frames[Math.floor(frames.length / 2)], frames[frames.length - 1]] : frames;
  const frameAnalyses = [];

  for (let i = 0; i < framesToAnalyze.length; i++) {
    const analysis = await analyzeImage({
      imageBase64: framesToAnalyze[i],
      mimeType: 'image/jpeg',
      prompt: `Analyze this video frame ${i + 1} of ${framesToAnalyze.length} for Meta Ads creative reference:
1. What's happening in this scene?
2. Visual style, colors, lighting
3. Emotion/mood conveyed
4. Camera angle/movement cues
Be concise but specific.`,
    });
    frameAnalyses.push(analysis);
  }

  const synthesisPrompt = `You are a video creative director analyzing a winning ad video for Meta Ads.

Frame analyses:
${frameAnalyses.map((a, i) => `Frame ${i + 1}: ${a}`).join('\n\n')}

Based on these frames, return a detailed JSON analysis. Return ONLY valid JSON, no markdown:
{
  "scenes": [
    {
      "sceneNumber": 1,
      "duration": "0-3s",
      "description": "what happens in this scene",
      "hook": true,
      "visualElements": ["element1", "element2"],
      "emotion": "emotion name"
    }
  ],
  "overallStyle": "description of overall visual style",
  "pacing": "description of pacing",
  "hookType": "how it grabs attention in first 3 seconds",
  "colorPalette": ["color1", "color2", "color3"],
  "cameraMovement": "description of camera movement",
  "emotionArc": "pain → hope → solution → relief (adapt to actual)",
  "recommendedDuration": 30,
  "musicVibe": "description of recommended music/sound"
}`;

  const synthesisRaw = await chatCompletion({
    model: config.models.chat,
    messages: [
      { role: 'system', content: 'You are a video creative strategist. Return only valid JSON.' },
      { role: 'user', content: synthesisPrompt },
    ],
    maxTokens: 1000,
  });

  let structuredAnalysis;
  try {
    const jsonMatch = synthesisRaw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      structuredAnalysis = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('No JSON found');
    }
  } catch (e) {
    structuredAnalysis = {
      scenes: [],
      overallStyle: synthesisRaw.slice(0, 200),
      pacing: 'varied',
      hookType: 'visual hook',
      colorPalette: [],
      cameraMovement: 'mixed',
      emotionArc: 'engagement → desire → action',
      recommendedDuration: 30,
      musicVibe: 'uplifting, engaging',
    };
  }

  return {
    analysis: structuredAnalysis,
    frames: frames.length,
  };
}

async function generateVideoPromptFromReference(referenceAnalysis, productName, adGoal) {
  const videoPrompt = await chatCompletion({
    model: config.models.chat,
    messages: [
      {
        role: 'system',
        content: 'You are an expert at writing prompts for AI video generation tools. Create cinematic, detailed video prompts in English.',
      },
      {
        role: 'user',
        content: `Create a video generation prompt for a Meta Ad based on this reference style:

Reference Style Analysis:
${JSON.stringify(referenceAnalysis, null, 2)}

Product: ${productName}
Ad Goal: ${adGoal}

Write a detailed video prompt (150-250 words) that replicates the visual style for the new product.
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
