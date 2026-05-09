/**
 * reelsGenerator.js — Core clip generation + merge pipeline for /generate-stream
 *
 * Called by routes/reels.js POST /generate-stream.
 * Handles the full loop:
 *   1. Resume-aware clip generation (up to MAX_CLIP_ATTEMPTS each)
 *   2. Progress SSE events
 *   3. Download + verify clips
 *   4. FFmpeg merge + verify merged
 *   5. Session state updates throughout
 *
 * @param {object} session - live session object (mutated in place)
 * @param {function} sse   - SSE send helper: sse(res, data)
 * @param {function} saveSession - persists session to all tiers
 * @returns {object} mergedInfo - { path, sha256, sizeBytes }
 */

const { generateFirstClip, pollUntilComplete } = require('./geminiGenService');
const {
  downloadClips, verifyClips, mergeClips, verifyMerged, cleanupClips,
} = require('./reelsMerger');
const { auditLog } = require('./sessionStore');

const MAX_CLIP_ATTEMPTS = 3;

async function runGeneration(session, sse, saveSession) {
  const { totalClips, storyboard, mode, sessionId, aspectRatio = 'portrait', resolution = '720p', clipDuration = 10 } = session;

  session.status = 'generating';
  auditLog(session, 'info', 'GENERATION_START', { totalClips });
  await saveSession(session);

  sse({ type: 'start', totalClips, sessionId });

  // ── generate each clip (resume-aware) ──────────────────────────────────────
  for (let i = 0; i < totalClips; i++) {
    const existingClip = session.clips.find(c => c.index === i && c.status === 'done');

    if (existingClip) {
      // Already done — skip (resume mode)
      sse({ type: 'clip_skip', clipIndex: i, totalClips, uuid: existingClip.uuid });
      auditLog(session, 'info', `CLIP_${i + 1}_SKIPPED_RESUME`, { uuid: existingClip.uuid });
      continue;
    }

    sse({ type: 'clip_start', clipIndex: i, totalClips });

    // Find or init clip record
    let clipRecord = session.clips.find(c => c.index === i);
    if (!clipRecord) {
      clipRecord = { index: i, status: 'pending', uuid: null, videoUrl: null, sha256: null, attempts: 0, error: null };
      session.clips.push(clipRecord);
    }

    const grokPrompt = storyboard[i]?.grokPrompt;
    if (!grokPrompt) {
      const msg = `Storyboard missing grokPrompt for clip ${i + 1}`;
      auditLog(session, 'error', `CLIP_${i + 1}_NO_PROMPT`, { error: msg });
      session.status = 'error';
      await saveSession(session);
      sse({ type: 'error', message: msg, resumable: false });
      return null;
    }

    // Collect image URLs: scene image first, then all user reference images
    const imageUrls = [];
    const sceneImageUrl = storyboard[i]?.sceneImageUrl;
    if (sceneImageUrl) imageUrls.push(sceneImageUrl);
    (session.referenceImageUrls || []).forEach(r => { if (r.url) imageUrls.push(r.url); });

    let clipDone = false;

    for (let attempt = 1; attempt <= MAX_CLIP_ATTEMPTS; attempt++) {
      clipRecord.attempts = attempt;
      auditLog(session, 'info', `CLIP_${i + 1}_ATTEMPT_${attempt}`, {
        prompt: grokPrompt.slice(0, 80),
        imageUrls: imageUrls.map(u => u.slice(-40)), // log just the tail for readability
      });

      try {
        const result = await generateFirstClip({ prompt: grokPrompt, mode, imageUrls, aspectRatio, resolution, clipDuration });

        clipRecord.uuid = result.uuid;
        clipRecord.status = 'polling';
        await saveSession(session);

        const clip = await pollUntilComplete(result.uuid, (pct) => {
          sse({ type: 'clip_progress', clipIndex: i, pct, totalClips });
        });

        clipRecord.status = 'done';
        clipRecord.videoUrl = clip.videoUrl;
        clipRecord.thumbnailUrl = clip.thumbnailUrl;
        clipRecord.completedAt = new Date().toISOString();

        auditLog(session, 'info', `CLIP_${i + 1}_DONE`, {
          uuid: result.uuid,
          videoUrl: clip.videoUrl,
          attempt,
        });
        await saveSession(session);

        sse({
          type: 'clip_done',
          clipIndex: i,
          totalClips,
          clip: { uuid: result.uuid, videoUrl: clip.videoUrl, thumbnailUrl: clip.thumbnailUrl },
        });

        clipDone = true;
        break;

      } catch (err) {
        clipRecord.error = err.message;
        auditLog(session, 'error', `CLIP_${i + 1}_ATTEMPT_${attempt}_FAIL`, { error: err.message });
        await saveSession(session);

        if (attempt < MAX_CLIP_ATTEMPTS) {
          sse({ type: 'clip_retry', clipIndex: i, attempt, error: err.message });
          await sleep(3000 * attempt); // exponential backoff
        }
      }
    }

    if (!clipDone) {
      clipRecord.status = 'error';
      session.status = 'partial';
      auditLog(session, 'error', `CLIP_${i + 1}_FAILED_ALL_ATTEMPTS`, { clipIndex: i });
      await saveSession(session);

      sse({
        type: 'error',
        message: `Clip ${i + 1} failed after ${MAX_CLIP_ATTEMPTS} attempts. Session saved — you can resume.`,
        resumable: true,
        failedAtClip: i,
        sessionId,
      });
      return null; // caller should end SSE
    }
  }

  // ── all clips done — merge ──────────────────────────────────────────────────
  session.status = 'merging';
  auditLog(session, 'info', 'MERGE_START', { clipCount: totalClips });
  await saveSession(session);

  sse({ type: 'merge_start', totalClips });

  // Download clips (sorted by index to guarantee correct FFmpeg concat order)
  sse({ type: 'merge_progress', phase: 'downloading', progress: 0 });
  auditLog(session, 'info', 'MERGE_DOWNLOADING', {});

  const doneClips = session.clips
    .filter(c => c.status === 'done')
    .sort((a, b) => a.index - b.index);

  await downloadClips(sessionId, doneClips, ({ clipIndex, total }) => {
    sse({ type: 'merge_progress', phase: 'downloading', clipIndex, total });
  });

  // Verify downloads — log SHA256 + size per clip
  auditLog(session, 'info', 'MERGE_VERIFYING_CLIPS', {});
  const verified = await verifyClips(sessionId, totalClips);
  verified.forEach(v => {
    auditLog(session, 'info', `CLIP_${v.index + 1}_VERIFIED`, { sha256: v.sha256, sizeBytes: v.sizeBytes });
  });

  // FFmpeg merge
  sse({ type: 'merge_progress', phase: 'merging', progress: 0 });
  auditLog(session, 'info', 'FFMPEG_START', {});

  await mergeClips(sessionId, totalClips, ({ phase, progress }) => {
    sse({ type: 'merge_progress', phase, progress: Math.round(progress) });
  });

  // Verify merged + cleanup individual clips
  const mergedInfo = await verifyMerged(sessionId);

  session.mergedPath = mergedInfo.path;
  session.mergedHash = mergedInfo.sha256;
  session.sizeBytes = mergedInfo.sizeBytes;
  session.status = 'done';
  session.downloadReady = true;

  auditLog(session, 'info', 'MERGE_DONE', {
    mergedPath: mergedInfo.path,
    mergedHash: mergedInfo.sha256,
    sizeBytes: mergedInfo.sizeBytes,
  });

  cleanupClips(sessionId, totalClips);
  auditLog(session, 'info', 'CLIPS_CLEANED', { count: totalClips });

  await saveSession(session);

  return mergedInfo;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { runGeneration };
