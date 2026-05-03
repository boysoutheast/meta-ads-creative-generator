const { analyzeImage, chatCompletion, generateImage, generateVideo } = require('./apimart');
const config = require('../config');
const fs = require('fs');

/**
 * Analisis referensi iklan (competitor / inspirasi)
 */
async function analyzeReference(filePath, fileType = 'image') {
  const imageBuffer = fs.readFileSync(filePath);
  const imageBase64 = imageBuffer.toString('base64');

  const analysisPrompt = `Kamu adalah Meta Ads creative director. Analisis iklan referensi ini untuk dijadikan inspirasi membuat iklan produk lain.

PENTING: Analisis STYLE dan APPROACH saja, bukan konten spesifik (jangan sebutkan brand/produk aslinya).

Analisis dari sudut pandang: bagaimana saya bisa buat iklan serupa tapi untuk produk saya sendiri?

Return valid JSON tanpa markdown:
{
  "visualStyle": "deskripsi visual style keseluruhan (2-3 kalimat)",
  "colorScheme": {
    "primary": "#hex",
    "secondary": "#hex",
    "accent": "#hex",
    "background": "#hex"
  },
  "layout": "deskripsi layout dan komposisi (center/rule-of-thirds/full-bleed/grid/etc)",
  "mood": "mood/tone iklan (energetic/calm/luxurious/playful/serious/warm/etc)",
  "lighting": "deskripsi lighting yang dipakai",
  "hookPattern": "pola hook yang dipakai (question/statement/visual_shock/curiosity/benefit-first/etc)",
  "copyStructure": "struktur copy yang terlihat (headline-first/image-first/minimal-text/etc)",
  "targetDemographic": "perkiraan target yang disasar dari visual",
  "photographyStyle": "gaya fotografi/ilustrasi (lifestyle/product-shot/documentary/flat-lay/etc)",
  "textPlacement": "posisi teks dalam frame (top/bottom/overlay/none-visible)",
  "callToActionStyle": "gaya CTA (button/text/visual-cue/none-visible)",
  "replicateInstructions": "3-4 kalimat panduan praktis: bagaimana mereplikasi style ini untuk produk lain"
}`;

  const analysisRaw = await analyzeImage({
    imageBase64,
    mimeType: 'image/jpeg',
    prompt: analysisPrompt,
  });

  try {
    const jsonMatch = analysisRaw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.warn('Could not parse reference analysis as JSON');
  }

  return { raw: analysisRaw };
}

/**
 * Blend reference style dengan product info untuk generate iklan
 */
async function blendReferenceWithProduct(referenceAnalysis, productInfo) {
  const blendPrompt = await chatCompletion({
    model: config.models.chat,
    messages: [
      {
        role: 'system',
        content: `Kamu adalah Meta Ads creative strategist. Tugas: combine visual style dari referensi iklan dengan informasi produk untuk menciptakan brief iklan yang compelling.`,
      },
      {
        role: 'user',
        content: `Reference Style Analysis:
${JSON.stringify(referenceAnalysis, null, 2)}

Product Information:
- Nama produk: ${productInfo.productName}
- Deskripsi: ${productInfo.description || '-'}
- USP / Keunggulan: ${productInfo.usp || '-'}
- Target audience: ${productInfo.targetAudience || 'umum'}
- Tujuan iklan: ${productInfo.adGoal || 'conversion'}
- Warna brand: ${productInfo.brandColors || 'sesuaikan dengan referensi'}

Buat creative brief yang menggabungkan style referensi dengan kebutuhan produk ini.
Return valid JSON:
{
  "creativeDirection": "arahan kreatif keseluruhan (3-4 kalimat)",
  "visualApproach": "pendekatan visual yang direkomendasikan",
  "adaptedColorScheme": "bagaimana adaptasi warna referensi untuk brand ini",
  "recommendedHook": "hook yang direkomendasikan untuk produk ini",
  "emotionalTrigger": "emotional trigger utama yang harus disampaikan",
  "keyMessage": "pesan utama dalam 1 kalimat kuat",
  "imagePromptContext": "konteks visual untuk image generation prompt (100 kata)"
}`,
      },
    ],
    maxTokens: 800,
    temperature: 0.7,
  });

  try {
    const jsonMatch = blendPrompt.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    return { raw: blendPrompt };
  }
}

/**
 * Generate image prompt dari reference + product info
 */
async function generateAdImagePrompt(referenceAnalysis, productInfo, blendedContext, format = '1:1') {
  const formatLabel = {
    '1:1': 'Facebook/Instagram Feed Square (1080x1080)',
    '9:16': 'Instagram Story / Facebook Story / Reels (1080x1920)',
    '16:9': 'Facebook Feed Landscape (1920x1080)',
    '4:5': 'Instagram Feed Portrait (1080x1350)',
  }[format] || 'Facebook Feed (1:1)';

  const prompt = await chatCompletion({
    model: config.models.chat,
    messages: [
      {
        role: 'system',
        content: 'Kamu adalah expert AI image prompt engineer. Buat prompts yang menghasilkan Meta Ads berkualitas tinggi dan scroll-stopping.',
      },
      {
        role: 'user',
        content: `Buat image generation prompt untuk Meta Ads:

Produk: ${productInfo.productName}
Format: ${formatLabel}
Tujuan: ${productInfo.adGoal || 'conversion'}

Visual Style dari Referensi:
- Style: ${referenceAnalysis.visualStyle || ''}
- Mood: ${referenceAnalysis.mood || ''}
- Lighting: ${referenceAnalysis.lighting || ''}
- Photography: ${referenceAnalysis.photographyStyle || ''}
- Color scheme: Primary ${referenceAnalysis.colorScheme?.primary || ''}, Secondary ${referenceAnalysis.colorScheme?.secondary || ''}
- Layout: ${referenceAnalysis.layout || ''}

Creative Direction:
${blendedContext.imagePromptContext || blendedContext.creativeDirection || ''}

Rules untuk prompt:
1. Mulai dengan: "Meta Ads creative, ${formatLabel}, scroll-stopping, "
2. Include visual style dari referensi secara spesifik
3. Sesuaikan dengan produk: ${productInfo.productName}
4. Include: subject, setting, lighting, color palette, mood, composition
5. JANGAN include teks/tulisan
6. Panjang: 150-200 kata dalam bahasa Inggris

Output HANYA prompt text.`,
      },
    ],
    maxTokens: 400,
    temperature: 0.8,
  });

  return prompt.trim();
}

