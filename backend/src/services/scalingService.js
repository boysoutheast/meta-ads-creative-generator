const { analyzeImage, chatCompletion, generateImage } = require('./apimart');
const config = require('../config');
const fs = require('fs');

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

// ─── analyzeWinningAd ────────────────────────────────────────────────────────
// Extract 7 deep dimensions — not just surface labels.
// This is the DNA extraction step that makes concept translation possible.

async function analyzeWinningAd(filePath) {
  const imageBuffer = fs.readFileSync(filePath);
  const imageBase64 = imageBuffer.toString('base64');
  const mimeType = 'image/jpeg';

  const analysisPrompt = `Kamu adalah Meta Ads creative strategist kelas dunia. Analisis iklan ini secara SANGAT MENDALAM.
Tujuan: ekstrak "DNA" dari iklan ini sehingga konsepnya bisa direplikasi untuk produk berbeda.

Analisis 7 dimensi berikut, return dalam format JSON valid:

1. HUMAN_SCENARIO: Skenario manusia spesifik yang digambarkan. Bukan "orang pakai produk" tapi detail situasinya — siapa orangnya, sedang apa, ada di mana, apa yang terjadi. Ini yang membuat orang berhenti scroll karena merasa "ini tentang aku".

2. EMOTIONAL_TRUTH: Kebenaran emosional universal yang disentuh. Rasa takut, malu, harapan, atau keinginan spesifik apa? Bukan emosi generik, tapi yang sangat spesifik ke situasi yang ditampilkan.

3. HOOK_MECHANISM: Bagaimana tepatnya iklan ini "mencuri" perhatian di 1-3 detik pertama? Apa element pertama yang mata lihat? Mengapa itu bikin penasaran atau berhenti scroll?

4. NARRATIVE_STRUCTURE: Alur cerita/pesan: Setup (situasi masalah) → Tension (kenapa ini penting/menyakitkan) → Resolution (solusi/harapan). Deskripsikan tiap tahap secara spesifik.

5. VISUAL_STORY: Objek-objek, ekspresi, setting spesifik yang "menceritakan" pesan tanpa kata. Apa yang ada di frame dan kenapa itu dipilih? Komposisi, lighting, warna — semua punya makna, jelaskan.

6. COPY_PATTERN: Formula copy yang dipakai. Bukan hanya "problem-agitate" tapi pola spesifiknya: opening word choice, structure, tone, how it creates urgency.

7. REPLICATION_BLUEPRINT: Instruksi singkat cara replikasi konsep ini untuk produk skincare/kesehatan. Apa yang harus dipertahankan (hook mechanism, emotional truth, narrative arc, visual style) dan apa yang diganti (skenario, objek, produk).

Return HANYA valid JSON tanpa markdown, tanpa penjelasan:
{
  "humanScenario": "...",
  "emotionalTruth": "...",
  "hookMechanism": "...",
  "narrativeStructure": { "setup": "...", "tension": "...", "resolution": "..." },
  "visualStory": "...",
  "copyPattern": "...",
  "replicationBlueprint": "...",
  "visualStyle": "...",
  "colorPalette": ["#hex1", "#hex2", "#hex3"],
  "lighting": "...",
  "mood": "...",
  "composition": "...",
  "dominantAngle": "fomo",
  "format": "Feed/Story/Reels",
  "primaryEmotion": "...",
  "suggestedCopyLanguage": "id"
}`;

  const analysisRaw = await analyzeImage({ imageBase64, mimeType, prompt: analysisPrompt });

  try {
    const jsonMatch = analysisRaw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      parsed.suggestedCopyLanguage = 'id';
      // Backward compat: map hookMechanism → hook for AnalysisCard
      if (!parsed.hook && parsed.hookMechanism) {
        parsed.hook = parsed.hookMechanism;
      }
      return parsed;
    }
  } catch (e) {
    console.warn('Could not parse winning ad analysis as JSON, returning raw');
  }

  return { raw: analysisRaw, suggestedCopyLanguage: 'id' };
}

// ─── generateScalingAngles ───────────────────────────────────────────────────
// CONCEPT TRANSLATION — not template application.
// Takes the winning ad's hook/scenario/emotional truth and translates it
// specifically to the user's product context.
// Critically: generates imagePromptEN inline so no extra API calls needed.

