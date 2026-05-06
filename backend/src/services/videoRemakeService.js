/**
 * videoRemakeService.js
 *
 * Pipeline: long source video → 3 key clips → doubao-seedance-2.0 base remake
 *           → download remade clips → FFmpeg concat → final ~20s video
 *
 * Cost: ~$0.044/sec of output. 20s output ≈ $0.88 per remake.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const { analyzeImage, chatCompletion, generateVideoFromReference, getTask } = require('./apimart');
const config = require('../config');

// ─── In-memory job store ──────────────────────────────────────────────────────

/**
 * @typedef {Object} RemakeJob
 * @property {string} id
 * @property {'analyzing'|'splitting'|'generating'|'merging'|'done'|'failed'} status
 * @property {number} progress  0-100
 * @property {string[]} log
 * @property {string|null} videoUrl    Final merged video public URL
 * @property {string|null} error
 * @property {number} createdAt
 */

/** @type {Map<string, RemakeJob>} */
const jobs = new Map();

function createJob() {
  const id = uuidv4();
  /** @type {RemakeJob} */
  const job = {
    id,
    status: 'analyzing',
    progress: 0,
    log: [],
    videoUrl: null,
    error: null,
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  // GC after 2 hours
  setTimeout(() => jobs.delete(id), 2 * 60 * 60 * 1000);
  return job;
}

function updateJob(job, patch) {
  Object.assign(job, patch);
}

function getJob(id) {
  return jobs.get(id) || null;
}

// ─── FFmpeg helpers ───────────────────────────────────────────────────────────

function getVideoDuration(videoPath) {
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      { timeout: 15000 }
    ).toString().trim();
    return parseFloat(out) || 60;
  } catch {
    return 60;
  }
}

function extractFramesForAnalysis(videoPath, count = 6) {
  const framesDir = path.join(path.dirname(videoPath), `frames_${Date.now()}`);
  fs.mkdirSync(framesDir, { recursive: true });
  try {
    const interval = Math.max(1, Math.floor(getVideoDuration(videoPath) / count));
    execSync(
      `ffmpeg -i "${videoPath}" -vf "fps=1/${interval},scale=512:-1" -frames:v ${count} "${framesDir}/frame%03d.jpg" -y`,
      { timeout: 30000 }
    );
    const frames = fs.readdirSync(framesDir)
      .filter((f) => f.endsWith('.jpg'))
      .sort()
      .map((f) => fs.readFileSync(path.join(framesDir, f)).toString('base64'));
    fs.rmSync(framesDir, { recursive: true, force: true });
    return frames;
  } catch (e) {
    try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch {}
    console.warn('[remake] frame extraction failed:', e.message);
    return [];
  }
}

/**
 * Split source video into N clips using FFmpeg.
 * Returns array of local file paths.
 */
function splitVideoClips(videoPath, clips, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const outPaths = [];
  for (let i = 0; i < clips.length; i++) {
    const { start, duration } = clips[i];
    const outFile = path.join(outputDir, `clip_${i + 1}.mp4`);
    execSync(
      `ffmpeg -i "${videoPath}" -ss ${start.toFixed(2)} -t ${duration.toFixed(2)} ` +
      `-c:v libx264 -preset fast -crf 23 -c:a aac -avoid_negative_ts make_zero "${outFile}" -y`,
      { timeout: 120000 }
    );
    outPaths.push(outFile);
    console.log(`[remake] clip ${i + 1} → ${start}s–${(start + duration).toFixed(1)}s saved: ${outFile}`);
  }
  return outPaths;
}

/**
 * Download a URL to a local file.
 */
