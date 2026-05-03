const prisma = require('../db/prisma');
const logger = require('../lib/logger');
const { generateImage, chatCompletion } = require('./apimart');
const { audit } = require('./audit');

const SIZE_MAP = {
  '1:1': '1024x1024',
  '9:16': '1024x1792',
  '4:5': '1024x1024',
  '16:9': '1792x1024',
};

const ANGLE_HOOKS = {
  fomo: 'Fear of missing out — stok terbatas, waktu terbatas',
  price_anchor: 'Fokus value & harga — perbandingan harga, ROI',
  social_proof: 'Testimoni, angka, review, "sudah X orang pakai"',
  problem_agitate: 'Identifikasi masalah menyakitkan, lalu solusi',
  problem_agitation: 'Identifikasi masalah menyakitkan, lalu solusi',
  transformation: 'Sebelum & sesudah — bukti transformasi',
  before_after: 'Sebelum & sesudah — bukti transformasi',
  authority: 'Direkomendasikan oleh ahli, sertifikasi',
  curiosity_gap: 'Hook yang bikin penasaran — "Rahasia yang..."',
  risk_reversal: 'Money back, garansi, free trial',
  tutorial: 'Edukasi step-by-step, cara pakai',
};

async function buildImagePrompt({ productName, copy, cta, angle, format }) {
  const angleHook = ANGLE_HOOKS[angle] || angle;
  const system = 'Kamu expert AI image prompt engineer untuk Meta Ads. Buat prompt yang detail, scroll-stopping, untuk DALL-E.';
  const user = `Buat image generation prompt untuk Meta Ads single image.

Produk: ${productName}
Angle: ${angle} — ${angleHook}
Headline copy: "${copy}"
CTA: ${cta}
Format: ${format}

Output prompt (Inggris, 100-180 kata) yang:
- Replikasi vibe scroll-stopping high-CTR Meta Ads
- Match angle yang dipilih
- Mulai dengan: "Meta Ads creative, scroll-stopping, high-CTR visual,"
- TIDAK include teks/tulisan
- Include subject, setting, lighting, color, mood, composition

Output HANYA prompt text-nya saja, tanpa quote tanpa penjelasan.`;
  const result = await chatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    maxTokens: 350,
    temperature: 0.8,
  });
  return result.trim().replace(/^"+|"+$/g, '');
}

/**
 * Process a generation job. Updates DB row + writes audit on completion.
 */
async function processSingleImageJob(jobId) {
  const log = logger.child({ jobId, worker: 'single_image' });
  const job = await prisma.generationJob.findUnique({ where: { id: jobId } });
  if (!job) {
    log.error('job_not_found');
    return;
  }
  if (job.status !== 'pending') {
    log.warn({ status: job.status }, 'job_already_taken');
    return;
  }

  await prisma.generationJob.update({
    where: { id: jobId },
    data: { status: 'processing', startedAt: new Date() },
  });
  log.info({ angle: job.angle }, 'job_processing');

  const start = Date.now();
  try {
    const input = job.inputPayload;
    const prompt = await buildImagePrompt({
      productName: input.productName,
      copy: input.copy,
      cta: input.cta,
      angle: job.angle,
      format: input.format,
    });

    const size = SIZE_MAP[input.format] || '1024x1024';
    const images = await generateImage({ prompt, size });
    const imageUrl = images[0]?.url;
    if (!imageUrl) throw new Error('No image returned by APIMART');

    const durationMs = Date.now() - start;
    // Cost is approximate — DALL-E 3 standard 1024x1024 ~$0.04
    const costUsd = size.includes('1792') ? 0.08 : 0.04;

    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        resultUrl: imageUrl,
        resultPrompt: prompt,
        completedAt: new Date(),
        durationMs,
        costUsd,
        apiUsed: 'apimart/dall-e-3',
      },
    });

    await audit({
      userId: job.userId,
      action: 'generation_completed',
      metadata: { jobId, type: job.type, angle: job.angle, durationMs, costUsd },
    });
    log.info({ durationMs, costUsd }, 'job_completed');
  } catch (err) {
    const durationMs = Date.now() - start;
    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        errorMessage: err.message?.slice(0, 1000) || 'Unknown error',
        completedAt: new Date(),
        durationMs,
      },
    });
    await audit({
      userId: job.userId,
      action: 'generation_failed',
      metadata: { jobId, error: err.message?.slice(0, 200) },
    });
    log.error({ err: err.message }, 'job_failed');
  }
}

module.exports = { processSingleImageJob };
