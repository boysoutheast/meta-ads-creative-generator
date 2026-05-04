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

  "sceneDetails": {
    "emotionalMoment": "1-2 sentences: what the Indonesian woman is doing, her EXACT expression and body language. Must match the angle's emotional truth (frustrated/distressed for problem angles, relieved/happy for solution angles).",
    "setting": "Specific location and atmosphere (e.g. 'bathroom mirror, soft morning daylight, clean tiles')",
    "keyProps": "List 3-5 specific objects in the scene that tell the story — parallel to winning ad props but relevant to this product context",
    "beforeState": "[before_after angle only] Visual description of the problem state: specific skin condition, texture, expression",
    "afterState": "[before_after angle only] Visual description of the solution state: specific skin condition improvement, expression",
    "timeClaim": "[before_after angle only] Specific time claim shown in image (e.g. '7 hari', '2 minggu')"
  }
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

// ─── buildAngleImagePrompt ───────────────────────────────────────────────────
// Per-angle structured templates — code controls layout/structure,
// GPT fills in scene details. No more free-form imagePromptEN from GPT.

function buildAngleImagePrompt(angle, winningAnalysis, productName, productVisualDescription) {
  const palette    = (winningAnalysis.colorPalette || ['#FADBD8', '#A93226']).join(', ');
  const lighting   = winningAnalysis.lighting  || 'warm natural';
  const mood       = winningAnalysis.mood      || 'engaging';
  const headline   = angle.headline   || '';
  const sub        = angle.subheadline || '';
  const cta        = (angle.cta || 'Coba Sekarang').replace(/^CTA:\s*/i, '');
  const sd         = angle.sceneDetails || {};
  const emotional  = sd.emotionalMoment || 'relatable everyday expression';
  const setting    = sd.setting        || 'clean bright environment';
  const props      = sd.keyProps       || 'product prominently displayed';

  const prodDesc   = productVisualDescription
    ? `${productName} — ${productVisualDescription}`
    : `${productName} pump bottle, tall slim pink bottle, 200ML, pink and white label, pump dispenser top`;

  const quality    = `Photorealistic, high-end skincare editorial photography. Clean, trustworthy, Indonesian lifestyle photography feel. No CGI look. No artificial look. Color palette: ${palette}. ${lighting} lighting. ${mood} mood. Square 1:1 format.`;
  const bpom       = `"BPOM ✓" badge in bottom right corner.`;

  switch (angle.angle) {

    // ── BEFORE & AFTER ──────────────────────────────────────────────────────
    case 'before_after': {
      const beforeState = sd.beforeState || 'skin area looks dry, rough, dull texture, unhealthy';
      const afterState  = sd.afterState  || 'same skin area looks smooth, luminous, visibly hydrated';
      const timeClaim   = sd.timeClaim   || '7 hari';
      return `A clean, modern Meta Ads image in editorial split-screen style. Background: soft pink-cream gradient (#FFF0F5 to #F5F0E8). Square 1:1 format.
TYPOGRAPHY RENDERED ON IMAGE (must be perfectly legible, crisp, no blur):
- Top center: dark pink rounded pill badge with white text "Sebelum vs Sesudah"
- Large bold dark brown text upper area (2-3 lines, centered): "${headline}"
- Bottom smaller text: "${sub}"
- CTA rounded pill button bottom center, dark pink (#D4547A): "${cta} →"
MAIN SCENE:
LEFT HALF "Sebelum": Indonesian woman 25-35yo, ${sd.emotionalMoment || 'concerned/frustrated expression'}, ${beforeState}. Muted warm lighting. Small white pill label "Sebelum" in top left corner.
RIGHT HALF "Sesudah": Same Indonesian woman, smiling softly, ${afterState}. Brighter, warmer lighting. Small white pill label "Sesudah" in top right corner.
DIVIDING ELEMENT: Thin vertical line in the center with a small white circle containing bold text "${timeClaim}".
PRODUCT: ${prodDesc} — placed bottom center overlapping both halves, product is the hero, must be clearly identifiable and well-lit.
FLOATING ELEMENTS: Small pink star/sparkle icons around the sesudah side. Small leaf/natural ingredient icon near product.
${bpom}
${quality}`;
    }

    // ── FOMO / URGENCY ───────────────────────────────────────────────────────
    case 'fomo': {
      return `A clean editorial Meta Ads image. LEFT 55%: large bold typography block on cream/off-white (#FFFBF5) background. RIGHT 45%: photorealistic lifestyle scene. Thin gradient divider between sides. Square 1:1 format.
TYPOGRAPHY ON LEFT SIDE (rendered exactly, must be large, bold, perfectly legible):
- Top left: coral/orange rounded pill badge with white text "⚡ Stok Terbatas"
- Large bold dark brown headline (2-3 lines): "${headline}"
- Smaller body text: "${sub}"
- Orange rounded CTA pill button (bottom left): "${cta} →"
RIGHT SIDE SCENE: Indonesian woman 25-35yo, ${emotional}. Setting: ${setting}. Props: ${props}. Product ${prodDesc} clearly visible in scene.
${bpom}
${quality}`;
    }

    // ── PROBLEM AGITATE ──────────────────────────────────────────────────────
    case 'problem_agitate': {
      return `A clean editorial Meta Ads image. LEFT 55%: large bold typography block on cream/light background. RIGHT 45%: emotional problem scene. Square 1:1 format.
TYPOGRAPHY ON LEFT (rendered exactly, large, perfectly legible):
- Top left: dark rose/red rounded badge "Masalah Nyata"
- Large bold dark headline (2-3 lines): "${headline}"
- Smaller body text: "${sub}"
- Dark pink CTA pill button (bottom left): "${cta} →"
RIGHT SIDE SCENE: Indonesian woman 25-35yo, ${emotional}. Setting: ${setting}. Props showing the problem: ${props}. Product ${prodDesc} shown as the solution at bottom of scene, clearly visible.
${bpom}
${quality}`;
    }

    // ── CURIOSITY GAP ────────────────────────────────────────────────────────
    case 'curiosity_gap': {
      return `A clean editorial Meta Ads image. LEFT 55%: large bold typography with mystery/question hook on cream background. RIGHT 45%: intriguing lifestyle scene. Square 1:1 format.
TYPOGRAPHY ON LEFT (rendered exactly, large, perfectly legible):
- Top left: teal/dark green rounded badge "Tahukah kamu?"
- Large bold dark question headline (2-3 lines): "${headline}"
- Teaser body text: "${sub}"
- CTA pill button (bottom left): "${cta} →"
RIGHT SIDE SCENE: Indonesian woman 25-35yo, ${emotional}. Setting: ${setting}. Props: ${props}. Product ${prodDesc} clearly visible, looking intriguing/inviting.
${bpom}
${quality}`;
    }

    // ── SOCIAL PROOF ─────────────────────────────────────────────────────────
    case 'social_proof': {
      return `A clean testimonial-style Meta Ads image. TOP SECTION: star rating + headline. CENTER: lifestyle scene with satisfied customer. BOTTOM: product + CTA. Square 1:1 format.
TYPOGRAPHY RENDERED ON IMAGE (perfectly legible):
- Top center: gold star rating "⭐⭐⭐⭐⭐" with text "1000+ Pelanggan Puas"
- Bold dark headline (2 lines, centered): "${headline}"
- Subtext: "${sub}"
- Dark pink CTA pill button bottom center: "${cta} →"
MAIN SCENE: Indonesian woman 25-35yo, ${emotional}. Setting: ${setting}. Props: ${props}. Before/after skin comparison circles visible as overlay elements.
PRODUCT: ${prodDesc} — hero product bottom center, clearly identifiable.
${bpom}
${quality}`;
    }

    // ── TUTORIAL / HOW-TO ────────────────────────────────────────────────────
    case 'tutorial': {
      return `A clean informational Meta Ads image with step-by-step layout. TOP: badge + headline. MIDDLE: 3-step card row with numbered steps. BOTTOM: product + CTA. Square 1:1 format.
TYPOGRAPHY RENDERED ON IMAGE (perfectly legible):
- Top center: teal/green rounded pill badge "Cara Pakai"
- Bold dark headline (1-2 lines, centered): "${headline}"
- STEP 1 card: circle with "1" + short instruction text
- STEP 2 card: circle with "2" + short instruction text
- STEP 3 card: circle with "3" + short instruction text
- CTA pill button bottom center: "${cta} →"
BACKGROUND SCENE: Indonesian woman 25-35yo, ${emotional}. Setting: ${setting}. Props: ${props}. Soft, instructional, calm atmosphere.
PRODUCT: ${prodDesc} — shown being applied/used in one of the step cards. Clearly identifiable.
${bpom}
${quality}`;
    }

    // ── PRICE ANCHOR ─────────────────────────────────────────────────────────
    case 'price_anchor': {
      return `A clean value-proposition Meta Ads image. LEFT 55%: price comparison typography on cream background. RIGHT 45%: product showcase scene. Square 1:1 format.
TYPOGRAPHY ON LEFT (rendered exactly, large, perfectly legible):
- Top: green/teal badge "Hemat Sekarang"
- Bold dark headline (2 lines): "${headline}"
- Price comparison (large, bold): crossed-out higher price → actual discounted price in dark pink
- Subtext: "${sub}"
- Green/orange CTA pill button: "${cta} →"
RIGHT SIDE SCENE: Indonesian woman 25-35yo, ${emotional}. Setting: ${setting}. Props: ${props}. Product ${prodDesc} prominently displayed, large and clear.
${bpom}
${quality}`;
    }

    // ── AUTHORITY / EXPERT ───────────────────────────────────────────────────
    case 'authority': {
      return `A clean authority/expert-style Meta Ads image. Professional, trustworthy aesthetic. LEFT 55%: credentials + headline typography. RIGHT 45%: confident professional scene. Square 1:1 format.
TYPOGRAPHY ON LEFT (rendered exactly, large, perfectly legible):
- Top: dark blue/professional badge "Direkomendasikan Dokter" or "Terbukti Klinis"
- Bold authoritative headline (2 lines): "${headline}"
- Credential subtext: "${sub}"
- Dark professional CTA pill button: "${cta} →"
RIGHT SIDE SCENE: Indonesian woman professional/confident 25-40yo, ${emotional}. Setting: ${setting}. Props: ${props}. Product ${prodDesc} presented as the endorsed, certified product.
TRUST OVERLAY ELEMENTS: BPOM badge, certification icon, 5-star badge as floating overlays.
${quality}`;
    }

    // ── DEFAULT FALLBACK ─────────────────────────────────────────────────────
    default: {
      return `A clean editorial Meta Ads image. LEFT 55%: large bold typography on cream (#FFFBF5) background. RIGHT 45%: lifestyle scene. Square 1:1 format.
TYPOGRAPHY ON LEFT (rendered exactly, large, perfectly legible):
- Bold dark headline (2-3 lines): "${headline}"
- Subtext: "${sub}"
- Dark pink CTA pill button bottom left: "${cta} →"
RIGHT SCENE: Indonesian woman 25-35yo, ${emotional}. Setting: ${setting}. Props: ${props}. Product ${prodDesc} clearly visible.
${bpom}
${quality}`;
    }
  }
}

// ─── generateVariationPrompts ─────────────────────────────────────────────────
// Uses per-angle template builder — no free-form GPT prompt, no text overlay append.

async function generateVariationPrompts(winningAnalysis, angles, productName, productVisualDescription = null) {
  return angles.map((angle) => {
    const imagePrompt = buildAngleImagePrompt(angle, winningAnalysis, productName, productVisualDescription);
    return { ...angle, imagePrompt };
  });
}

// ─── batchGenerateImages ──────────────────────────────────────────────────────
// productImageUrl: if provided → flux-kontext-pro (img2img, product accuracy)
// no productImageUrl → gpt-image-2 (text rendering, scene quality)

async function batchGenerateImages(variations, aspectRatio = '1:1', referenceImageUrls = []) {
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
        referenceImages: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
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
