const { analyzeImage, chatCompletion, generateImage, generateVideo, getTask, uploadImageToApimart, submitImageJobPayload, GPT_IMAGE_SIZE_MAP } = require('./apimart');
const config = require('../config');
const fs = require('fs');

const SCALING_ANGLES = {
  // ── Original 8 ────────────────────────────────────────────────────────────
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
  // ── New 12 ────────────────────────────────────────────────────────────────
  ingredient_spotlight: {
    label: 'Ingredient Spotlight',
    hook: 'Sorot bahan aktif kunci — "mengandung X yang terbukti...", edukasi bahan',
  },
  result_speed: {
    label: 'Result Speed',
    hook: 'Hasil cepat terasa — "dalam 7 hari", "langsung terasa", kecepatan result nyata',
  },
  comparison: {
    label: 'Comparison',
    hook: 'Perbandingan langsung vs kompetitor / solusi lama / tanpa produk ini',
  },
  lifestyle_aspiration: {
    label: 'Lifestyle Aspiration',
    hook: 'Gaya hidup impian — identitas diri, "perempuan yang...", aspirasi hidup',
  },
  community_proof: {
    label: 'Community Proof',
    hook: 'Komunitas & peer — "jutaan orang sudah...", viral, trending, ramai dibicarakan',
  },
  gift_occasion: {
    label: 'Gift / Occasion',
    hook: 'Hadiah & momen spesial — lebaran, ulang tahun, hari ibu, anniversary',
  },
  expert_tip: {
    label: 'Expert Tip',
    hook: 'Tips dari ahli / profesional — dokter, skincare expert, nutritionist, influencer',
  },
  value_stack: {
    label: 'Value Stack',
    hook: 'Nilai bertumpuk — "dapat X + Y + Z dalam satu produk", bonus, bundling hemat',
  },
  pain_point_extreme: {
    label: 'Pain Point Extreme',
    hook: 'Nyeri/masalah paling ekstrim — konsekuensi buruk jika tidak segera bertindak',
  },
  seasonal: {
    label: 'Seasonal / Trend',
    hook: 'Momen relevan saat ini — lebaran, year-end, musim hujan, liburan, trending topic',
  },
  unboxing: {
    label: 'Unboxing Experience',
    hook: 'Pengalaman unboxing — kemasan premium, kejutan, first impression produk',
  },
  night_routine: {
    label: 'Night / Morning Routine',
    hook: 'Rutinitas self-care — "sebelum tidur...", "bangun pagi dengan...", ritual harian',
  },
};

// ─── detectPersona ───────────────────────────────────────────────────────────
// Reads product description + name and returns an appropriate character
// descriptor for image generation. Prevents hardcoded "Indonesian woman 25-35yo"
// from being used for products targeting elderly, diabetic, male, or child audiences.

function detectPersona(productDescription = '', productName = '') {
  const text = (productDescription + ' ' + productName).toLowerCase();

  // Diabetes / blood sugar — 50-60yo, male or female
  if (/diabe[st]|diabetik|gula darah|diabetes/.test(text)) {
    return 'Indonesian person (male or female, random), 50-65 years old, with visibly dry and rough skin on hands and feet — relatable, warm, everyday look';
  }
  // Elderly / senior
  if (/lansia|manula|nenek|kakek|elderly|senior|orang tua/.test(text)) {
    return 'Indonesian elderly person (male or female), 60-70 years old, warm and relatable';
  }
  // Baby / toddler products → show the mother
  if (/bayi|baby|balita|newborn|infant/.test(text)) {
    return 'Indonesian mother, 25-35 years old, caring and gentle expression';
  }
  // Clearly male-targeted
  if (/\bpria\b|laki-laki|men\'s|\bmen\b|\bmale\b|cowok|beard|janggut|cukur/.test(text) && !/wanita|perempuan|ibu/.test(text)) {
    return 'Indonesian man, 25-40 years old, Southeast Asian features';
  }
  // Teen / young adult
  if (/remaja|teen|teenage|mahasis|siswa|gen ?z/.test(text)) {
    return 'Indonesian young person (male or female), 18-25 years old, Southeast Asian features';
  }
  // Pregnancy / maternity
  if (/hamil|ibu hamil|pregnant|maternity/.test(text)) {
    return 'Indonesian pregnant woman, 25-35 years old, gentle and glowing expression';
  }
  // Default — general skincare / beauty
  return 'Indonesian woman, 25-35 years old, Southeast Asian features';
}

// ─── analyzeWinningAd ────────────────────────────────────────────────────────
// Full A-K design framework extraction — reverse-engineers the ad's entire
// visual system into a reusable blueprint for concept translation.

