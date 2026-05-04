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

  // ── Format winning ad DNA as human-readable "contoh" block, not raw JSON ──
  const ns = winningAnalysis.narrativeStructure || {};
  const palette = (winningAnalysis.colorPalette || []).join(', ') || 'tidak diketahui';
  const winningAdBlock = `
━━━━ CONTOH IKLAN WINNING — DNA YANG AKAN KAMU REPLIKASI ━━━━

HOOK (cara mencuri atensi 1-3 detik pertama):
${winningAnalysis.hookMechanism || winningAnalysis.hook || 'Tidak tersedia'}

SKENARIO MANUSIA (situasi spesifik yang ditampilkan, kenapa orang merasa "ini gue banget"):
${winningAnalysis.humanScenario || 'Tidak tersedia'}

KEBENARAN EMOSIONAL (rasa takut / harapan / malu spesifik yang disentuh):
${winningAnalysis.emotionalTruth || 'Tidak tersedia'}

ALUR NARASI:
• Setup (situasi masalah): ${ns.setup || 'Tidak tersedia'}
• Tension (kenapa ini menyakitkan/penting): ${ns.tension || 'Tidak tersedia'}
• Resolution (solusi / harapan): ${ns.resolution || 'Tidak tersedia'}

VISUAL STORY (objek, ekspresi, setting yang "bercerita" tanpa kata):
${winningAnalysis.visualStory || 'Tidak tersedia'}

COPY PATTERN (formula teks yang dipakai):
${winningAnalysis.copyPattern || 'Tidak tersedia'}

CETAK BIRU REPLIKASI (instruksi cara replikasi untuk produk berbeda):
${winningAnalysis.replicationBlueprint || 'Tidak tersedia'}

VISUAL DNA:
• Style: ${winningAnalysis.visualStyle || 'professional, clean'}
• Lighting: ${winningAnalysis.lighting || 'natural, warm'}
• Color palette: ${palette}
• Mood: ${winningAnalysis.mood || 'engaging'}
• Composition: ${winningAnalysis.composition || 'centered'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`.trim();

  // ── Product context — the richer, the better ──
  const productBlock = `
━━━━ PRODUKMU — TARGET TRANSLATE ━━━━
Nama produk: ${productName}
${productDescription ? `\nDeskripsi lengkap produk:\n${productDescription}` : ''}
${productVisualDescription ? `\nTampilan visual produk (dari foto):\n${productVisualDescription}` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`.trim();

  const systemPrompt = `Kamu adalah Meta Ads creative director kelas dunia yang ahli dalam "concept translation" — proses mengambil DNA dari satu iklan winning dan mentranslate-nya secara presisi ke produk yang berbeda. Ini bukan tentang meniru secara visual, tapi mengambil MEKANISME yang membuat iklan itu berhasil (hook, emosi, alur cerita) dan mengaplikasikannya ke konteks produk baru.

Tugas kamu adalah membaca iklan winning dengan sangat cermat, memahami MENGAPA ia berhasil (bukan hanya APA yang ada di dalamnya), lalu menciptakan versi baru untuk produk target yang memiliki daya tarik yang sama kuatnya. Prinsip terpenting: pertahankan mekanisme, ganti konteks.

ATURAN TIDAK BISA DILANGGAR:
1. Semua copy (headline, subheadline, bodyText, cta) WAJIB Bahasa Indonesia — tidak ada pengecualian.
2. Jika deskripsi produk menyebut ingredient spesifik (misal: Shea Butter 5%, Inoceramide, Hyaluronic Acid 3%), kondisi target (diabetes, kulit kering parah), atau klaim unik — HARUS muncul di copy. Copy generik ("kulit sehat") = GAGAL. Copy spesifik ("kulit diabetik yang pecah-pecah minta Inoceramide") = BERHASIL.
3. imagePromptEN HARUS dimulai dengan: "Indonesian woman, Southeast Asian features, relatable everyday person, " — tidak ada variasi, tidak ada karakter lain.
4. Intensitas emosional gambar HARUS setara dengan winning ad. Hook/problem angle → ekspresi distressed/frustrated. Resolution angle → ekspresi lega/bahagia. JANGAN buat foto produk biasa, buat SCENE yang bercerita.
5. Produk HARUS terlihat jelas di gambar — deskripsikan tampilannya sedetail mungkin berdasarkan tampilan visual produk yang diberikan.`;

  const userPrompt = `${winningAdBlock}

${productBlock}

ANGLE YANG DIMINTA: ${anglesToGenerate.join(', ')}

━━━━ INSTRUKSI TRANSLATE ━━━━

Untuk SETIAP angle yang diminta, kamu harus melakukan proses 3 langkah ini:

LANGKAH 1 — DECODE: Baca ulang "Cetak Biru Replikasi" dan "Hook" dari iklan winning. Identifikasi: apa mekanisme spesifik yang membuat orang berhenti scroll? Apa kebenaran universal yang disentuh?

LANGKAH 2 — ADAPT: Terjemahkan mekanisme itu ke konteks produk target. Pertahankan: hook mechanism (cara mencuri atensi), emotional truth (jenis rasa takut/harapan), narrative arc (setup→tension→resolution). Ganti: skenario, objek, referensi spesifik → sesuaikan ke produk ini. WAJIB sebutkan ingredient/klaim spesifik dari deskripsi produk.

LANGKAH 3 — VISUALIZE: Buat scene gambar yang PARALEL dengan winning ad. Jika winning ad menampilkan seorang frustrasi dikelilingi props masalahnya → gambar harus menampilkan perempuan Indonesia dengan ekspresi sama, dikelilingi props masalah yang relevan ke produk ini. SAMA komposisi dan intensitas emosinya, BEDA konteksnya. Embed visual produk yang sudah dideskripsikan ke dalam scene.

Untuk tiap angle, return objek JSON dengan field BERIKUT (isi sedetail mungkin, minimum 2-3 kalimat untuk translatedConcept):
{
  "angle": "angle_key",

  "translatedConcept": "Penjelasan 2-3 paragraf: (1) Apa yang dipertahankan dari winning ad dan mengapa berhasil. (2) Bagaimana konsep itu ditranslate ke produk ini secara spesifik — skenario apa, emosi apa, hook apa. (3) Apa yang beda dan mengapa pilihan itu tepat untuk produk ini.",

  "headline": "Headline max 8 kata, scroll-stopping, mirror hook dari winning ad tapi untuk konteks produk — BAHASA INDONESIA",

  "subheadline": "Subheadline max 15 kata, perkuat headline dengan detail spesifik produk (ingredient/kondisi target jika ada) — BAHASA INDONESIA",

  "bodyText": "Body copy max 40 kata. WAJIB sebutkan minimal 1 ingredient/klaim spesifik dari deskripsi produk. Ikuti narrative arc: setup (masalah) → tension (kenapa menyakitkan) → resolution (produk ini solusinya, sebutkan spesifik kenapa) — BAHASA INDONESIA",

  "cta": "CTA max 4 kata, action-oriented — BAHASA INDONESIA",

  "imageScenario": "Deskripsikan scene gambar dalam Bahasa Indonesia (3-4 kalimat): siapa orangnya (perempuan Indonesia, usia berapa, sedang apa), di mana, ekspresi wajah dan bahasa tubuh (HARUS cerminkan intensitas emosional winning ad), objek/props apa yang ada di sekitarnya yang menceritakan masalah/solusi, dan bagaimana produk ini terlihat dalam scene tersebut.",

  "imagePromptEN": "MUST start with: Indonesian woman, Southeast Asian features, relatable everyday person, [then continue]. This is a cinematic Meta Ads image prompt (150-200 words). CRITICAL: No text, words, letters, or numbers in image. Include ALL of: (1) Subject: Indonesian woman [age], [specific expression matching winning ad: distressed/frustrated/relieved], [exact action], [clothing that fits the scene]. (2) Setting: [specific location], [time of day], [atmosphere]. (3) Props: [list every object in the scene that tells the story — parallel to winning ad props but in product context]. (4) Product: [exact visual description of ${productName} as described — ${productVisualDescription || `the product ${productName} clearly visible and identifiable`}], product is prominently featured. (5) Visual DNA from winning ad: ${winningAnalysis.lighting || 'natural warm'} lighting, color tones of [${palette}], ${winningAnalysis.mood || 'engaging'} mood, ${winningAnalysis.composition || 'centered'} composition, ${winningAnalysis.visualStyle || 'photorealistic, professional'}. (6) Camera: [angle and framing]. Photorealistic, high detail, no CGI look."
}

Return array JSON valid dengan TEPAT ${anglesToGenerate.length} item. Tanpa markdown, tanpa komentar, langsung array.`;

  const response = await chatCompletion({
    model: config.models.chat,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    maxTokens: 6000,
    temperature: 0.75,
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

// ─── appendTextOverlayToPrompt ───────────────────────────────────────────────
// Appends text rendering instruction to image prompt.
// gpt-image-2 excels at rendering legible text on images — use this superpower.

function appendTextOverlayToPrompt(prompt, headline, cta) {
  if (!headline) return prompt;
  const ctaPart = cta ? ` and an orange rounded pill button with bold white text "${cta.replace(/^CTA:\s*/i, '')}"` : '';
  return prompt + ` The image has a dark gradient overlay at the bottom third. Overlaid on this gradient, in large bold white sans-serif typography, the headline text reads exactly: "${headline}"${ctaPart}. Text must be perfectly legible, no blur, no distortion.`;
}

// ─── generateVariationPrompts ─────────────────────────────────────────────────

async function generateVariationPrompts(winningAnalysis, angles, productName, productVisualDescription = null) {
  return angles.map((angle) => {
    const rawPrompt = angle.imagePromptEN
      || buildFallbackPrompt(angle, winningAnalysis, productName, productVisualDescription);
    const withPrefix = ensureIndonesianPrefix(rawPrompt);
    // Bake the actual headline + CTA text into the image prompt
    const imagePrompt = appendTextOverlayToPrompt(withPrefix, angle.headline, angle.cta);
    return { ...angle, imagePrompt };
  });
}

// ─── batchGenerateImages ──────────────────────────────────────────────────────
// productImageUrl: if provided → flux-kontext-pro (img2img, product accuracy)
// no productImageUrl → gpt-image-2 (text rendering, scene quality)

async function batchGenerateImages(variations, aspectRatio = '1:1', productImageUrl = null) {
  const sizeMap = {
    '1:1': '1024x1024',
    '9:16': '1024x1536',
    '16:9': '1536x1024',
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