async function downloadFile(url, destPath) {
  const res = await axios.get(url, { responseType: 'stream', timeout: 120000 });
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    res.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

/**
 * Merge an array of local video files into one output file using FFmpeg.
 */
function mergeVideoClips(inputPaths, outputPath) {
  const concatFile = outputPath + '.concat.txt';
  const lines = inputPaths.map((p) => `file '${p}'`).join('\n');
  fs.writeFileSync(concatFile, lines);
  execSync(
    `ffmpeg -f concat -safe 0 -i "${concatFile}" ` +
    `-c:v libx264 -preset fast -crf 23 -c:a aac "${outputPath}" -y`,
    { timeout: 180000 }
  );
  try { fs.unlinkSync(concatFile); } catch {}
  console.log(`[remake] merged ${inputPaths.length} clips → ${outputPath}`);
}

// ─── AI helpers ───────────────────────────────────────────────────────────────

/**
 * Use GPT-4o (via representative frames) to pick N clip start times.
 * Returns [{start, duration, reason}, ...]
 */
async function pickClipTimestamps(videoPath, clipCount = 3, clipDuration = 7) {
  const totalDuration = getVideoDuration(videoPath);
  const frames = extractFramesForAnalysis(videoPath, Math.min(8, Math.floor(totalDuration / 5)));

  const taskDesc = `You are a video editor. Source video is ${totalDuration.toFixed(0)} seconds long.
Select ${clipCount} non-overlapping scenes for a video remix:
- Each scene should be ${clipDuration} seconds
- Pick the most visually compelling/product-relevant moments
- Spread them across the video — avoid clustering
- Do NOT start before second 2
- Each start + ${clipDuration} must be ≤ ${totalDuration.toFixed(0)}

Return ONLY a JSON array (no markdown):
[
  {"start": 5, "duration": ${clipDuration}, "reason": "hero product shot"},
  {"start": 28, "duration": ${clipDuration}, "reason": "testimonial/usage"},
  {"start": 52, "duration": ${clipDuration}, "reason": "CTA / transformation"}
]`;

  let raw = '';
  try {
    if (frames.length >= 2) {
      const midFrame = frames[Math.floor(frames.length / 2)];
      raw = await analyzeImage({
        imageBase64: midFrame,
        mimeType: 'image/jpeg',
        prompt: taskDesc,
      });
    } else {
      raw = await chatCompletion({
        model: config.models.chat,
        messages: [{ role: 'user', content: taskDesc }],
        maxTokens: 300,
      });
    }
    const jsonMatch = raw.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed
        .slice(0, clipCount)
        .map((c) => ({
          start: Math.max(2, Math.min(parseFloat(c.start) || 5, totalDuration - clipDuration - 0.5)),
          duration: Math.min(parseFloat(c.duration) || clipDuration, 7),
          reason: c.reason || '',
        }));
    }
  } catch (e) {
    console.warn('[remake] timestamp AI pick failed, using evenly spaced:', e.message);
  }

  // Fallback: evenly spaced
  const spacing = totalDuration / (clipCount + 1);
  return Array.from({ length: clipCount }, (_, i) => ({
    start: Math.round(spacing * (i + 1)),
    duration: clipDuration,
    reason: `scene ${i + 1}`,
  }));
}

/**
 * Generate a remake prompt for doubao.
 * English, cinematic, 80-120 words. Product-focused, references visual structure.
 */
async function buildRemakePrompt(productName, productDescription, productVisualDescription) {
  const productContext = [
    `Product: ${productName}`,
    productDescription ? `Description: ${productDescription}` : null,
    productVisualDescription ? `Visual: ${productVisualDescription}` : null,
  ].filter(Boolean).join('. ');

  const prompt = await chatCompletion({
    model: config.models.chat,
    messages: [
      {
        role: 'system',
        content:
          'You write 80-120 word English prompts for AI video generation. ' +
          'Focus on product showcase, clean background, professional lighting, ' +
          'smooth cinematic camera movement. Output ONLY the prompt, no explanations.',
      },
      {
        role: 'user',
        content:
          `Write a video generation prompt that showcases this product in a dynamic, professional Meta Ad style. ` +
          `The AI will use an existing video clip as structural reference (preserving motion) and restyle it. ` +
          `${productContext}. ` +
          `Include: product in foreground, clean modern aesthetic, smooth camera motion, warm natural lighting, ` +
          `Indonesian beauty/lifestyle context. End with: high quality, 4K, sharp focus.`,
      },
    ],
    maxTokens: 200,
    temperature: 0.7,
  });

  return prompt.trim();
}

// ─── Poll helpers ─────────────────────────────────────────────────────────────