async function analyzeWinningAd(filePath, mimeType = 'image/jpeg') {
  const imageBuffer = fs.readFileSync(filePath);
  const imageBase64 = imageBuffer.toString('base64');
  // Use actual file mime type — sending PNG as 'image/jpeg' causes model refusal
  const safeMime = mimeType && mimeType.startsWith('image/') ? mimeType : 'image/jpeg';

  const analysisPrompt = `You are a senior creative director and forensic advertising analyst. Your task is to completely reverse-engineer this advertisement and extract its full design system into a reusable blueprint.

CRITICAL RULE: Describe ONLY what you ACTUALLY SEE. Never assume or invent. If there is no human model, say so explicitly.

Work through each section of this framework, then return everything as a single JSON object.

━━━━ A. TUJUAN DESAIN ━━━━
- What is the ad's primary function?
- What is the ad angle (problem-solution / hard-selling / educational / trust-building / social-proof / FOMO / aspirational / curiosity-gap / before-after)?
- What type of ad is this?

━━━━ B. STRUKTUR LAYOUT ━━━━
- Map the design grid: approximate % breakdown (left area X%, right area X%, top X%, bottom X%)
- Where exactly is: headline / product / logo / badge / background object?
- Describe the eye-reading flow — which element does the eye hit first, second, third, last?
- What layout pattern is this? (split-left-right / centered-hero / top-bottom / grid / full-bleed)

━━━━ C. HIERARCHY WORDING ━━━━
- Write out every word visible in the image, word-for-word
- Classify each text: small label / main headline / emphasized word / sub-text / trust text / CTA / product label
- Which text is the most visually prominent and why?
- What emphasis techniques are used? (enlarged, bold, circled, colored, underlined, isolated whitespace)

━━━━ D. TIPOGRAFI ━━━━
- Font character: bold / rounded / clean / modern / friendly / medical / serif / sans-serif
- Headline font style estimate
- Sub-text font style estimate
- Uppercase or mixed case? Font weight? Line height impression?
- Overall typographic impression (clinical / warm / energetic / premium / friendly)

━━━━ E. SISTEM WARNA ━━━━
- Primary color (with hex estimate)
- Accent / highlight color (with hex)
- Main text color (with hex)
- Emphasis / CTA color (with hex)
- Background color (with hex)
- Function of each color in the ad's message

━━━━ F. VISUAL PRODUK ━━━━
- Product position in frame (exact: center / bottom-right / left / etc.)
- Product size relative to canvas (small 10% / medium 30% / large 50%+ ?)
- Product angle: upright / tilted / frontal / 3/4 view
- Is product the primary focal point or secondary?
- How is the product visually separated from background (shadow / glow / cutout / contrast)?
- Any additional packaging shown?

━━━━ G. ELEMEN TRUST / BADGE ━━━━
- List every trust element visible (BPOM / halal / star rating / doctor endorsement / "X+ users" / award)
- Position and approximate size of each
- Visual style of each badge (pill / circle / stamp / icon)
- Purpose / function of each trust element in this ad

━━━━ H. BACKGROUND & ATMOSFER ━━━━
- Describe background precisely: solid color / gradient / photo / blurred / textured / surface material
- Is it clean / soft / premium / medical / natural / aspirational?
- Any props, table surface, blur, shadow, or negative space?
- What emotional atmosphere does the background create?

━━━━ I. TEKNIK EMPHASIS ━━━━
- What makes the headline immediately visible?
- What is the single most dominant visual element and why?
- List all emphasis techniques used: size contrast / color contrast / circle/ring overlay / glow / drop shadow / isolation / whitespace / diagonal layout

━━━━ J. TEMPLATE FRAMEWORK REUSABLE ━━━━
Build a reusable slot-based framework template:
- Label top = [describe type, shape, color, position]
- Headline line 1 = [describe weight, size, color, position]
- Headline line 2 = [describe if exists]
- Highlighted/emphasized word = [describe technique]
- Product area = [position, size, angle]
- Logo area = [position if visible]
- Trust badge area = [position, count, style]
- Background style = [color + texture description]
- Dominant color = [hex]
- Design mood = [single phrase]

━━━━ K. PROMPT SIAP PAKAI ━━━━
Write a 400-500 word generation prompt that recreates this exact ad layout for any product.
Requirements:
- Preserves placement, wording hierarchy, visual style, composition, and mood
- Uses [HEADLINE], [SUBTEXT], [CTA], [PRODUCT] as placeholders
- Includes exact colors (hex), exact positions, exact font weights
- Includes all floating elements, badges, background details
- STRICTLY follows compositionType: if no human → no human in prompt; if hand-only → hand only; if model → describe visible person
- Reads like a blueprint for a creative team, not a vague description

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Now return ONLY this JSON (no markdown, no explanation):

{
  "adType": "problem-solution|hard-selling|educational|trust-building|social-proof|FOMO|aspirational|curiosity-gap|before-after",
  "adAngle": "one sentence describing the ad's core angle and psychological mechanism",

  "compositionType": "EXACTLY ONE: product_only (zero humans visible, not even a hand) | hand_holding (only a hand/arm visible, no face or body) | model_with_product (a full or partial person is clearly visible)",
  "hasHumanModel": false,
  "humanScenario": "If hasHumanModel true: describe who (gender, apparent age, what doing, where). If false: 'No human model — product-only or hand-holding composition.'",

  "designFramework": "Full structured A–I analysis in plain text. Use section headers A through I. Minimum 600 words. Be technical and operational — write like a creative blueprint, not a vague description. Include specific hex estimates, percentages, and positioning for every element.",

  "replicationBlueprint": "Section J framework rendered as a clean slot-based template:\\nLabel top = ...\\nHeadline line 1 = ...\\nHeadline line 2 = ...\\nHighlighted word = ...\\nProduct area = ...\\nLogo area = ...\\nTrust badge area = ...\\nBackground style = ...\\nDominant color = ...\\nDesign mood = ...",

  "detailedVisualAnalysis": "5 tight paragraphs — forensically precise, only what you see:\\nPara 1 — Layout & human presence: layout pattern, human/hand/product-only, background color/texture.\\nPara 2 — All text word-for-word: every text element, position, weight, size, color.\\nPara 3 — Product detail: packaging shape, colors, label text, position in frame.\\nPara 4 — Color palette & style: dominant colors with hex, photography/render style, lighting direction.\\nPara 5 — Decorative elements: every badge, icon, sparkle, shape — name, color, position.",

  "hookMechanism": "What element catches visual attention in the first 1-3 seconds and why — be specific about the visual technique",
  "emotionalTruth": "What specific emotional state or desire does this image activate — precise, not generic",
  "narrativeStructure": {
    "setup": "What problem, situation, or desire is established",
    "tension": "What makes this feel urgent, painful, or important",
    "resolution": "What solution or transformation is promised"
  },
  "visualStory": "The specific objects, expressions, props, and setting that tell the story without words",
  "copyPattern": "The complete wording hierarchy: quote all text found, classify each, and explain the emphasis technique used",

  "masterImagePrompt": "Section K — 400-500 word ready-to-use generation prompt. Must include: exact layout description, exact hex colors for every element, exact font weight/size/position for typography, exact product placement and angle, exact floating elements and badge positions, compositionType-strict scene description. Use [HEADLINE] [SUBTEXT] [CTA] [PRODUCT] as placeholders. No vague descriptions — every instruction must be actionable for an AI image generator.",

  "visualStyle": "Photography/rendering style, editing approach, and overall aesthetic",
  "colorPalette": ["#hex1", "#hex2", "#hex3", "#hex4"],
  "lighting": "Lighting direction, quality, and temperature from what you observe",
  "mood": "Overall mood and atmosphere in 5-8 words",
  "composition": "Layout and visual composition description",
  "dominantAngle": "Choose one: fomo, social_proof, tutorial, curiosity_gap, before_after, problem_agitate, authority, price_anchor",
  "format": "Feed|Story|Reels",
  "primaryEmotion": "Single primary emotion evoked",
  "strengths": ["Key strength 1", "Key strength 2", "Key strength 3"],
  "suggestedCopyLanguage": "id"
}

Return only valid JSON, no markdown, no explanation.`;

  let analysisRaw = await analyzeImage({ imageBase64, mimeType: safeMime, prompt: analysisPrompt });

  // Detect model refusal — retry with ultra-minimal prompt before giving up
  if (/^i('m| am) sorry|can't assist|cannot assist|i'm unable/i.test(analysisRaw.trim())) {
    console.warn('Vision model refused first attempt — retrying with minimal prompt');
    const minimalPrompt = `Look at this image and return JSON describing its advertising design. Format: {"adType":"problem-solution","adAngle":"...","compositionType":"product_only","hasHumanModel":false,"humanScenario":"...","colorPalette":["#hex"],"composition":"...","humanScenario":"...","mood":"...","hookMechanism":"...","emotionalTruth":"...","visualStyle":"...","dominantAngle":"fomo","primaryEmotion":"...","lighting":"natural","narrativeStructure":{"setup":"...","tension":"...","resolution":"..."},"replicationBlueprint":"...","designFramework":"...","copyPattern":"...","visualStory":"...","detailedVisualAnalysis":"...","masterImagePrompt":"...","format":"Feed","strengths":[],"suggestedCopyLanguage":"id"}`;
    analysisRaw = await analyzeImage({ imageBase64, mimeType: safeMime, prompt: minimalPrompt });
  }

  // Still refusing after retry — throw clear error
  if (/^i('m| am) sorry|can't assist|cannot assist|i'm unable/i.test(analysisRaw.trim())) {
    throw new Error('Gagal menganalisis gambar ini. Coba save ulang sebagai JPG dan upload kembali.');
  }

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
//
// Batching: each LLM call handles at most BATCH_SIZE angles.
// 20 angles at ~500 tokens/angle = ~10k tokens — well above maxTokens:6000.
// Splitting into batches of 5 keeps each response under ~3k tokens.
// Batches run in parallel so total latency ~= one single batch call.

const ANGLE_BATCH_SIZE = 5;

async function _callAnglesForBatch(
  batchAngles,
  winningAnalysis,
  productName,
  productVisualDescription,
  productDescription,
  masterImagePrompt,
) {
  // (all prompt-building logic moved here — driven by batchAngles list)

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

  // ── Master image prompt — the base visual template from the actual winning ad ──
  const masterBlock = masterImagePrompt ? `
━━━━ MASTER IMAGE TEMPLATE (hasil analisa dari winning ad) ━━━━
Ini adalah prompt gambar yang sudah diekstrak dari winning ad. Di dalamnya ada placeholder:
[HEADLINE] = teks headline utama, [SUBTEXT] = subheadline/body text, [CTA] = call to action, [PRODUCT] = deskripsi produk.
Saat kamu menulis sceneDetails, pastikan emotionalMoment, setting, dan keyProps KONSISTEN dengan layout dan atmosphere yang digambarkan di template ini.

${masterImagePrompt}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`.trim() : '';

  // Detect compositionType from winning ad — drives rule #3 below
  const compositionType = winningAnalysis.compositionType || 'model_with_product';
  const hasModel = compositionType === 'model_with_product';
  const isHandHolding = compositionType === 'hand_holding';
  const isProductOnly = compositionType === 'product_only';

  // Derive persona from product description — no hardcoded demographics
  const anglesPersona = detectPersona(productDescription || '', productName);

  const rule3 = hasModel
    ? `3. sceneDetails dan imageScenario HARUS menampilkan karakter yang SESUAI dengan target audience produk ini. Gunakan persona berikut secara TEPAT: "${anglesPersona}". JANGAN ganti dengan perempuan muda jika persona bukan itu. Intensitas emosional (ekspresi, body language) HARUS setara dengan winning ad — hook/problem angle → ekspresi distressed/frustrated. Resolution angle → ekspresi lega/bahagia.`
    : isHandHolding
    ? `3. Winning ad ini TIDAK menampilkan model penuh — hanya tangan memegang produk. sceneDetails dan imageScenario HARUS mengikuti compositionType: 'hand_holding'. Deskripsikan tangan yang memegang produk di setting yang relevan. JANGAN tambahkan wajah, badan, atau model manusia penuh.`
    : `3. Winning ad ini TIDAK menampilkan manusia sama sekali — ini adalah iklan produk murni (product_only). sceneDetails dan imageScenario HARUS hanya menampilkan produk, background, dan elemen dekoratif. JANGAN ada manusia, tangan, atau model sama sekali.`;

  const systemPrompt = `Kamu adalah Meta Ads creative director kelas dunia yang ahli dalam "concept translation" — proses mengambil DNA dari satu iklan winning dan mentranslate-nya secara presisi ke produk yang berbeda. Ini bukan tentang meniru secara visual, tapi mengambil MEKANISME yang membuat iklan itu berhasil (hook, emosi, alur cerita) dan mengaplikasikannya ke konteks produk baru.

Tugas kamu adalah membaca iklan winning dengan sangat cermat, memahami MENGAPA ia berhasil (bukan hanya APA yang ada di dalamnya), lalu menciptakan versi baru untuk produk target yang memiliki daya tarik yang sama kuatnya. Prinsip terpenting: pertahankan mekanisme, ganti konteks.

ATURAN TIDAK BISA DILANGGAR:
1. Semua copy (headline, subheadline, bodyText, cta) WAJIB Bahasa Indonesia — tidak ada pengecualian.
2. Jika deskripsi produk menyebut ingredient spesifik (misal: Shea Butter 5%, Inoceramide, Hyaluronic Acid 3%), kondisi target (diabetes, kulit kering parah), atau klaim unik — HARUS muncul di copy. Copy generik ("kulit sehat") = GAGAL. Copy spesifik ("kulit diabetik yang pecah-pecah minta Inoceramide") = BERHASIL.
${rule3}
4. Intensitas emosional gambar HARUS setara dengan winning ad.
5. Produk HARUS terlihat jelas di gambar — deskripsikan tampilannya sedetail mungkin berdasarkan tampilan visual produk yang diberikan.`;

  const userPrompt = `${winningAdBlock}

${productBlock}
${masterBlock ? '\n' + masterBlock + '\n' : ''}
ANGLE YANG DIMINTA: ${batchAngles.join(', ')}

━━━━ INSTRUKSI TRANSLATE ━━━━

Untuk SETIAP angle yang diminta, kamu harus melakukan proses 3 langkah ini:

LANGKAH 1 — DECODE: Baca ulang "Cetak Biru Replikasi" dan "Hook" dari iklan winning. Identifikasi: apa mekanisme spesifik yang membuat orang berhenti scroll? Apa kebenaran universal yang disentuh?

LANGKAH 2 — ADAPT: Terjemahkan mekanisme itu ke konteks produk target. Pertahankan: hook mechanism (cara mencuri atensi), emotional truth (jenis rasa takut/harapan), narrative arc (setup→tension→resolution). Ganti: skenario, objek, referensi spesifik → sesuaikan ke produk ini. WAJIB sebutkan ingredient/klaim spesifik dari deskripsi produk.

LANGKAH 3 — VISUALIZE: Buat scene gambar yang PARALEL dengan winning ad. Jika winning ad menampilkan seorang frustrasi dikelilingi props masalahnya → gambar harus menampilkan karakter dengan persona "${anglesPersona}" dengan ekspresi sama, dikelilingi props masalah yang relevan ke produk ini. SAMA komposisi dan intensitas emosinya, BEDA konteksnya. Embed visual produk yang sudah dideskripsikan ke dalam scene.

Untuk tiap angle, return objek JSON dengan field BERIKUT (isi sedetail mungkin, minimum 2-3 kalimat untuk translatedConcept):
{
  "angle": "angle_key",

  "translatedConcept": "Penjelasan 2-3 paragraf: (1) Apa yang dipertahankan dari winning ad dan mengapa berhasil. (2) Bagaimana konsep itu ditranslate ke produk ini secara spesifik — skenario apa, emosi apa, hook apa. (3) Apa yang beda dan mengapa pilihan itu tepat untuk produk ini.",

  "headline": "Headline max 8 kata, scroll-stopping, mirror hook dari winning ad tapi untuk konteks produk — BAHASA INDONESIA",

  "subheadline": "Subheadline max 15 kata, perkuat headline dengan detail spesifik produk (ingredient/kondisi target jika ada) — BAHASA INDONESIA",

  "bodyText": "Body copy max 40 kata. WAJIB sebutkan minimal 1 ingredient/klaim spesifik dari deskripsi produk. Ikuti narrative arc: setup (masalah) → tension (kenapa menyakitkan) → resolution (produk ini solusinya, sebutkan spesifik kenapa) — BAHASA INDONESIA",

  "cta": "CTA max 4 kata, action-oriented — BAHASA INDONESIA",

  "imageScenario": "Deskripsikan scene gambar dalam Bahasa Indonesia (3-4 kalimat): siapa orangnya — GUNAKAN persona ini: '${anglesPersona}' — sedang apa, di mana, ekspresi wajah dan bahasa tubuh (HARUS cerminkan intensitas emosional winning ad), objek/props apa yang ada di sekitarnya yang menceritakan masalah/solusi, dan bagaimana produk ini terlihat dalam scene tersebut.",

  "sceneDetails": {
    "emotionalMoment": "1-2 sentences: describe the person ('${anglesPersona}') and their EXACT expression and body language. Must match the angle's emotional truth (frustrated/distressed for problem angles, relieved/happy for solution angles). NEVER describe as young woman unless that is the persona.",
    "setting": "Specific location and atmosphere (e.g. 'bathroom mirror, soft morning daylight, clean tiles')",
    "keyProps": "List 3-5 specific objects in the scene that tell the story — parallel to winning ad props but relevant to this product context",
    "beforeState": "[before_after angle only] Visual description of the problem state: specific skin condition, texture, expression",
    "afterState": "[before_after angle only] Visual description of the solution state: specific skin condition improvement, expression",
    "timeClaim": "[before_after angle only] Specific time claim shown in image (e.g. '7 hari', '2 minggu')"
  }
}

Return array JSON valid dengan TEPAT ${batchAngles.length} item. Tanpa markdown, tanpa komentar, langsung array.`;

  const response = await chatCompletion({
    model: config.models.scalingChat,
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
    console.warn(`[_callAnglesForBatch] JSON parse failed for batch [${batchAngles.join(',')}]:`, e.message);
  }

  return [];
}

// ─── generateScalingAngles (public) ──────────────────────────────────────────
// Splits anglesToGenerate into batches of ANGLE_BATCH_SIZE (5), runs each batch
// as a separate LLM call in parallel, then flattens the results.
// This prevents token-limit truncation when generating all 20 angles at once
// (20 × ~500 tokens/angle ≈ 10k tokens > maxTokens:6000).

async function generateScalingAngles(
  winningAnalysis,
  productName,
  selectedAngles = [],
  productVisualDescription = null,
  productDescription = null,
  masterImagePrompt = null,
  onStatus = null,
) {
  const anglesToGenerate = selectedAngles.length > 0
    ? selectedAngles
    : Object.keys(SCALING_ANGLES);

  // Build batches
  const batches = [];
  for (let i = 0; i < anglesToGenerate.length; i += ANGLE_BATCH_SIZE) {
    batches.push(anglesToGenerate.slice(i, i + ANGLE_BATCH_SIZE));
  }

  console.log(`[generateScalingAngles] ${anglesToGenerate.length} angles → ${batches.length} batch(es) of ≤${ANGLE_BATCH_SIZE}`);

  onStatus?.(`Menyusun konsep untuk ${anglesToGenerate.length} angle (${batches.length} batch)…`);

  // Run all batches in parallel — each is an independent LLM call
  const batchResults = await Promise.allSettled(
    batches.map((batch, idx) => {
      const labels = batch.map((k) => SCALING_ANGLES[k]?.label || k).join(', ');
      onStatus?.(`Batch ${idx + 1}/${batches.length}: ${labels}`);
      return _callAnglesForBatch(batch, winningAnalysis, productName, productVisualDescription, productDescription, masterImagePrompt);
    })
  );

  const angles = batchResults.flatMap((r, idx) => {
    if (r.status === 'rejected') {
      console.warn(`[generateScalingAngles] batch ${idx} failed:`, r.reason?.message);
      return [];
    }
    return r.value || [];
  });

  console.log(`[generateScalingAngles] got ${angles.length} / ${anglesToGenerate.length} angles`);
  return angles;
}

// ─── truncateForImage ─────────────────────────────────────────────────────────
// gpt-image-2 garbles long Indonesian text. Cap text elements used in image
// prompts to prevent character-level hallucinations. Copy in the card (headline/
// subheadline fields) remains full-length — only the text embedded in image
// prompt strings gets truncated.

function truncateForImage(text, maxWords = 5) {
  if (!text) return '';
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(' ') + '…';
}

// ─── buildMainScene ───────────────────────────────────────────────────────────
// Composition-aware scene block. Respects the winning ad's compositionType so
// we never force a human model when the reference had none.

function buildMainScene(compositionType, emotional, setting, props, prodDesc, angleContext = '', persona = null) {
  const ct = compositionType || 'model_with_product';

  if (ct === 'product_only') {
    return `MAIN SCENE: ${prodDesc} — prominently displayed as the sole hero. ` +
      `No human body, face, or hand present. ` +
      `Setting: ${setting || 'clean studio background'}. ` +
      `Props: ${props || 'minimal — product only'}. ` +
      `Product is sharp, well-lit, centered/positioned as in the reference ad.`;
  }

  if (ct === 'hand_holding') {
    return `MAIN SCENE: A realistic hand holding ${prodDesc} — ` +
      `${setting || 'clean background'}. ` +
      `Grip and angle consistent with reference ad. ` +
      `No face, torso, or full body visible. ` +
      `Lighting: ${emotional || 'warm natural'}. ` +
      `Props nearby: ${props || 'minimal'}.`;
  }

  // model_with_product — use detected persona, never hardcode young woman
  const personaDesc = persona || 'Indonesian woman, 25-35 years old, Southeast Asian features';
  return `MAIN SCENE: ${personaDesc}, ${emotional}. ` +
    `Setting: ${setting}. ` +
    `Props: ${props}. ` +
    `${angleContext}`;
}

// ─── buildCarouselSlidePrompt ─────────────────────────────────────────────────
// Generates a detailed, composition-aware image prompt for each carousel slide.
// Output quality mirrors buildAngleImagePrompt — not the old generic 80-120 word string.

function buildCarouselSlidePrompt(slide, winningAnalysis, productName, productVisualDescription, productDescription = null) {
  const compositionType = winningAnalysis.compositionType || 'model_with_product';
  const palette    = (winningAnalysis.colorPalette || ['#FADBD8', '#A93226', '#D5DBDB']).join(', ');
  const lighting   = winningAnalysis.lighting   || 'warm natural';
  const mood       = winningAnalysis.mood       || 'engaging';
  const visualStyle = winningAnalysis.visualStyle || 'editorial photography';
  // Derive persona from product description — prevents hardcoded young woman
  const carouselPersona = detectPersona(productDescription || '', productName);

  const imgHeadline = truncateForImage(slide.headline || '', 6);
  const imgSubtext  = truncateForImage(slide.subtext  || '', 6);

  const prodFull = productVisualDescription
    ? `${productName} — ${productVisualDescription}`
    : `${productName} packaging`;
  const prodDesc = `${prodFull}. IMPORTANT: Match this product's packaging appearance EXACTLY to the uploaded reference product photo — same shape, label colors, label text, and design.`;

  const quality = `Photorealistic, high-end beauty editorial photography. Color palette: ${palette}. ${lighting} lighting. ${mood} mood. Square 1:1 format.`;
  const refNote = `NOTE: If a reference product image is provided, match the product packaging EXACTLY — same shape, colors, label.`;
  const textAccuracy = `CRITICAL — TEXT RENDERING: Render every word EXACTLY as written, letter by letter. No blur, no warped characters. Clean crisp legible typography.`;
  const bpom = `"BPOM ✓" small badge in bottom right corner.`;

  // Composition-aware main scene builder for carousel slides
  const buildCarouselScene = (context = '') => {
    if (compositionType === 'product_only') {
      return `MAIN VISUAL: ${prodDesc} — displayed as the hero product. No human, no hand. ${context} Clean composition, product sharp and prominent.`;
    }
    if (compositionType === 'hand_holding') {
      return `MAIN VISUAL: A realistic hand holding ${prodDesc}. ${context} No face or full body visible. Grip consistent with reference ad.`;
    }
    return `MAIN VISUAL: ${carouselPersona}. ${context}`;
  };

  const type = slide.type || 'benefit';

  // ── Hook slide ─────────────────────────────────────────────────────────────
  if (type === 'hook') {
    const hookMech = winningAnalysis.hookMechanism || winningAnalysis.hook || 'eye-catching composition';
    const emotionalTruth = winningAnalysis.emotionalTruth || 'curiosity and desire';
    const ns = winningAnalysis.narrativeStructure || {};
    const hookContext = compositionType === 'model_with_product'
      ? `Hook expression matching "${hookMech}" energy. Emotional truth: ${emotionalTruth}. Setting: ${ns.setup || 'relatable everyday Indonesian moment'}. Expression is powerful and scroll-stopping.`
      : `Styled to evoke "${hookMech}" stopping energy. Background and lighting match the winning ad's mood: ${visualStyle}.`;
    const hookScene = buildCarouselScene(hookContext);
    return `Scroll-stopping carousel HOOK slide for Meta Ads. ${visualStyle} style.
Background: soft cream-pink gradient (#FFF0F5 to #FFF8F5). Square 1:1 format.
LAYOUT: 60% visual scene, 40% typography — OR full-bleed scene with text overlay (replicate winning ad layout style).
TYPOGRAPHY RENDERED ON IMAGE (crisp, bold, no blur):
- Large bold dark headline, centered, 2-3 lines, max 6 words: "${imgHeadline}"
- Smaller supporting subtext: "${imgSubtext}"
${hookScene}
PRODUCT: ${prodDesc} — prominently displayed, large, sharply in focus. This is slide 1 — make the viewer STOP scrolling.
VISUAL DIRECTION: Replicate the visual stopping power of this winning ad hook: "${hookMech}". Color palette: ${palette}. ${lighting} lighting.
FLOATING ELEMENTS: Subtle sparkle or accent icons in palette colors.
${textAccuracy}
${bpom}
${refNote}
${quality}`;
  }

  // ── CTA slide ──────────────────────────────────────────────────────────────
  if (type === 'cta') {
    const ctaContext = compositionType === 'model_with_product'
      ? `${carouselPersona} — happy, satisfied, confident expression — holding ${prodDesc}. This is the resolution moment — they got the result.`
      : `${prodDesc} shown as the final hero. Bright, positive, achievement atmosphere.`;
    const ctaScene = buildCarouselScene(ctaContext);
    return `High-converting carousel CTA slide for Meta Ads. ${visualStyle} style.
Background: soft cream (#FFFBF5) with warm gradient. Square 1:1 format.
LAYOUT: Strong visual presence + prominent CTA button.
TYPOGRAPHY RENDERED ON IMAGE (crisp, bold, perfectly legible):
- Bold dark headline (1-2 lines, large, centered): "${imgHeadline}"
- Supporting subtext: "${imgSubtext}"
- LARGE prominent CTA button (dark pink #D4547A, white bold text, rounded pill, bottom center): "${slide.cta || 'Beli Sekarang'} →"
- Green savings/availability badge (#1A7A6E pill, white text): "Dapatkan Sekarang"
${ctaScene}
PRODUCT: ${prodDesc} — hero position, large, sharply in focus. This is the FINAL SLIDE — drive action.
FLOATING ELEMENTS: Green checkmark badges, gold star rating, urgency sparkles in palette colors.
${textAccuracy}
${bpom}
${refNote}
${quality}`;
  }

  // ── Benefit slide (default) ─────────────────────────────────────────────────
  const benefitContext = compositionType === 'model_with_product'
    ? `${carouselPersona} — demonstrating or experiencing the specific benefit: "${slide.subtext || 'visible product benefit'}". Expression is authentic and relatable — they feel the result.`
    : `Positioned to visually communicate the benefit: "${slide.subtext || 'product benefit'}". Product is the evidence.`;
  const benefitScene = buildCarouselScene(benefitContext);
  // Extract 1-2 word benefit label from headline
  const benefitLabel = truncateForImage(slide.headline || 'Manfaat', 2);
  return `Persuasive carousel BENEFIT slide for Meta Ads. ${visualStyle} style.
Background: soft cream (#FFF8F5). Square 1:1 format.
LAYOUT: Split — left typography, right visual (OR top headline, center scene, bottom CTA).
TYPOGRAPHY RENDERED ON IMAGE (crisp, bold, perfectly legible):
- Teal rounded pill badge (#1A7A6E, white text, top): "${benefitLabel}"
- Bold dark headline, centered, 1-2 lines: "${imgHeadline}"
- Smaller supporting subtext below: "${imgSubtext}"
- Dark pink (#D4547A) subtle CTA text or small pill button at bottom (optional for benefit slides)
${benefitScene}
PRODUCT: ${prodDesc} — clearly visible in scene, showing this specific benefit. This slide must feel like PROOF — show the outcome, not just the product.
FLOATING ELEMENTS: Relevant benefit icons (leaf/sparkle/check/ingredient icon), small badge accent in palette colors.
Visual direction: Color palette: ${palette}. ${lighting} lighting. Benefit-forward composition.
${textAccuracy}
${bpom}
${refNote}
${quality}`;
}

// ─── buildAngleLayer ─────────────────────────────────────────────────────────
// Angle-specific instructions that are LAYERED ON TOP of the masterImagePrompt base.
// Used when masterImagePrompt is available (primary path).

function buildAngleLayer(angle, sd, emotional, setting, props, productPricing, compositionType = 'model_with_product', persona = null) {
  const fmt = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');
  const personaDesc = persona || 'Indonesian woman, 25-35 years old, Southeast Asian features';
  // Build the scene block respecting compositionType — never force model when reference had none
  const sceneBlock = (context = '') => {
    if (compositionType === 'product_only') {
      return `SCENE: Product-only composition. No human present. Product prominently displayed. Setting: ${setting}. Props: ${props}.`;
    }
    if (compositionType === 'hand_holding') {
      return `SCENE: Hand holding product. No face or full body. Setting: ${setting}. Props: ${props}.`;
    }
    return `SCENE: ${personaDesc}, ${emotional}${context ? ' — ' + context : ''}. Setting: ${setting}. Props: ${props}.`;
  };

  switch (angle.angle) {

    case 'before_after': {
      const before    = sd.beforeState  || 'visible problem state — close-up';
      const after     = sd.afterState   || 'visible improvement state — same close-up angle';
      const timeClaim = sd.timeClaim    || '7 hari';
      return `Convert into SPLIT-SCREEN layout.
LEFT "Sebelum": ${before}. Muted/slightly desaturated lighting. "Sebelum" label pill top-left.
CENTER: Thin vertical divider with small circle containing bold text "${timeClaim}".
RIGHT "Sesudah": ${after}. Brighter, warmer lighting with glow effect. "Sesudah" label pill top-right.
${sceneBlock()}
Product placed bottom-center overlapping both halves — must be large and clearly identifiable.`;
    }

    case 'fomo': {
      return `URGENCY LAYER: Add coral/orange (#E8541A) "⚡ Stok Terbatas" pill badge prominently at top.
Add small "Tersisa sedikit" urgency text overlay near product.
${sceneBlock('excited/urgent energy')}`;
    }

    case 'problem_agitate': {
      return `PROBLEM EMPHASIS: Scene highlights the frustration/pain clearly.
${sceneBlock('distressed/frustrated — problem visible')}
Product appears as the visible solution element in corner or bottom area.`;
    }

    case 'price_anchor': {
      const hasPromo = productPricing.productPromoPrice != null;
      const hasPrice = productPricing.productPrice != null;
      const priceLine = hasPromo && hasPrice
        ? `show crossed-out original "${fmt(productPricing.productPrice)}" in gray strikethrough → large bold "${fmt(productPricing.productPromoPrice)}" in dark pink (#D4547A)`
        : hasPromo  ? `large bold promo price "${fmt(productPricing.productPromoPrice)}" in dark pink (#D4547A)`
        : hasPrice  ? `large bold price "${fmt(productPricing.productPrice)}" in dark pink (#D4547A)`
        : `DO NOT invent or display any price numbers — show a savings/value message instead`;
      return `PRICE LAYER: Add green (#1A7A6E) "Hemat Sekarang" badge. Price display: ${priceLine}.
${sceneBlock('pleased/satisfied')}`;
    }

    case 'social_proof': {
      return `TRUST LAYER: Add gold star row "⭐⭐⭐⭐⭐" with pink badge "1000+ Pelanggan Puas" at top.
Add floating speech-bubble testimonial snippet overlay.
${sceneBlock('happy, satisfied, confident')}`;
    }

    case 'tutorial': {
      return `STEP LAYER: Add teal (#1A7A6E) "Cara Pakai" badge.
Show 3 numbered step cards: teal circle "1", teal circle "2", teal circle "3" each with short instruction (≤10 words).
${sceneBlock('calm, instructional')} Soft background.`;
    }

    case 'authority': {
      return `AUTHORITY LAYER: Add dark navy (#1A3A5C) "Direkomendasikan Dokter" badge.
Add floating trust badges: BPOM certified, 5-star rating, certification icon.
${sceneBlock('confident, professional')}`;
    }

    case 'curiosity_gap': {
      return `CURIOSITY LAYER: Add teal (#1A7A6E) "Tahukah kamu?" badge.
Add small question mark or lightbulb accent icons in teal.
${sceneBlock('intrigued/curious')}`;
    }

    default: {
      return sceneBlock();
    }
  }
}

// ─── buildAngleImagePrompt ───────────────────────────────────────────────────
// Per-angle structured templates — code controls layout/structure,
// GPT fills in scene details. No more free-form imagePromptEN from GPT.

function buildAngleImagePrompt(angle, winningAnalysis, productName, productVisualDescription, productPricing = {}, masterImagePrompt = null, productDescription = null) {
  const palette    = (winningAnalysis.colorPalette || ['#FADBD8', '#A93226', '#D5DBDB']).join(', ');
  const lighting   = winningAnalysis.lighting  || 'warm natural';
  const mood       = winningAnalysis.mood      || 'engaging';
  // Composition type from winning ad — drives whether scene has model, hand, or product-only
  const compositionType = winningAnalysis.compositionType || 'model_with_product';
  // Persona derived from product description — prevents hardcoded young woman for elderly/diabetic/male products
  const persona = detectPersona(productDescription || '', productName);
  // Full copy for card display — only shortened versions used inside image prompts
  const headline   = angle.headline   || '';
  const sub        = angle.subheadline || '';
  const cta        = (angle.cta || 'Coba Sekarang').replace(/^CTA:\s*/i, '');
  // Truncated versions embedded in image prompt — gpt-image-2 garbles long text
  const imgHeadline = truncateForImage(headline, 6);
  const imgSub      = truncateForImage(sub, 5);
  const imgCta      = truncateForImage(cta, 4);
  const sd         = angle.sceneDetails || {};
  // Strip leading "Indonesian woman" from emotionalMoment if present — templates add it themselves
  const rawEmotional = sd.emotionalMoment || 'relatable everyday expression, Southeast Asian features';
  const emotional  = rawEmotional.replace(/^Indonesian woman[^,]*,?\s*/i, '').trim() || rawEmotional;
  const setting    = sd.setting        || 'clean bright environment, Indonesian home';
  const props      = sd.keyProps       || 'product prominently displayed';

  // Product description — from uploaded photo analysis or hardcoded fallback
  const prodBase = productVisualDescription
    ? `${productName} — ${productVisualDescription}`
    : `${productName} — match product appearance EXACTLY to the reference product photo`;
  const prodDesc = `${prodBase}. IMPORTANT: Match this product's appearance EXACTLY to the uploaded reference product photo — same shape, colors, label text, and design.`;

  const quality  = `Photorealistic, high-end skincare beauty editorial photography. Clean and trustworthy aesthetic. Indonesian lifestyle photography feel. No CGI look. No artificial render look. Color palette: ${palette}. ${lighting} lighting. ${mood} mood. Square 1:1 format.`;
  const bpom     = `"BPOM ✓" badge in bottom right corner, small but legible.`;
  const refNote  = `REFERENCE IMAGE INSTRUCTION: ONE reference image is provided — it is the product photo. Match the product packaging EXACTLY to this photo: same shape, colors, label text, and design. The reference photo IS the product to feature in this image.`;
  const textAccuracy = `CRITICAL — TEXT RENDERING: Render every word EXACTLY as written, letter by letter. Do not change, substitute, or rearrange any characters. If a word looks unusual, render it exactly as-is. Clean crisp legible typography — no blur, no warped letters.`;

  // ── Product identity override — injected at the top of every prompt ────────
  // This prevents the AI from reproducing products from the winning ad analysis.
  const productOverride = `⚠️ PRODUCT IDENTITY — NON-NEGOTIABLE:
The ONLY product that must appear in this image is: ${prodDesc}
Do NOT show any other product, brand, drink, sachet pack, or packaging from any reference.
The winning ad was used ONLY to extract layout, composition, color palette, and typography style.
Its product has been COMPLETELY REPLACED by the product above.
If the reference photo shows a different product, IGNORE that product — show ONLY ${productName}.`;

  // ── Use masterImagePrompt as base when available ─────────────────────────
  // Replace placeholders then inject product override + angle-specific layer.
  if (masterImagePrompt) {
    let base = masterImagePrompt
      .replace(/\[HEADLINE\]/g, imgHeadline)
      .replace(/\[SUBTEXT\]/g,  imgSub)
      .replace(/\[CTA\]/g,      imgCta)
      .replace(/\[PRODUCT\]/g,  prodDesc)
      .replace(/\[LOGO\]/g,     productName)
      .replace(/\[BRAND\]/g,    productName)
      .replace(/\[BRAND_NAME\]/g, productName);

    const angleLayer = buildAngleLayer(angle, sd, emotional, setting, props, productPricing, compositionType, persona);
    return `${productOverride}\n\n${base}\n\nANGLE-SPECIFIC LAYER (${(angle.angle || '').toUpperCase()}):\n${angleLayer}\n\n${textAccuracy}\n${bpom}\n${refNote}\n${quality}`;
  }

  switch (angle.angle) {

    // ── BEFORE & AFTER ──────────────────────────────────────────────────────
    case 'before_after': {
      const beforeState = sd.beforeState || 'skin/product area shows the problem — close-up';
      const afterState  = sd.afterState  || 'same area shows the improvement — same close-up';
      const timeClaim   = sd.timeClaim   || '7 hari';
      const beforeScene = compositionType === 'product_only'
        ? `LEFT "Sebelum": ${prodDesc} in a dull/problem context — ${beforeState}. Muted slightly desaturated lighting. "Sebelum" label pill top-left.`
        : compositionType === 'hand_holding'
        ? `LEFT "Sebelum": A hand presenting ${prodDesc} against a dim/problem background — ${beforeState}. Muted lighting. "Sebelum" label pill top-left.`
        : `LEFT "Sebelum": ${persona}, ${sd.emotionalMoment || 'concerned/frustrated expression'}. Close-up shows ${beforeState}. Muted warm lighting. "Sebelum" label pill top-left.`;
      const afterScene = compositionType === 'product_only'
        ? `RIGHT "Sesudah": ${prodDesc} in a bright/positive context — ${afterState}. Bright warm lighting, glow effect. "Sesudah" label pill top-right.`
        : compositionType === 'hand_holding'
        ? `RIGHT "Sesudah": A hand presenting ${prodDesc} against a bright/warm background — ${afterState}. Brighter saturated lighting. "Sesudah" label pill top-right.`
        : `RIGHT "Sesudah": Same ${persona}, smiling softly, relaxed and relieved. Close-up shows ${afterState}. Brighter, warmer lighting. Sparkle/glow effect. "Sesudah" label pill top-right.`;
      return `A clean, modern Meta Ads image in editorial split-screen style. Background is soft pink-cream gradient (#FFF0F5 to #F5F0E8). Square 1:1 format.
TYPOGRAPHY RENDERED ON IMAGE (must be perfectly legible, crisp, bold, no blur):
- Top center: dark pink (#D4547A) rounded pill badge with white text "Sebelum vs Sesudah"
- Large bold dark brown/black text upper area (2-3 lines, centered): "${imgHeadline}"
- Bottom smaller supporting text: "${imgSub}"
- CTA rounded pill button bottom center, dark pink (#D4547A), white bold text: "${imgCta} →"
MAIN SCENE:
${beforeScene}
${afterScene}
DIVIDING ELEMENT: Thin vertical line in the center with a small white circle containing bold dark text "${timeClaim}".
PRODUCT FEATURED: ${prodDesc} — placed bottom center overlapping both halves, slightly in front. Product is the hero element, must be large and clearly identifiable.
FLOATING ELEMENTS: Small pink star/sparkle icons (#D4547A) scattered around the sesudah side. Small leaf/natural ingredient icon near the product bottom.
${textAccuracy}
${bpom}
${refNote}
${quality}`;
    }

    // ── FOMO / URGENCY ───────────────────────────────────────────────────────
    case 'fomo': {
      const fomoScene = buildMainScene(compositionType, emotional, setting, props, prodDesc, 'excited/urgent energy', persona);
      return `A clean, modern Meta Ads image in editorial split layout. Background soft cream/off-white (#FFFBF5). Square 1:1 format.
LEFT 55%: Large bold typography block on cream background.
RIGHT 45%: Photorealistic scene with thin gradient divider.
TYPOGRAPHY ON LEFT (rendered exactly, crisp, no blur, high contrast):
- Top left: coral/orange (#E8541A) rounded pill badge with white text "⚡ Stok Terbatas"
- Large bold dark brown/black headline (2-3 lines, large sans-serif): "${imgHeadline}"
- Smaller supporting text below: "${imgSub}"
- Orange rounded CTA pill button (#E8541A), white bold text, bottom left: "${imgCta} →"
RIGHT SIDE SCENE: ${fomoScene}
PRODUCT: ${prodDesc} — visible in scene on right side, clearly identifiable.
FLOATING: Small urgency indicator "Tersisa sedikit" text overlay near product. Orange sparkle accents.
${textAccuracy}
${bpom}
${refNote}
${quality}`;
    }

    // ── PROBLEM AGITATE ──────────────────────────────────────────────────────
    case 'problem_agitate': {
      const problemScene = buildMainScene(compositionType, emotional, setting, props, prodDesc, 'distressed/frustrated expression — problem clearly visible', persona);
      return `A clean, modern Meta Ads image in editorial split layout. Background soft cream/light (#FFF8F5). Square 1:1 format.
LEFT 55%: Large bold typography block on light background.
RIGHT 45%: Emotional problem scene with thin divider.
TYPOGRAPHY ON LEFT (rendered exactly, crisp, bold, perfectly legible):
- Top left: dark rose (#A93226) rounded pill badge with white text "Masalah Nyata"
- Large bold dark brown/black headline (2-3 lines): "${imgHeadline}"
- Smaller supporting text: "${imgSub}"
- Dark pink (#D4547A) rounded CTA pill button, white bold text, bottom left: "${imgCta} →"
RIGHT SIDE SCENE: ${problemScene}
PRODUCT: ${prodDesc} — shown as the solution, placed at bottom of right scene or overlapping corner, clearly identifiable.
${textAccuracy}
${bpom}
${refNote}
${quality}`;
    }

    // ── CURIOSITY GAP ────────────────────────────────────────────────────────
    case 'curiosity_gap': {
      const curiosityScene = buildMainScene(compositionType, emotional, setting, props, prodDesc, 'intrigued/curious expression', persona);
      return `A clean, modern Meta Ads image in editorial split layout. Background soft cream (#FFFBF5). Square 1:1 format.
LEFT 55%: Bold typography with mystery/question hook on cream background.
RIGHT 45%: Intriguing scene.
TYPOGRAPHY ON LEFT (rendered exactly, crisp, bold, perfectly legible):
- Top left: teal/dark green (#1A7A6E) rounded pill badge with white text "Tahukah kamu?"
- Large bold dark headline with question/mystery (2-3 lines): "${imgHeadline}"
- Teaser supporting text: "${imgSub}"
- Teal/dark pink rounded CTA pill button, white bold text, bottom left: "${imgCta} →"
RIGHT SIDE SCENE: ${curiosityScene}
PRODUCT: ${prodDesc} — clearly visible, prominently placed, looking intriguing.
FLOATING: Small question mark or lightbulb accent icons in teal. Pink sparkle accents.
${textAccuracy}
${bpom}
${refNote}
${quality}`;
    }

    // ── SOCIAL PROOF ─────────────────────────────────────────────────────────
    case 'social_proof': {
      const socialScene = buildMainScene(compositionType, emotional, setting, props, prodDesc, 'happy, satisfied, confident', persona);
      return `A clean, modern testimonial-style Meta Ads image. Soft pink-cream background (#FFF0F5). Square 1:1 format.
TOP SECTION: Star rating badge + headline.
CENTER: Scene with satisfied product showcase.
BOTTOM: Product + CTA button.
TYPOGRAPHY RENDERED ON IMAGE (perfectly legible, crisp):
- Top center: gold star rating "⭐⭐⭐⭐⭐" with pink badge "1000+ Pelanggan Puas"
- Bold dark headline (1-2 lines, large, centered): "${imgHeadline}"
- Subtext: "${imgSub}"
- Dark pink (#D4547A) CTA pill button, white bold text, bottom center: "${imgCta} →"
MAIN SCENE: ${socialScene}
OVERLAY ELEMENTS: Floating speech bubble testimonial snippet. Before/after comparison circles (left: rough/dull, right: smooth/bright).
PRODUCT: ${prodDesc} — hero product, bottom center, large and clearly identifiable.
${textAccuracy}
${bpom}
${refNote}
${quality}`;
    }

    // ── TUTORIAL / HOW-TO ────────────────────────────────────────────────────
    case 'tutorial': {
      const tutorialScene = buildMainScene(compositionType, emotional, setting, props, prodDesc, 'calm, instructional, demonstrating use', persona);
      return `A clean, modern informational Meta Ads image with step-by-step layout. Soft cream/white background. Square 1:1 format.
TOP: Teal badge + headline.
MIDDLE: 3-step numbered card row.
BOTTOM: Product + CTA button.
TYPOGRAPHY RENDERED ON IMAGE (perfectly legible, crisp):
- Top center: teal/green (#1A7A6E) rounded pill badge "Cara Pakai"
- Bold dark headline (1-2 lines, large, centered): "${imgHeadline}"
- STEP 1 card: teal circle "1" + short instruction (5 words max)
- STEP 2 card: teal circle "2" + short instruction (5 words max)
- STEP 3 card: teal circle "3" + short instruction (5 words max)
- Dark pink (#D4547A) CTA pill button, white bold text, bottom center: "${imgCta} →"
BACKGROUND SCENE: ${tutorialScene} Soft, instructional, calm atmosphere.
PRODUCT: ${prodDesc} — shown in use in one of the step illustrations. Clearly identifiable.
${textAccuracy}
${bpom}
${refNote}
${quality}`;
    }

    // ── PRICE ANCHOR ─────────────────────────────────────────────────────────
    case 'price_anchor': {
      const fmt = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');
      const hasPromo   = productPricing.productPromoPrice != null;
      const hasPrice   = productPricing.productPrice != null;
      const promoPrice = hasPromo  ? fmt(productPricing.productPromoPrice) : null;
      const origPrice  = hasPrice  ? fmt(productPricing.productPrice)      : null;
      // Build price line — only show real numbers, never invent
      const priceLine  = hasPromo && hasPrice
        ? `- Price comparison: crossed-out original price "${origPrice}" in gray strikethrough → actual promo price "${promoPrice}" in large bold dark pink (#D4547A)`
        : hasPromo
          ? `- Promo price (large bold dark pink #D4547A): "${promoPrice}"`
          : hasPrice
            ? `- Product price (large bold dark pink #D4547A): "${origPrice}"`
            : `- DO NOT invent or show any price numbers. Show a value/savings message instead.`;
      const priceScene = buildMainScene(compositionType, emotional, setting, props, prodDesc, 'pleased/satisfied with the value', persona);
      return `A clean, modern value-proposition Meta Ads image in editorial split layout. Soft cream background (#FFFBF5). Square 1:1 format.
LEFT 55%: Price comparison typography block on cream background.
RIGHT 45%: Product showcase scene.
TYPOGRAPHY ON LEFT (rendered exactly, crisp, bold, perfectly legible):
- Top left: green (#1A7A6E) rounded pill badge "Hemat Sekarang"
- Bold dark headline (1-2 lines, large): "${imgHeadline}"
${priceLine}
- Smaller supporting text: "${imgSub}"
- Green/orange (#E8541A) rounded CTA pill button, white bold text, bottom left: "${imgCta} →"
RIGHT SIDE SCENE: ${priceScene}
PRODUCT: ${prodDesc} — large, prominently displayed on right side, clearly identifiable.
${textAccuracy}
${bpom}
${refNote}
${quality}`;
    }

    // ── AUTHORITY / EXPERT ───────────────────────────────────────────────────
    case 'authority': {
      const authorityScene = buildMainScene(compositionType, emotional, setting, props, prodDesc, 'confident, professional, trustworthy', persona);
      return `A clean, modern authority/expert Meta Ads image in editorial split layout. Professional, trustworthy aesthetic. Soft cream/light blue-white background. Square 1:1 format.
LEFT 55%: Credentials + headline typography on clean background.
RIGHT 45%: Confident professional scene.
TYPOGRAPHY ON LEFT (rendered exactly, crisp, bold, perfectly legible):
- Top left: dark navy/professional (#1A3A5C) rounded pill badge "Direkomendasikan Dokter"
- Bold authoritative dark headline (2 lines): "${imgHeadline}"
- Credential supporting text: "${imgSub}"
- Dark professional (#1A3A5C or #D4547A) rounded CTA pill button, white bold text, bottom left: "${imgCta} →"
RIGHT SIDE SCENE: ${authorityScene}
PRODUCT: ${prodDesc} — presented as the endorsed certified product, clearly identifiable.
TRUST OVERLAY BADGES: BPOM certified badge, 5-star rating badge, small certification icon — as floating overlays.
${textAccuracy}
${refNote}
${quality}`;
    }

    // ── DEFAULT FALLBACK ─────────────────────────────────────────────────────
    default: {
      const defaultScene = buildMainScene(compositionType, emotional, setting, props, prodDesc, '', persona);
      return `A clean, modern Meta Ads image in editorial split layout. Soft cream (#FFFBF5) background. Square 1:1 format.
LEFT 55%: Large bold typography block on cream background.
RIGHT 45%: Scene with thin gradient divider.
TYPOGRAPHY ON LEFT (rendered exactly, crisp, bold, perfectly legible):
- Bold dark brown/black headline (2-3 lines, large): "${imgHeadline}"
- Supporting subtext: "${imgSub}"
- Dark pink (#D4547A) rounded CTA pill button, white bold text, bottom left: "${imgCta} →"
RIGHT SCENE: ${defaultScene}
PRODUCT: ${prodDesc} — clearly visible and identifiable.
${textAccuracy}
${bpom}
${refNote}
${quality}`;
    }
  }
}

// ─── generateVariationPrompts ─────────────────────────────────────────────────
// Uses per-angle template builder — no free-form GPT prompt, no text overlay append.
// masterImagePrompt: when provided (from analyze step), used as base; angle-specific
// layers are appended on top rather than using the hardcoded template switch.

async function generateVariationPrompts(winningAnalysis, angles, productName, productVisualDescription = null, productPricing = {}, masterImagePrompt = null, productDescription = null, onStatus = null) {
  const result = [];
  for (const angle of angles) {
    const label = angle.label || (angle.angle || '').replace(/_/g, ' ');
    onStatus?.(`Menyusun prompt: ${label}`);
    const imagePrompt = buildAngleImagePrompt(angle, winningAnalysis, productName, productVisualDescription, productPricing, masterImagePrompt, productDescription);
    result.push({ ...angle, imagePrompt });
  }
  return result;
}

// ─── batchGenerateImages ──────────────────────────────────────────────────────
// productImageUrl: if provided → flux-kontext-pro (img2img, product accuracy)
// no productImageUrl → gpt-image-2 (text rendering, scene quality)

// Simple concurrency limiter — allows at most `limit` Promises to run simultaneously.
function makeSemaphore(limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (queue.length === 0 || active >= limit) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

async function batchGenerateImages(variations, aspectRatio = '1:1', referenceImageUrls = [], imagesPerAngle = 1, angleQuantities = {}, onProgress = null, onStatus = null) {
  const sizeMap = { '1:1': '1024x1024', '9:16': '1024x1536', '16:9': '1536x1024', '4:5': '1024x1024' };
  const rawSize = sizeMap[aspectRatio] || '1024x1024';
  const size = GPT_IMAGE_SIZE_MAP[rawSize] || rawSize;
  const globalCount = Math.min(Math.max(parseInt(imagesPerAngle) || 1, 1), 5);

  const filteredVariations = variations.filter((v) => v.imagePrompt);

  // ── Build flat job list: one entry per image to generate ──────────────────
  const jobs = [];
  for (const v of filteredVariations) {
    const count = (angleQuantities && angleQuantities[v.angle])
      ? Math.min(Math.max(parseInt(angleQuantities[v.angle]) || 1, 1), 5)
      : globalCount;
    for (let i = 0; i < count; i++) jobs.push({ v, imgIdx: i });
  }
  const totalImages = jobs.length;

  onStatus?.(`Mengirim ${totalImages} job ke apimart…`);

  // ── Phase 1: Submit all jobs — max 10 concurrent, retry up to 3× on failure ──
  const SUBMIT_CONCURRENCY = 10;
  const submitRun = makeSemaphore(SUBMIT_CONCURRENCY);
  const MAX_RETRIES = 3;

  const submissions = await Promise.allSettled(
    jobs.map(({ v }) =>
      submitRun(async () => {
        const label = v.label || (v.angle || '').replace(/_/g, ' ');
        onStatus?.(`Submit: ${label}`);
        const payload = { model: config.models.image, prompt: v.imagePrompt, n: 1, size };
        if (referenceImageUrls.length > 0) payload.images = referenceImageUrls;
        let lastErr;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            return await submitImageJobPayload(payload);
          } catch (err) {
            lastErr = err;
            const retryable = !err?.response?.status || err?.response?.status >= 429;
            if (!retryable || attempt === MAX_RETRIES - 1) break;
            await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); // 0.8s, 1.6s backoff
          }
        }
        throw lastErr;
      })
    )
  );

  const submitFailed = submissions.filter((s) => s.status === 'rejected').length;
  onStatus?.(`${totalImages - submitFailed}/${totalImages} job terkirim — menunggu hasil…`);

  // ── Phase 2: Poll ALL jobs simultaneously — total time = max(individual) ─
  let completed = 0;
  const POLL_INTERVAL = 5000;
  const POLL_TIMEOUT  = 300000; // 5 min per image

  const pollResults = await Promise.allSettled(
    submissions.map(async (sub, idx) => {
      const { v } = jobs[idx];
      const label = v.label || (v.angle || '').replace(/_/g, ' ');

      if (sub.status === 'rejected') throw sub.reason;
      const submitted = sub.value;

      // Sync response — URL already in submission
      if (submitted.url) {
        const url = Array.isArray(submitted.url) ? submitted.url[0] : submitted.url;
        completed++;
        onStatus?.(`Selesai: ${label} ✓`);
        onProgress?.(completed, totalImages, v.angle, v.headline || '');
        return url;
      }

      const taskId = submitted.task_id || submitted.taskId || submitted.id;
      if (!taskId) throw new Error('No task_id: ' + JSON.stringify(submitted).slice(0, 200));

      onStatus?.(`Menunggu: ${label}…`);
      const start = Date.now();
      let pollErrors = 0;

      while (Date.now() - start < POLL_TIMEOUT) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));
        let task;
        try {
          task = await getTask(taskId);
          pollErrors = 0; // reset on success
        } catch (e) {
          pollErrors++;
          if (pollErrors >= 6) throw new Error(`getTask gagal ${pollErrors}× berturut: ${e.message} (${label})`);
          continue; // transient error — retry
        }
        const status = (task.status || '').toLowerCase();

        if (['completed', 'succeed', 'success', 'done'].includes(status)) {
          const images = task.result?.images || task.images || task.result?.data || task.output?.images || [];
          let url;
          if (images.length) url = Array.isArray(images[0].url) ? images[0].url[0] : (images[0].url || images[0]);
          else url = task.result?.url || task.url || task.output?.url;
          if (!url) throw new Error('Selesai tapi URL tidak ditemukan: ' + JSON.stringify(task).slice(0, 200));
          completed++;
          onStatus?.(`Selesai: ${label} ✓`);
          onProgress?.(completed, totalImages, v.angle, v.headline || '');
          return url;
        }
        if (['failed', 'error', 'cancelled'].includes(status)) {
          const errMsg = task.result?.error || task.error || task.message || JSON.stringify(task).slice(0, 150);
          throw new Error(`Generate gagal (${label}): ${errMsg}`);
        }
        // pending / processing / queued / submitted — keep polling
      }
      throw new Error(`Timeout ${POLL_TIMEOUT / 1000}s — ${label}`);
    })
  );

  // ── Phase 3: Map flat poll results back to per-variation structure ────────
  let jobIdx = 0;
  return variations.map((v) => {
    if (!v.imagePrompt) return { ...v, imageUrl: null, imageUrls: [], imageError: 'No prompt generated' };
    const count = (angleQuantities && angleQuantities[v.angle])
      ? Math.min(Math.max(parseInt(angleQuantities[v.angle]) || 1, 1), 5)
      : globalCount;
    const varResults = pollResults.slice(jobIdx, jobIdx + count);
    jobIdx += count;
    const urls = varResults.filter((r) => r.status === 'fulfilled' && r.value).map((r) => r.value);
    const firstErr = varResults.find((r) => r.status === 'rejected')?.reason?.message;
    return {
      ...v,
      imageUrl: urls[0] || null,
      imageUrls: urls,
      imageError: urls.length === 0 ? (firstErr || 'All image generations failed') : null,
    };
  });
}