async function generateScalingAngles(
  winningAnalysis,
  productName,
  selectedAngles = [],
  productVisualDescription = null,
  productDescription = null,
) {
  const anglesToGenerate = selectedAngles.length > 0
    ? selectedAngles
    : Object.keys(SCALING_ANGLES);

  const systemPrompt = `Kamu adalah Meta Ads creative strategist yang ahli "concept translation" — mengambil DNA dari iklan winning dan mengadaptasinya untuk produk yang berbeda.

PRINSIP UTAMA: Jangan buat iklan generik. Translate SPESIFIK konsep dari winning ad ke konteks produk ini. Pertahankan: hook mechanism, emotional truth, narrative structure. Ganti: skenario, objek, konteks — sesuaikan ke produk.

PENTING: Semua copy (headline, subheadline, bodyText, cta) HARUS Bahasa Indonesia. Jangan gunakan Bahasa Inggris untuk teks iklan.

CRITICAL untuk imageScenario dan imagePromptEN:
1. Subjek SELALU perempuan Indonesia/Asia Tenggara (Indonesian woman, Southeast Asian features).
2. Scene HARUS cerminkan komposisi dan intensitas emosional winning ad. Jika winning ad menampilkan orang frustrasi dikelilingi props masalah (kertas, kalkulator, dll) → scene harus menampilkan perempuan Indonesia dengan ekspresi sama frustrasi/khawatir dikelilingi props masalah yang relevan ke produk (botol skincare lama, kulit kering, cermin, dll). SAME emotional intensity, SAME composition type, DIFFERENT product context.
3. JANGAN buat scene netral/bahagia kecuali itu angle "after" atau "resolution". Hook/problem angle HARUS distressed/frustrated expression.
4. imagePromptEN HARUS dimulai dengan: "Indonesian woman, Southeast Asian features, relatable everyday person, "`;

  // Build product context block — the richer this is, the better the copy
  const productContextBlock = [
    `PRODUK: ${productName}`,
    productDescription
      ? `DESKRIPSI LENGKAP PRODUK (WAJIB dipakai dalam copy — sebutkan ingredient spesifik, manfaat unik, dan klaim yang membedakan):\n${productDescription}`
      : '',
    productVisualDescription
      ? `Visual produk: ${productVisualDescription}`
      : '',
  ].filter(Boolean).join('\n\n');

  const userPrompt = `WINNING AD ANALYSIS:
${JSON.stringify(winningAnalysis, null, 2)}

${productContextBlock}

ANGLE YANG DIMINTA: ${anglesToGenerate.join(', ')}

TUGAS:
Untuk tiap angle, buat copy iklan yang:
1. Menggunakan hook mechanism yang SAMA dengan winning ad (cara menarik perhatian di 3 detik pertama)
2. Menyentuh emotional truth yang SAMA tapi diaplikasikan ke konteks produk ini
3. Mengikuti narrative structure yang SAMA (setup→tension→resolution) tapi untuk skenario produk ini
4. BUKAN menggunakan template angle generik — translate konsep winning ad secara spesifik
5. WAJIB: Jika deskripsi produk menyebut ingredient spesifik (misal: Shea Butter 5%, Inoceramide, dll), manfaat klinis, atau kondisi target (diabetes, kulit kering parah, dll) — HARUS muncul di bodyText atau subheadline. Copy yang generik ("kulit kering") dinilai GAGAL. Copy yang spesifik ("kulit diabetik yang pecah-pecah") dinilai BERHASIL.

Contoh cara berpikir:
- Winning ad: orang frustrasi tidak tahu angka bisnisnya (hook: "kamu melakukan kesalahan tanpa sadar")
- Produk skincare diabetes: orang tidak sadar kulitnya butuh perawatan khusus (hook: "kamu merawat kulit dengan cara yang salah selama ini")
- Sama hooknya, berbeda konteksnya — dan copy HARUS sebutkan manfaat spesifik produk (Inoceramide, Shea Butter, dll)

Untuk tiap angle, return:
{
  "angle": "angle_key",
  "translatedConcept": "penjelasan 1 paragraf: bagaimana konsep winning ad ditranslate ke produk ini untuk angle ini",
  "headline": "headline max 8 kata, scroll-stopping — BAHASA INDONESIA",
  "subheadline": "subheadline max 15 kata — BAHASA INDONESIA",
  "bodyText": "body copy max 30 kata — BAHASA INDONESIA",
  "cta": "CTA max 4 kata — BAHASA INDONESIA",
  "imageScenario": "Skenario visual spesifik untuk gambar: siapa, sedang apa, di mana, ekspresi, objek di sekitarnya — harus PARALEL dengan skenario winning ad tapi untuk konteks produk (50 kata, Indonesian). WAJIB: perempuan Indonesia/Asia Tenggara.",
  "imagePromptEN": "MUST start with: Indonesian woman, Southeast Asian features, relatable everyday person, [then continue with scene]. Detail image prompt (80-150 kata). CRITICAL: No text/words/typography in image. Highly specific and cinematic. Include: subject with distressed/concerned/emotional expression matching winning ad emotional intensity, action, setting, lighting matching winning ad style (${winningAnalysis.lighting || 'natural'}), color palette (${(winningAnalysis.colorPalette || []).join(', ')}), mood (${winningAnalysis.mood || 'engaging'}), camera angle, composition. Product ${productName} must be clearly visible. Surrounded by props relevant to the problem."
}

Return array JSON valid dengan tepat ${anglesToGenerate.length} item. Tanpa markdown, tanpa komentar.`;

  const response = await chatCompletion({
    model: config.models.chat,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    maxTokens: 3500,
    temperature: 0.8,
  });

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.warn('Could not parse scaling angles as JSON:', e.message);
  }

  return [];
}

