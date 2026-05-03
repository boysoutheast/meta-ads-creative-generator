const { chatCompletion } = require('./apimart');
const config = require('../config');

/**
 * Generate AI prompt for image/video ad creative
 */
async function generateAdPrompt({
  productName,
  slideRole,         // 'hook', 'problem', 'solution', 'proof', 'cta'
  slideIndex,
  totalSlides,
  visualStyle,       // 'daily-social', 'professional', 'minimalist', 'bold', 'lifestyle'
  contentType,       // 'carousel' | 'single'
  format,            // 'penjelasan singkat', 'tips', 'fakta', etc.
  platform = 'Meta Ads',
  aspectRatio = '1:1',
  productDescription = '',
  referenceAnalysis = '',   // result from video/image reference analysis
  brandColors = '',
  language = 'id',          // 'id' = Bahasa Indonesia, 'en' = English
}) {
  const slideRoleMap = {
    hook: 'Hook / Attention grabber - menarik perhatian di 1 detik pertama',
    problem: 'Problem - menggambarkan masalah yang dirasakan target audience',
    solution: 'Solution - menampilkan produk/jasa sebagai solusi',
    proof: 'Social Proof / Testimonial - menampilkan bukti nyata / hasil',
    cta: 'Call-to-Action - mendorong audience untuk take action sekarang',
  };

  const stylePromptMap = {
    'daily-social': 'konten daily sosial media yang relatable, candid, authentic, warm colors, real people',
    professional: 'professional corporate, clean layout, premium feel, sophisticated typography',
    minimalist: 'minimalist design, lots of white space, simple typography, elegant',
    bold: 'bold colorful design, high contrast, energetic, attention-grabbing, Gen-Z aesthetic',
    lifestyle: 'lifestyle photography, aspirational, warm tones, real-life setting',
  };

  const systemPrompt = `Kamu adalah seorang expert Meta Ads creative director dan prompt engineer untuk AI image/video generation.
Tugas kamu: buat detailed image generation prompt dalam bahasa Inggris yang akan menghasilkan visual iklan berkualitas tinggi untuk ${platform}.

Rules:
- Prompt harus detail, spesifik, dan visual
- Fokus pada komposisi, lighting, mood, dan elemen visual
- Sertakan style direction yang sesuai
- Hindari text/typography dalam prompt (teks akan ditambahkan secara terpisah)
- Selalu sertakan: subject, setting, mood, lighting, color palette, style
- Format: satu paragraf deskriptif, bukan bullet points
- Panjang: 100-200 kata`;

  const userPrompt = `Buat image generation prompt untuk iklan ini:

**Produk/Topik:** ${productName}
${productDescription ? `**Deskripsi:** ${productDescription}` : ''}
**Platform:** ${platform} (${aspectRatio} ratio)
**Slide ${slideIndex}/${totalSlides}:** ${slideRoleMap[slideRole] || slideRole}
**Visual Style:** ${stylePromptMap[visualStyle] || visualStyle}
**Format Konten:** ${format}
${brandColors ? `**Warna Brand:** ${brandColors}` : ''}
${referenceAnalysis ? `\n**Referensi Visual dari user:**\n${referenceAnalysis}` : ''}

Generate HANYA image prompt dalam bahasa Inggris. Jangan tambahkan penjelasan lain.`;

  const prompt = await chatCompletion({
    model: config.models.chat,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    maxTokens: 500,
    temperature: 0.8,
  });

  return prompt.trim();
}

/**
 * Generate text overlay / copywriting untuk slide
 */
async function generateSlideCopy({
  productName,
  slideRole,
  visualStyle,
  contentFormat,
  productDescription = '',
  language = 'id',
}) {
  const systemPrompt = `Kamu adalah copywriter ahli untuk Meta Ads dan konten sosial media.
Buat teks/copy untuk slide iklan yang singkat, powerful, dan persuasif.
Gunakan bahasa ${language === 'id' ? 'Indonesia yang casual dan relatable' : 'English'}.`;

  const userPrompt = `Buat copy/teks untuk slide iklan:

**Produk:** ${productName}
${productDescription ? `**Deskripsi:** ${productDescription}` : ''}
**Role slide:** ${slideRole}
**Format:** ${contentFormat}
**Style:** ${visualStyle}

Response dalam format JSON:
{
  "headline": "judul utama (max 8 kata, impactful)",
  "subtext": "teks pendukung (max 20 kata)",
  "cta": "call-to-action button text (jika relevan, max 4 kata, atau null)"
}`;

  const response = await chatCompletion({
    model: config.models.chat,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    maxTokens: 300,
    temperature: 0.7,
  });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    // fallback
  }

  return {
    headline: productName,
    subtext: '',
    cta: null,
  };
}

module.exports = { generateAdPrompt, generateSlideCopy };
