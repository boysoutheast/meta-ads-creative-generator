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

async function analyzeWinningAd(filePath, mimeType = 'image/jpeg') {
  const imageBuffer = fs.readFileSync(filePath);
  const imageBase64 = imageBuffer.toString('base64');
  // Use actual file mime type — sending PNG as 'image/jpeg' causes model refusal
  const safeMime = mimeType && mimeType.startsWith('image/') ? mimeType : 'image/jpeg';

  const analysisPrompt = `Describe this advertisement image in detail. Return a JSON object with these exact fields — be specific and observational, not generic:

{
  "humanScenario": "Describe specifically who is in the image, what they are doing, where they are, and what is happening around them",
  "emotionalTruth": "What specific feeling or emotion does this image evoke in a viewer — be precise, not generic",
  "hookMechanism": "Describe what element immediately catches visual attention in the first 1-3 seconds and why it is compelling",
  "narrativeStructure": {
    "setup": "What situation or problem is shown or implied",
    "tension": "What makes this situation feel urgent or important",
    "resolution": "What solution, hope, or outcome is suggested"
  },
  "visualStory": "Describe the specific objects, expressions, props, and setting visible in the image that communicate the message",
  "copyPattern": "Describe the text/headline structure and tone visible in the image, if any",
  "replicationBlueprint": "List the core visual and messaging elements that make this ad effective and how they could be adapted for a different product",
  "visualStyle": "Describe the overall visual aesthetic — photography style, editing, mood board description",
  "colorPalette": ["#hex1", "#hex2", "#hex3"],
  "lighting": "Describe the lighting style and quality",
  "mood": "Describe the overall mood and atmosphere",
  "composition": "Describe the layout and visual composition",
  "dominantAngle": "Choose one: fomo, social_proof, tutorial, curiosity_gap, before_after, problem_agitate, authority, price_anchor",
  "format": "Feed/Story/Reels",
  "primaryEmotion": "Single primary emotion evoked",
  "suggestedCopyLanguage": "id"
}

Return only valid JSON, no markdown, no explanation.`;

  let analysisRaw = await analyzeImage({ imageBase64, mimeType: safeMime, prompt: analysisPrompt });

  // Detect model refusal — retry with ultra-minimal prompt before giving up
  if (/^i('m| am) sorry|can't assist|cannot assist|i'm unable/i.test(analysisRaw.trim())) {
    console.warn('Vision model refused first attempt — retrying with minimal prompt');
    const minimalPrompt = `Look at this image and return JSON describing: colors used, layout type, what is shown, mood, and main text visible. Format: {"colorPalette":["#hex"],"composition":"...","humanScenario":"...","mood":"...","hookMechanism":"...","visualStyle":"...","dominantAngle":"fomo","primaryEmotion":"...","lighting":"natural","narrativeStructure":{"setup":"...","tension":"...","resolution":"..."},"replicationBlueprint":"...","copyPattern":"...","visualStory":"...","format":"Feed","suggestedCopyLanguage":"id"}`;
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
    console.warn('Could not parse scaling angles as JSON:', e.message);
  }

  return [];
}

// ─── buildAngleImagePrompt ───────────────────────────────────────────────────
// Per-angle structured templates — code controls layout/structure,
// GPT fills in scene details. No more free-form imagePromptEN from GPT.

function buildAngleImagePrompt(angle, winningAnalysis, productName, productVisualDescription, productPricing = {}) {
  const palette    = (winningAnalysis.colorPalette || ['#FADBD8', '#A93226', '#D5DBDB']).join(', ');
  const lighting   = winningAnalysis.lighting  || 'warm natural';
  const mood       = winningAnalysis.mood      || 'engaging';
  const headline   = angle.headline   || '';
  const sub        = angle.subheadline || '';
  const cta        = (angle.cta || 'Coba Sekarang').replace(/^CTA:\s*/i, '');
  const sd         = angle.sceneDetails || {};
  // Strip leading "Indonesian woman" from emotionalMoment if present — templates add it themselves
  const rawEmotional = sd.emotionalMoment || 'relatable everyday expression, Southeast Asian features';
  const emotional  = rawEmotional.replace(/^Indonesian woman[^,]*,?\s*/i, '').trim() || rawEmotional;
  const setting    = sd.setting        || 'clean bright environment, Indonesian home';
  const props      = sd.keyProps       || 'product prominently displayed';

  // Product description — from uploaded photo analysis or hardcoded fallback
  const prodBase = productVisualDescription
    ? `${productName} — ${productVisualDescription}`
    : `${productName} pump bottle — tall slim pink bottle, 200ML, pink and white label with "TaraCare Body Lotion" text, pump dispenser top`;
  const prodDesc = `${prodBase}. IMPORTANT: Match this product's appearance EXACTLY to the uploaded reference product photo — same bottle shape, label colors, label text, and pump dispenser design.`;

  const quality  = `Photorealistic, high-end skincare beauty editorial photography. Clean and trustworthy aesthetic. Indonesian lifestyle photography feel. No CGI look. No artificial render look. Color palette: ${palette}. ${lighting} lighting. ${mood} mood. Square 1:1 format.`;
  const bpom     = `"BPOM ✓" badge in bottom right corner, small but legible.`;
  const refNote  = `NOTE: Two reference images are provided — use the winning ad for layout/style reference and the product photo for EXACT product appearance. The product bottle in the image MUST match the reference product photo.`;

  switch (angle.angle) {

    // ── BEFORE & AFTER ──────────────────────────────────────────────────────
    case 'before_after': {
      const beforeState = sd.beforeState || 'skin area looks visibly dry, rough texture, dull, unhealthy — close-up of forearm/hand';
      const afterState  = sd.afterState  || 'same skin area looks visibly smooth, luminous, hydrated glow — same close-up';
      const timeClaim   = sd.timeClaim   || '7 hari';
      return `A clean, modern Meta Ads image in editorial split-screen style. Background is soft pink-cream gradient (#FFF0F5 to #F5F0E8). Square 1:1 format.
TYPOGRAPHY RENDERED ON IMAGE (must be perfectly legible, crisp, bold, no blur):
- Top center: dark pink (#D4547A) rounded pill badge with white text "Sebelum vs Sesudah"
- Large bold dark brown/black text upper area (2-3 lines, centered): "${headline}"
- Bottom smaller supporting text: "${sub}"
- CTA rounded pill button bottom center, dark pink (#D4547A), white bold text: "${cta} →"
MAIN SCENE:
LEFT HALF "Sebelum": Indonesian woman 25-35yo, ${sd.emotionalMoment || 'concerned/frustrated expression, looking at skin problem'}. Close-up shows ${beforeState}. Muted warm lighting, slightly desaturated. Small white rounded pill label "Sebelum" top left corner.
RIGHT HALF "Sesudah": Same Indonesian woman, smiling softly, relaxed and happy. Close-up shows ${afterState}. Brighter, warmer, more saturated lighting. Sparkle/glow effect on skin. Small white rounded pill label "Sesudah" top right corner.
DIVIDING ELEMENT: Thin vertical line in the center with a small white circle containing bold dark text "${timeClaim}".
PRODUCT FEATURED: ${prodDesc} — placed bottom center overlapping both halves, slightly in front. Product is the hero element, must be large and clearly identifiable.
FLOATING ELEMENTS: Small pink star/sparkle icons (#D4547A) scattered around the sesudah side. Small leaf/natural ingredient icon near the product bottom.
${bpom}
${refNote}
${quality}`;
    }

    // ── FOMO / URGENCY ───────────────────────────────────────────────────────
    case 'fomo': {
      return `A clean, modern Meta Ads image in editorial split layout. Background soft cream/off-white (#FFFBF5). Square 1:1 format.
LEFT 55%: Large bold typography block on cream background.
RIGHT 45%: Photorealistic lifestyle scene with thin gradient divider.
TYPOGRAPHY ON LEFT (rendered exactly, crisp, no blur, high contrast):
- Top left: coral/orange (#E8541A) rounded pill badge with white text "⚡ Stok Terbatas"
- Large bold dark brown/black headline (2-3 lines, large sans-serif): "${headline}"
- Smaller supporting text below: "${sub}"
- Orange rounded CTA pill button (#E8541A), white bold text, bottom left: "${cta} →"
RIGHT SIDE SCENE: Indonesian woman 25-35yo, ${emotional}. Setting: ${setting}. Props: ${props}.
PRODUCT: ${prodDesc} — visible in scene on right side, clearly identifiable.
FLOATING: Small urgency indicator "Tersisa sedikit" text overlay near product. Pink sparkle accents.
${bpom}
${refNote}
${quality}`;
    }

    // ── PROBLEM AGITATE ──────────────────────────────────────────────────────
    case 'problem_agitate': {
      return `A clean, modern Meta Ads image in editorial split layout. Background soft cream/light (#FFF8F5). Square 1:1 format.
LEFT 55%: Large bold typography block on light background.
RIGHT 45%: Emotional problem scene with thin divider.
TYPOGRAPHY ON LEFT (rendered exactly, crisp, bold, perfectly legible):
- Top left: dark rose (#A93226) rounded pill badge with white text "Masalah Nyata"
- Large bold dark brown/black headline (2-3 lines): "${headline}"
- Smaller supporting text: "${sub}"
- Dark pink (#D4547A) rounded CTA pill button, white bold text, bottom left: "${cta} →"
RIGHT SIDE SCENE: Indonesian woman 25-35yo, ${emotional}. Setting: ${setting}. Props showing the problem clearly: ${props}.
PRODUCT: ${prodDesc} — shown as the solution, placed at bottom of right scene or overlapping corner, clearly identifiable.
${bpom}
${refNote}
${quality}`;
    }

    // ── CURIOSITY GAP ────────────────────────────────────────────────────────
    case 'curiosity_gap': {
      return `A clean, modern Meta Ads image in editorial split layout. Background soft cream (#FFFBF5). Square 1:1 format.
LEFT 55%: Bold typography with mystery/question hook on cream background.
RIGHT 45%: Intriguing lifestyle scene.
TYPOGRAPHY ON LEFT (rendered exactly, crisp, bold, perfectly legible):
- Top left: teal/dark green (#1A7A6E) rounded pill badge with white text "Tahukah kamu?"
- Large bold dark headline with question/mystery (2-3 lines): "${headline}"
- Teaser supporting text: "${sub}"
- Teal/dark pink rounded CTA pill button, white bold text, bottom left: "${cta} →"
RIGHT SIDE SCENE: Indonesian woman 25-35yo, ${emotional}. Setting: ${setting}. Props: ${props}.
PRODUCT: ${prodDesc} — clearly visible, prominently placed, looking intriguing.
FLOATING: Small question mark or lightbulb accent icons in teal. Pink sparkle accents.
${bpom}
${refNote}
${quality}`;
    }

    // ── SOCIAL PROOF ─────────────────────────────────────────────────────────
    case 'social_proof': {
      return `A clean, modern testimonial-style Meta Ads image. Soft pink-cream background (#FFF0F5). Square 1:1 format.
TOP SECTION: Star rating badge + headline.
CENTER: Lifestyle scene with satisfied customer.
BOTTOM: Product + CTA button.
TYPOGRAPHY RENDERED ON IMAGE (perfectly legible, crisp):
- Top center: gold star rating "⭐⭐⭐⭐⭐" with pink badge "1000+ Pelanggan Puas"
- Bold dark headline (1-2 lines, large, centered): "${headline}"
- Subtext: "${sub}"
- Dark pink (#D4547A) CTA pill button, white bold text, bottom center: "${cta} →"
MAIN SCENE: Indonesian woman 25-35yo, ${emotional}. Setting: ${setting}. Props: ${props}.
OVERLAY ELEMENTS: Floating speech bubble testimonial snippet. Before/after skin comparison circles (left: rough, right: smooth).
PRODUCT: ${prodDesc} — hero product, bottom center, large and clearly identifiable.
${bpom}
${refNote}
${quality}`;
    }

    // ── TUTORIAL / HOW-TO ────────────────────────────────────────────────────
    case 'tutorial': {
      return `A clean, modern informational Meta Ads image with step-by-step layout. Soft cream/white background. Square 1:1 format.
TOP: Teal badge + headline.
MIDDLE: 3-step numbered card row.
BOTTOM: Product + CTA button.
TYPOGRAPHY RENDERED ON IMAGE (perfectly legible, crisp):
- Top center: teal/green (#1A7A6E) rounded pill badge "Cara Pakai"
- Bold dark headline (1-2 lines, large, centered): "${headline}"
- STEP 1 card: teal circle "1" + short instruction (10 words max)
- STEP 2 card: teal circle "2" + short instruction (10 words max)
- STEP 3 card: teal circle "3" + short instruction (10 words max)
- Dark pink (#D4547A) CTA pill button, white bold text, bottom center: "${cta} →"
BACKGROUND SCENE: Indonesian woman 25-35yo, ${emotional}. Setting: ${setting}. Props: ${props}. Soft, instructional, calm atmosphere.
PRODUCT: ${prodDesc} — shown in use in one of the step illustrations. Clearly identifiable.
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
      return `A clean, modern value-proposition Meta Ads image in editorial split layout. Soft cream background (#FFFBF5). Square 1:1 format.
LEFT 55%: Price comparison typography block on cream background.
RIGHT 45%: Product showcase lifestyle scene.
TYPOGRAPHY ON LEFT (rendered exactly, crisp, bold, perfectly legible):
- Top left: green (#1A7A6E) rounded pill badge "Hemat Sekarang"
- Bold dark headline (1-2 lines, large): "${headline}"
${priceLine}
- Smaller supporting text: "${sub}"
- Green/orange (#E8541A) rounded CTA pill button, white bold text, bottom left: "${cta} →"
RIGHT SIDE SCENE: Indonesian woman 25-35yo, ${emotional}. Setting: ${setting}. Props: ${props}.
PRODUCT: ${prodDesc} — large, prominently displayed on right side, clearly identifiable.
${bpom}
${refNote}
${quality}`;
    }

    // ── AUTHORITY / EXPERT ───────────────────────────────────────────────────
    case 'authority': {
      return `A clean, modern authority/expert Meta Ads image in editorial split layout. Professional, trustworthy aesthetic. Soft cream/light blue-white background. Square 1:1 format.
LEFT 55%: Credentials + headline typography on clean background.
RIGHT 45%: Confident professional lifestyle scene.
TYPOGRAPHY ON LEFT (rendered exactly, crisp, bold, perfectly legible):
- Top left: dark navy/professional (#1A3A5C) rounded pill badge "Direkomendasikan Dokter"
- Bold authoritative dark headline (2 lines): "${headline}"
- Credential supporting text: "${sub}"
- Dark professional (#1A3A5C or #D4547A) rounded CTA pill button, white bold text, bottom left: "${cta} →"
RIGHT SIDE SCENE: Indonesian woman professional/confident 28-40yo, ${emotional}. Setting: ${setting}. Props: ${props}.
PRODUCT: ${prodDesc} — presented as the endorsed certified product, clearly identifiable.
TRUST OVERLAY BADGES: BPOM certified badge, 5-star rating badge, small certification icon — as floating overlays.
${refNote}
${quality}`;
    }

    // ── DEFAULT FALLBACK ─────────────────────────────────────────────────────
    default: {
      return `A clean, modern Meta Ads image in editorial split layout. Soft cream (#FFFBF5) background. Square 1:1 format.
LEFT 55%: Large bold typography block on cream background.
RIGHT 45%: Lifestyle scene with thin gradient divider.
TYPOGRAPHY ON LEFT (rendered exactly, crisp, bold, perfectly legible):
- Bold dark brown/black headline (2-3 lines, large): "${headline}"
- Supporting subtext: "${sub}"
- Dark pink (#D4547A) rounded CTA pill button, white bold text, bottom left: "${cta} →"
RIGHT SCENE: Indonesian woman 25-35yo, ${emotional}. Setting: ${setting}. Props: ${props}.
PRODUCT: ${prodDesc} — clearly visible and identifiable.
${bpom}
${refNote}
${quality}`;
    }
  }
}

// ─── generateVariationPrompts ─────────────────────────────────────────────────
// Uses per-angle template builder — no free-form GPT prompt, no text overlay append.

async function generateVariationPrompts(winningAnalysis, angles, productName, productVisualDescription = null, productPricing = {}) {
  return angles.map((angle) => {
    const imagePrompt = buildAngleImagePrompt(angle, winningAnalysis, productName, productVisualDescription, productPricing);
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