/**
 * Generate copy/teks iklan berdasarkan product info + reference approach
 */
async function generateAdCopy(productInfo, blendedContext, language = 'id', format = '1:1') {
  const langInstruction = language === 'en'
    ? 'Write all copy in English'
    : language === 'bilingual'
    ? 'Write headline in Indonesian, body in Indonesian, but CTA can be in English or Indonesian'
    : 'Tulis semua copy dalam Bahasa Indonesia yang natural dan relatable';

  const response = await chatCompletion({
    model: config.models.chat,
    messages: [
      {
        role: 'system',
        content: `Kamu adalah copywriter Meta Ads terbaik. ${langInstruction}.`,
      },
      {
        role: 'user',
        content: `Buat copy untuk Meta Ad:

Produk: ${productInfo.productName}
Deskripsi: ${productInfo.description || ''}
USP: ${productInfo.usp || ''}
Target: ${productInfo.targetAudience || 'umum'}
Tujuan: ${productInfo.adGoal || 'conversion'}

Key Message: ${blendedContext.keyMessage || ''}
Hook Rekomendasi: ${blendedContext.recommendedHook || ''}
Emotional Trigger: ${blendedContext.emotionalTrigger || ''}

Format iklan: ${format}

Return valid JSON:
{
  "primaryText": "body copy untuk Meta Ads (max 125 karakter untuk mobile, punchy dan benefit-focused)",
  "headline": "headline iklan (max 40 karakter, scroll-stopping)",
  "description": "description/subheadline (max 30 karakter)",
  "cta": "CTA button text dari pilihan: Shop Now / Learn More / Sign Up / Get Offer / Book Now / Subscribe / Download / Get Quote / Watch More / Apply Now",
  "hashtags": ["#tag1", "#tag2", "#tag3"]
}`,
      },
    ],
    maxTokens: 400,
    temperature: 0.7,
  });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    return { raw: response };
  }
}

/**
 * Generate carousel sequence (Hook → Problem → Solution → Proof → CTA)
 */
async function generateCarouselFromReference(referenceAnalysis, productInfo, blendedContext, slideCount = 5, language = 'id') {
  const slideRoles = [
    { role: 'hook', instruction: 'Slide pertama — hook kuat yang stop scroll, curiosity atau pain point' },
    { role: 'problem', instruction: 'Agitate masalah yang dirasakan target audience' },
    { role: 'solution', instruction: 'Perkenalkan produk sebagai solusi' },
    { role: 'proof', instruction: 'Social proof, testimoni, angka, hasil nyata' },
    { role: 'cta', instruction: 'Call to action yang clear dan urgent' },
  ].slice(0, slideCount);

  const langInstruction = language === 'en' ? 'in English' : 'dalam Bahasa Indonesia';

  const response = await chatCompletion({
    model: config.models.chat,
    messages: [
      {
        role: 'system',
        content: `Kamu adalah Meta Ads carousel specialist. Buat carousel sequence yang mengalir natural dan convert.`,
      },
      {
        role: 'user',
        content: `Buat carousel ${slideCount} slide untuk Meta Ads ${langInstruction}:

Produk: ${productInfo.productName}
Deskripsi: ${productInfo.description || ''}
USP: ${productInfo.usp || ''}
Target: ${productInfo.targetAudience || ''}
Key Message: ${blendedContext.keyMessage || ''}
Visual Style: ${referenceAnalysis.visualStyle || ''}
Mood: ${referenceAnalysis.mood || ''}

Slides yang dibutuhkan:
${slideRoles.map((s, i) => `Slide ${i + 1} (${s.role}): ${s.instruction}`).join('\n')}

Return array JSON valid:
[
  {
    "slideIndex": 1,
    "role": "hook",
    "headline": "headline max 8 kata",
    "subtext": "subtext max 15 kata",
    "cta": "CTA atau null",
    "imageDirection": "arahan visual 20 kata untuk AI image gen"
  }
]`,
      },
    ],
    maxTokens: 1200,
    temperature: 0.8,
  });

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const slides = JSON.parse(jsonMatch[0]);
      // Generate image prompt per slide
      const slidesWithPrompts = await Promise.allSettled(
        slides.map(async (slide) => {
          const imagePrompt = await generateAdImagePrompt(
            referenceAnalysis,
            { ...productInfo, slideContext: `${slide.role}: ${slide.imageDirection}` },
            blendedContext,
            '1:1' // carousel always 1:1
          );
          return { ...slide, imagePrompt };
        })
      );

      return slidesWithPrompts.map((r, i) =>
        r.status === 'fulfilled' ? r.value : { ...slides[i], imagePrompt: null }
      );
    }
  } catch (e) {
    console.warn('Could not parse carousel as JSON');
  }

  return [];
}

module.exports = {
  analyzeReference,
  blendReferenceWithProduct,
  generateAdImagePrompt,
  generateAdCopy,
  generateCarouselFromReference,
};
