const { analyzeImage, chatCompletion, generateImage } = require('./apimart');
const config = require('../config');
const fs = require('fs');

/**
 * Scaling Angles untuk Meta Ads
 */
const SCALING_ANGLES = {
  price_anchor: {
    label: 'Price Anchor',
    hook: 'Fokus value & harga — perbandingan harga, ROI, atau "hanya Rp..."',
  },
  fomo: {
    label: 'FOMO / Urgency',
    hook: 'Fear of missing out — stok terbatas, waktu terbatas, "jangan sampai ketinggalan"',
  },
  social_proof: {
    label: 'Social Proof',
    hook: 'Testimoni, angka, review — "sudah X orang pakai", bintang rating',
  },
  tutorial: {
    label: 'Tutorial / How-To',
    hook: 'Edukasi step-by-step, cara pakai, tips, "3 langkah untuk..."',
  },
  curiosity_gap: {
    label: 'Curiosity Gap',
    hook: 'Hook yang bikin penasaran — "Rahasia yang...", "Kenapa X bisa..."',
  },
  before_after: {
    label: 'Before & After',
    hook: 'Transformasi nyata — sebelum & sesudah pakai produk',
  },
  problem_agitate: {
    label: 'Problem Agitate',
    hook: 'Identifikasi masalah yang menyakitkan dan solusi langsung',
  },
  authority: {
    label: 'Authority / Expert',
    hook: 'Posisi sebagai ahli — "Direkomendasikan oleh...", award, sertifikasi',
  },
};

/**
 * Deep analysis of a winning ad
 */
async function analyzeWinningAd(filePath, fileType = 'image') {
  const imageBuffer = fs.readFileSync(filePath);
  const imageBase64 = imageBuffer.toString('base64');
  const mimeType = fileType === 'image' ? 'image/jpeg' : 'image/jpeg'; // extracted frame

  const analysisPrompt = `Kamu adalah Meta Ads creative strategist. Analisis iklan ini secara mendalam dan return dalam format JSON yang VALID.

Analisis:
1. HOOK: Apa yang menarik perhatian pertama? Elemen visual apa yang stop scroll?
2. VISUAL STYLE: Color palette, lighting, komposisi, mood, aesthetic
3. COPY PATTERN: Pola headline yang dipakai (question/statement/number/how-to/curiosity)
4. ANGLE: Scaling angle mana yang dipakai (price_anchor/fomo/social_proof/tutorial/curiosity_gap/before_after/problem_agitate/authority)
5. FORMAT: Cocok untuk format apa (Feed 1:1 / Story 9:16 / Reels)
6. TARGET AUDIENCE: Perkiraan target (usia, minat, pain point)
7. EMOTION: Emosi utama yang ditrigger (fear/desire/curiosity/trust/urgency)
8. STRENGTH: 3 hal terkuat dari iklan ini
9. COLOR_PALETTE: 3-5 warna dominan dalam hex

Return HANYA valid JSON tanpa markdown, tanpa penjelasan:
{
  "hook": "deskripsi hook singkat",
  "visualStyle": "deskripsi visual style",
  "colorPalette": ["#hex1", "#hex2", "#hex3"],
  "copyPattern": "pola copy yang dipakai",
  "dominantAngle": "angle_key",
  "format": "Feed/Story/Reels",
  "targetAudience": "perkiraan target audience",
  "primaryEmotion": "emosi utama",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "composition": "deskripsi komposisi visual",
  "lighting": "deskripsi lighting",
  "mood": "mood keseluruhan"
}`;

  const analysisRaw = await analyzeImage({
    imageBase64,
    mimeType,
    prompt: analysisPrompt,
  });

  // Parse JSON dari response
  try {
    const jsonMatch = analysisRaw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.warn('Could not parse winning ad analysis as JSON, returning raw');
  }

  return { raw: analysisRaw };
}

/**
 * Generate multiple scaling angles dari analisis winning ad
 */