async function pollTaskUntilDone(taskId, { pollMs = 6000, timeoutMs = 300000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollMs));
    const task = await getTask(taskId);
    const status = (task.status || '').toLowerCase();

    if (['completed', 'succeed', 'success'].includes(status)) {
      const videoUrl =
        task.result?.video_url ||
        task.result?.url ||
        task.result?.videos?.[0]?.url ||
        task.videos?.[0]?.url ||
        task.video_url ||
        task.url ||
        task.output?.url ||
        null;
      if (!videoUrl) throw new Error('Task completed but no video URL found: ' + JSON.stringify(task).slice(0, 200));
      return videoUrl;
    }

    if (['failed', 'error', 'cancelled'].includes(status)) {
      throw new Error('Doubao task failed: ' + (task.message || task.error || JSON.stringify(task).slice(0, 200)));
    }

    console.log(`[remake] task ${taskId} status=${status} progress=${task.progress || '?'}`);
  }
  throw new Error(`Doubao task ${taskId} timed out after ${timeoutMs}ms`);
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

/**
 * Start the full video remake pipeline asynchronously.
 * Returns a job object immediately; caller polls getJob(id).
 *
 * @param {Object} opts
 * @param {string} opts.sourceVideoPath  - Local path to uploaded source video
 * @param {string} opts.productName
 * @param {string} [opts.productDescription]
 * @param {string} [opts.productPhotoBase64]
 * @param {string} [opts.productPhotoMime]
 * @param {string} [opts.aspectRatio]   - '9:16' | '16:9' | '1:1'
 * @param {number} [opts.targetSeconds] - total output duration goal (default 21)
 * @param {number} [opts.clipCount]     - number of clips (default 3)
 */
function startRemakeJob(opts) {
  const job = createJob();
  _runRemake(job, opts).catch((err) => {
    console.error('[remake] job', job.id, 'unhandled error:', err.message);
    updateJob(job, { status: 'failed', error: err.message });
  });
  return job;
}