// ─── batchGenerateVideos ──────────────────────────────────────────────────────
// Uses kling-v2-6 @ 10 seconds. Mirrors batchGenerateImages — submits all jobs
// in parallel then polls until each is done (or times out at 5 min).
// productImageUrl: when provided, passed as image_url for image-to-video accuracy.

async function batchGenerateVideos(variations, aspectRatio = '9:16', productImageUrl = null) {
  const POLL_INTERVAL_MS = 8000;
  const TIMEOUT_MS = 300000; // 5 minutes per video

  const results = await Promise.allSettled(
    variations.map(async (v) => {
      if (!v.imagePrompt) return { ...v, videoUrl: null, videoError: 'No prompt generated' };
      try {
        // Submit video job
        const submitted = await generateVideo({
          prompt: v.imagePrompt,
          aspectRatio,
          duration: 10,
          imageUrl: productImageUrl || undefined,
        });
        const taskId = submitted.task_id || submitted.taskId || submitted.id;
        if (!taskId) {
          const raw = JSON.stringify(submitted).slice(0, 200);
          console.error('[batchGenerateVideos] No task_id in response:', raw);
          return { ...v, videoUrl: null, videoError: `Video API tidak mengembalikan task ID. Detail: ${raw}` };
        }
        console.log(`[batchGenerateVideos] Task submitted: ${taskId}`);

        // Poll until done
        const start = Date.now();
        while (Date.now() - start < TIMEOUT_MS) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          const task = await getTask(taskId);
          const status = (task.status || '').toLowerCase();

          if (['completed', 'succeed', 'success'].includes(status)) {
            const videoUrl =
              task.result?.video_url ||
              task.result?.url ||
              task.video_url ||
              task.url ||
              task.output?.url ||
              // Kling v2 puts it here
              task.result?.videos?.[0]?.url ||
              task.videos?.[0]?.url ||
              null;
            return {
              ...v,
              videoUrl,
              videoError: videoUrl ? null : 'Completed but no URL in response',
            };
          }

          if (['failed', 'error', 'cancelled'].includes(status)) {
            return { ...v, videoUrl: null, videoError: task.message || task.error || 'Generation failed' };
          }
          // queued / processing — keep polling
        }
        return { ...v, videoUrl: null, videoError: `Timed out after ${TIMEOUT_MS / 1000}s (task ${taskId})` };
      } catch (e) {
        return { ...v, videoUrl: null, videoError: e.message };
      }
    })
  );

  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { ...variations[i], videoUrl: null, videoError: 'Unexpected error' }
  );
}

module.exports = {
  SCALING_ANGLES,
  analyzeWinningAd,
  generateScalingAngles,
  generateVariationPrompts,
  batchGenerateImages,
  batchGenerateVideos,
  buildCarouselSlidePrompt,
};