// ─── Indonesian person prefix ─────────────────────────────────────────────────
// Prepended to EVERY image prompt — non-negotiable.
const INDONESIAN_PERSON_PREFIX = 'Indonesian woman, Southeast Asian features, relatable everyday person, ';

function ensureIndonesianPrefix(prompt) {
  if (!prompt) return INDONESIAN_PERSON_PREFIX;
  const lower = prompt.toLowerCase();
  // If AI already followed the instruction, don't double-prepend
  if (lower.startsWith('indonesian woman') || lower.startsWith('indonesian ')) return prompt;
  return INDONESIAN_PERSON_PREFIX + prompt;
}

// ─── buildFallbackPrompt ─────────────────────────────────────────────────────
// Only used when imagePromptEN is missing (shouldn't happen with new pipeline).

function buildFallbackPrompt(angle, winningAnalysis, productName, productVisualDescription) {
  const conceptContext = angle.translatedConcept
    ? `Translated concept: ${angle.translatedConcept}\nScene to depict: ${angle.imageScenario || ''}`
    : `Image direction: ${angle.imageDirection || ''}`;

  const base = [
    `distressed expression, surrounded by product-related props, Meta Ads creative, ${winningAnalysis.visualStyle || 'professional, clean'}.`,
    conceptContext,
    `Product: ${productName} — must be clearly visible and recognizable.`,
    productVisualDescription ? `Product looks like: ${productVisualDescription}` : '',
    `Maintain winning ad visual DNA: ${(winningAnalysis.colorPalette || []).join(', ')} color palette,`,
    `${winningAnalysis.lighting || 'natural'} lighting, ${winningAnalysis.mood || 'engaging'} mood,`,
    `${winningAnalysis.composition || 'centered'} composition.`,
    'NO text, words, numbers, or typography in image.',
    'Highly detailed, photorealistic, Meta Ads format.',
  ].filter(Boolean).join('\n').trim();

  return INDONESIAN_PERSON_PREFIX + base;
}

// ─── generateVariationPrompts ─────────────────────────────────────────────────
// Now SYNCHRONOUS — no extra API calls needed.
// generateScalingAngles already inlines imagePromptEN in the same call.
// This collapses what used to be N+1 API calls into just 1.
// Always enforces Indonesian person prefix regardless of AI compliance.

async function generateVariationPrompts(winningAnalysis, angles, productName, productVisualDescription = null) {
  return angles.map((angle) => {
    const rawPrompt = angle.imagePromptEN
      || buildFallbackPrompt(angle, winningAnalysis, productName, productVisualDescription);
    const imagePrompt = ensureIndonesianPrefix(rawPrompt);
    return { ...angle, imagePrompt };
  });
}

// ─── batchGenerateImages ──────────────────────────────────────────────────────
// productImageUrl: public URL from uploadImageToApimart → used for flux-kontext-pro reference

async function batchGenerateImages(variations, aspectRatio = '1:1', productImageUrl = null) {
  const sizeMap = {
    '1:1': '1024x1024',
    '9:16': '1024x1792',
    '16:9': '1792x1024',
    '4:5': '1024x1024',
  };
  const size = sizeMap[aspectRatio] || '1024x1024';

  const filteredVariations = variations.filter((v) => v.imagePrompt);
  const results = await Promise.allSettled(
    filteredVariations.map((v) =>
      generateImage({
        prompt: v.imagePrompt,
        size,
        imageUrl: productImageUrl || undefined,
      })
    )
  );

  let filteredIdx = 0;
  return variations.map((v) => {
    if (!v.imagePrompt) return { ...v, imageUrl: null, imageError: 'No prompt generated' };
    const result = results[filteredIdx++];
    return {
      ...v,
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