async function _runRemake(job, {
  sourceVideoPath,
  productName,
  productDescription = '',
  productPhotoBase64 = null,
  productPhotoMime = 'image/jpeg',
  aspectRatio = '9:16',
  targetSeconds = 21,
  clipCount = 3,
}) {
  const uploadDir = path.resolve(config.upload.uploadDir);
  const remakesDir = path.join(uploadDir, 'remakes');
  const jobDir = path.join(remakesDir, `job_${job.id}`);
  const tempClipsDir = path.join(jobDir, 'source_clips');
  const remadeTempDir = path.join(jobDir, 'remade_clips');
  fs.mkdirSync(tempClipsDir, { recursive: true });
  fs.mkdirSync(remadeTempDir, { recursive: true });

  const addLog = (msg) => { job.log.push(msg); console.log(`[remake:${job.id}] ${msg}`); };

  try {
    // ── Phase 1: Analyze source video ─────────────────────────────────────────
    addLog('Menganalisis video sumber…');
    updateJob(job, { status: 'analyzing', progress: 5 });

    const clipDuration = Math.min(Math.ceil(targetSeconds / clipCount), 7);
    const clips = await pickClipTimestamps(sourceVideoPath, clipCount, clipDuration);
    const totalOutput = clips.reduce((s, c) => s + c.duration, 0);
    addLog(`Timestamp dipilih: ${clips.map((c) => `${c.start}s (${c.reason})`).join(', ')}`);
    addLog(`Total durasi output: ${totalOutput}s | estimasi biaya: $${(totalOutput * 0.044).toFixed(2)}`);
    updateJob(job, { progress: 20 });

    // ── Phase 2: Analyze product photo (optional) ──────────────────────────────
    let productVisualDescription = null;
    if (productPhotoBase64) {
      try {
        addLog('Menganalisis foto produk…');
        productVisualDescription = await analyzeImage({
          imageBase64: productPhotoBase64,
          mimeType: productPhotoMime,
          prompt: 'Describe this product visually in detail: shape, color, packaging, texture, size, label/branding. Be specific for AI video generation. Under 80 words.',
        });
      } catch (e) {
        addLog(`Analisis foto produk gagal (non-fatal): ${e.message}`);
      }
    }

    // ── Phase 3: Split source video into clips ─────────────────────────────────
    addLog(`Memotong video menjadi ${clipCount} klip…`);
    updateJob(job, { status: 'splitting', progress: 30 });

    const clipPaths = splitVideoClips(sourceVideoPath, clips, tempClipsDir);

    // Construct public URLs for the clips (served via static /uploads route)
    const baseUrl = config.backendPublicUrl;
    const clipPublicUrls = clipPaths.map((p) => {
      const rel = path.relative(uploadDir, p).replace(/\\/g, '/');
      return `${baseUrl}/uploads/${rel}`;
    });
    addLog(`Klip tersedia di: ${clipPublicUrls.map((u) => u.slice(-30)).join(', ')}`);
    updateJob(job, { progress: 40 });

    // ── Phase 4: Build remake prompt ───────────────────────────────────────────
    addLog('Membuat prompt remake…');
    const remakePrompt = await buildRemakePrompt(productName, productDescription, productVisualDescription);
    addLog(`Prompt: "${remakePrompt.slice(0, 80)}…"`);
    updateJob(job, { progress: 45 });

    // ── Phase 5: Submit all clips to doubao in parallel ────────────────────────
    addLog(`Mengirim ${clipCount} klip ke doubao-seedance-2.0…`);
    updateJob(job, { status: 'generating', progress: 50 });

    const submittedTasks = await Promise.all(
      clipPublicUrls.map(async (clipUrl, i) => {
        const item = await generateVideoFromReference({
          videoUrl: clipUrl,
          prompt: remakePrompt,
          duration: clips[i].duration,
          aspectRatio,
        });
        const taskId = item?.task_id || item?.taskId || item?.id;
        if (!taskId) throw new Error(`Clip ${i + 1}: no task_id returned. Response: ${JSON.stringify(item).slice(0, 200)}`);
        addLog(`Clip ${i + 1} task_id: ${taskId}`);
        return taskId;
      })
    );

    updateJob(job, { progress: 55 });

    // ── Phase 6: Poll all doubao tasks until done ──────────────────────────────
    addLog('Menunggu doubao selesai generate (estimasi 3-8 menit)…');

    const progressPerTask = 25 / clipCount; // share 55%→80% across tasks
    const remadeUrls = [];

    for (let i = 0; i < submittedTasks.length; i++) {
      addLog(`Polling clip ${i + 1}/${submittedTasks.length}…`);
      const videoUrl = await pollTaskUntilDone(submittedTasks[i], { pollMs: 6000, timeoutMs: 360000 });
      remadeUrls.push(videoUrl);
      addLog(`Clip ${i + 1} selesai: ${videoUrl.slice(0, 60)}`);
      updateJob(job, { progress: Math.round(55 + progressPerTask * (i + 1)) });
    }

    // ── Phase 7: Download remade clips ────────────────────────────────────────
    addLog('Mengunduh klip yang sudah di-remake…');
    updateJob(job, { status: 'merging', progress: 82 });

    const localRemadePaths = [];
    for (let i = 0; i < remadeUrls.length; i++) {
      const dest = path.join(remadeTempDir, `remade_${i + 1}.mp4`);
      await downloadFile(remadeUrls[i], dest);
      localRemadePaths.push(dest);
      addLog(`Downloaded clip ${i + 1} → ${dest}`);
    }

    // ── Phase 8: Merge into final video ───────────────────────────────────────
    addLog('Menggabungkan klip menjadi video final…');
    updateJob(job, { progress: 90 });

    const finalPath = path.join(remakesDir, `final_${job.id}.mp4`);
    mergeVideoClips(localRemadePaths, finalPath);

    // Clean up temp dirs
    try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch {}
    // Clean up source video
    try { fs.unlinkSync(sourceVideoPath); } catch {}

    const finalRel = path.relative(uploadDir, finalPath).replace(/\\/g, '/');
    const finalUrl = `${baseUrl}/uploads/${finalRel}`;

    addLog(`Selesai! Final video: ${finalUrl}`);
    updateJob(job, {
      status: 'done',
      progress: 100,
      videoUrl: finalUrl,
    });

  } catch (err) {
    // Clean up on failure
    try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch {}
    try { fs.unlinkSync(sourceVideoPath); } catch {}

    addLog(`Error: ${err.message}`);
    updateJob(job, { status: 'failed', error: err.message });
    throw err;
  }
}

module.exports = { startRemakeJob, getJob };