async function generateScalingAngles(winningAnalysis, productName, selectedAngles = []) {
  const anglesToGenerate = selectedAngles.length > 0
    ? selectedAngles
    : Object.keys(SCALING_ANGLES);

  const systemPrompt = `Kamu adalah Meta Ads copywriter terbaik di Indonesia. Buat variasi copy iklan yang scroll-stopping, high-CTR, dan cocok untuk Meta Ads.`;

  const userPrompt = `Produk: ${productName}

Analisis iklan winning ini:
${JSON.stringify(winningAnalysis, null, 2)}

Buat copy variasi untuk ${anglesToGenerate.length} angle berikut: ${anglesToGenerate.join(', ')}

Untuk tiap angle, return:
{
  "angle": "angle_key",
  "headline": "headline max 8 kata (impactful, scroll-stopping)",
  "subheadline": "subheadline max 15 kata",
  "bodyText": "body copy max 30 kata",
  "cta": "CTA button text max 4 kata",
  "imageDirection": "arahan visual singkat untuk gambar (20 kata)"
}

Return array JSON valid, tanpa markdown.`;

  const response = await chatCompletion({
    model: config.models.chat,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    maxTokens: 1500,
    temperature: 0.8,
  });

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.warn('Could not parse scaling angles as JSON');
  }

  return [];
}

/**
 * Generate image prompt untuk 1 variasi scaling
 */
async function generateVariationPrompt(winningAnalysis, angle, productName) {
  const angleInfo = SCALING_ANGLES[angle.angle] || {};

  const prompt = await chatCompletion({
    model: config.models.chat,
    messages: [
      {
        role: 'system',
        content: 'Kamu adalah expert AI image prompt engineer untuk Meta Ads. Buat prompt yang detail dan optimized untuk generate iklan yang scroll-stopping.',
      },
      {
        role: 'user',
        content: `Buat image generation prompt untuk Meta Ads variasi ini:

Produk: ${productName}
Angle: ${angle.angle} — ${angleInfo.hook || ''}
Headline: ${angle.headline}
Image Direction: ${angle.imageDirection}

Style dari winning ad:
- Visual style: ${winningAnalysis.visualStyle || 'tidak diketahui'}
- Color palette: ${(winningAnalysis.colorPalette || []).join(', ')}
- Lighting: ${winningAnalysis.lighting || 'natural'}
- Mood: ${winningAnalysis.mood || 'engaging'}
- Composition: ${winningAnalysis.composition || 'centered'}
- Format: ${winningAnalysis.format || 'Feed 1:1'}

Buat prompt dalam bahasa Inggris (100-200 kata) yang:
1. Replikasi visual style dari winning ad
2. Sesuai angle yang dipilih
3. Dimulai dengan: "Meta Ads creative, scroll-stopping, high-CTR visual, "
4. TIDAK include teks/tulisan dalam prompt
5. Include: subject, setting, lighting, color, mood, composition, style

Output HANYA prompt text, tanpa penjelasan.`,
      },
    ],
    maxTokens: 400,
    temperature: 0.8,
  });

  return prompt.trim();
}

/**
 * Batch generate prompts untuk semua variasi
 */
async function generateVariationPrompts(winningAnalysis, angles, productName) {
  const prompts = await Promise.allSettled(
    angles.map((angle) => generateVariationPrompt(winningAnalysis, angle, productName))
  );

  return angles.map((angle, i) => ({
    ...angle,
    imagePrompt: prompts[i].status === 'fulfilled' ? prompts[i].value : null,
    promptError: prompts[i].status === 'rejected' ? prompts[i].reason?.message : null,
  }));
}

/**
 * Batch generate images untuk semua variasi
 */
async function batchGenerateImages(variations, aspectRatio = '1:1') {
  const sizeMap = {
    '1:1': '1024x1024',
    '9:16': '1024x1792',
    '16:9': '1792x1024',
    '4:5': '1024x1024',
  };
  const size = sizeMap[aspectRatio] || '1024x1024';

  const results = await Promise.allSettled(
    variations
      .filter((v) => v.imagePrompt)
      .map((variation) => generateImage({ prompt: variation.imagePrompt, size }))
  );

  return variations.map((variation, i) => {
    if (!variation.imagePrompt) {
      return { ...variation, imageUrl: null, imageError: 'No prompt generated' };
    }
    const result = results[i];
    return {
      ...variation,
      imageUrl: result.status === 'fulfilled' ? result.value[0]?.url : null,
      imageError: result.status === 'rejected' ? result.reason?.message : null,
    };
  });
}

module.exports = {
  SCALING_ANGLES,
  analyzeWinningAd,
  generateScalingAngles,
  generateVariationPrompts,
  batchGenerateImages,
};
