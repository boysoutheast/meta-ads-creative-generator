# CC Prompt: Fix All Video Generation → GeminiGen

## Context

Project: `/Users/siscaliman/Documents/Claude/Projects/Ads creative generator`
Monorepo: `backend/` (Express.js) + `frontend/` (Next.js 14 TypeScript)

**Rule: ALL video generation must use GeminiGen (api.geminigen.ai). NOT apimart.**
- Image generation → apimart `gpt-image-2` ✅ (already correct, don't touch)
- Video Remake → apimart `doubao-seedance-2-0` ✅ (already correct, **DO NOT TOUCH**)
- All other video generation → GeminiGen `grok-3` ❌ currently broken (uses apimart kling)

The existing `backend/src/services/geminiGenService.js` already works correctly for AI Reels.
Use it as the canonical pattern for all other video features.

---

## GeminiGen Service (reference — do NOT modify)

```js
// backend/src/services/geminiGenService.js — key exports:
const { generateFirstClip, extendClip, pollUntilComplete } = require('./geminiGenService');

// generateFirstClip({ prompt, mode, imageUrls, aspectRatio, resolution, clipDuration })
//   → returns { uuid }   (async job, use pollUntilComplete after)
//
// pollUntilComplete(uuid, onProgress?)
//   → resolves { uuid, videoUrl, thumbnailUrl }   on success
//   → throws on timeout/failure
//
// Aspect ratio values: 'portrait'(9:16) | 'landscape'(16:9) | 'square'(1:1)
// Resolution: '480p' | '720p'
// Duration: 6 | 10 | 15 (integer seconds)
// Mode: 'normal' | 'extremely-crazy' | 'extremely-spicy-or-crazy' | 'custom'
```

**Aspect ratio mapping** (apimart uses '9:16' strings, GeminiGen uses named values):
```js
function toGeminiAspectRatio(ar) {
  const map = { '9:16': 'portrait', '16:9': 'landscape', '1:1': 'square', '4:5': 'portrait', '2:3': 'vertical', '3:2': 'horizontal' };
  return map[ar] || 'portrait';
}
```

---

## Files to Fix

### 1. `backend/src/config/index.js`
- Remove the line: `video: process.env.VIDEO_MODEL || 'kling-v2-6',`
  - This model is no longer used for any feature (video gen moved to GeminiGen; remake has its own `remake` key)
- Keep `remake: process.env.REMAKE_MODEL || 'doubao-seedance-2-0'` (used by videoRemakeService)

---

### 2. `backend/src/services/scalingService.js` — `batchGenerateVideos()`

The function at line ~1205 currently uses `generateVideo()` + `getTask()` from apimart (kling-v2-6).

**Replace the entire `batchGenerateVideos` function** with a GeminiGen implementation:

```js
const { generateFirstClip, pollUntilComplete } = require('./geminiGenService');

function toGeminiAspectRatio(ar) {
  const map = { '9:16': 'portrait', '16:9': 'landscape', '1:1': 'square', '4:5': 'portrait', '2:3': 'vertical', '3:2': 'horizontal' };
  return map[ar] || 'portrait';
}

async function batchGenerateVideos(variations, aspectRatio = '9:16', productImageUrl = null) {
  const geminiAR = toGeminiAspectRatio(aspectRatio);

  const results = await Promise.allSettled(
    variations.map(async (v) => {
      if (!v.imagePrompt) return { ...v, videoUrl: null, videoError: 'No prompt generated' };
      try {
        const imageUrls = productImageUrl ? [productImageUrl] : [];
        const { uuid } = await generateFirstClip({
          prompt: v.imagePrompt,
          mode: 'normal',
          imageUrls,
          aspectRatio: geminiAR,
          resolution: '720p',
          clipDuration: 10,
        });
        console.log(`[batchGenerateVideos] GeminiGen job submitted: ${uuid}`);
        const { videoUrl } = await pollUntilComplete(uuid);
        return { ...v, videoUrl: videoUrl || null, videoError: videoUrl ? null : 'Completed but no URL' };
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
```

Also remove unused `generateVideo` and `getTask` from the `require('./apimart')` import at the top of scalingService.js (only if they are not used elsewhere in that file — grep first).

---

### 3. `backend/src/routes/generate.js`

**POST `/api/generate/video`** (lines ~100–110): Currently calls `generateVideo()` from apimart.

Replace with GeminiGen — poll to completion server-side and return `{ videoUrl, uuid }`:

```js
const { generateFirstClip, pollUntilComplete } = require('../services/geminiGenService');

function toGeminiAspectRatio(ar) {
  const map = { '9:16': 'portrait', '16:9': 'landscape', '1:1': 'square' };
  return map[ar] || 'portrait';
}

router.post('/video', async (req, res) => {
  const { prompt, aspectRatio = '9:16', duration = 10 } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const { uuid } = await generateFirstClip({
    prompt,
    mode: 'normal',
    aspectRatio: toGeminiAspectRatio(aspectRatio),
    resolution: '720p',
    clipDuration: typeof duration === 'number' ? duration : parseInt(duration) || 10,
  });

  const { videoUrl, thumbnailUrl } = await pollUntilComplete(uuid);
  res.json({ uuid, videoUrl, thumbnailUrl });
});
```

**GET `/api/generate/video/:taskId`** (lines ~116–120): Currently polls apimart status. With the new sync approach this is no longer needed, but keep it for safety — update it to poll GeminiGen history instead:

```js
const axios = require('axios');
router.get('/video/:taskId', async (req, res) => {
  const { taskId } = req.params;
  try {
    const { data } = await axios.get(`https://api.geminigen.ai/uapi/v1/history/${taskId}`, {
      headers: { 'x-api-key': process.env.GEMINIGEN_API_KEY || '' },
      timeout: 10000,
    });
    const videoUrl = data.generated_video?.[0]?.video_url || null;
    res.json({
      uuid: taskId,
      status: data.status === 2 ? 'completed' : data.status === 3 ? 'failed' : 'processing',
      videoUrl,
      progress: data.status_percentage || 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

Also remove unused `checkVideoStatus` from the apimart import at the top of generate.js (grep first to confirm it's only used here).

---

### 4. `backend/src/routes/create.js`

**POST `/api/create/generate`** — `outputType === 'video'` block (around lines 106–112):

Currently:
```js
} else if (outputType === 'video') {
  const videoResult = await generateVideo({ prompt: imagePrompt, aspectRatio: format, duration: 5 });
  videoJobId = videoResult.id || videoResult.taskId || null;
}
```

Replace with GeminiGen (poll to completion, store URL directly instead of job ID):

```js
} else if (outputType === 'video') {
  const { generateFirstClip, pollUntilComplete } = require('../services/geminiGenService');
  const geminiARMap = { '9:16': 'portrait', '16:9': 'landscape', '1:1': 'square', '4:5': 'portrait' };
  const { uuid } = await generateFirstClip({
    prompt: imagePrompt,
    mode: 'normal',
    aspectRatio: geminiARMap[format] || 'portrait',
    resolution: '720p',
    clipDuration: 10,
  });
  const result = await pollUntilComplete(uuid);
  videoJobId = result.videoUrl || null; // reuse videoJobId field to carry the URL
}
```

Also update the return object for video variations — rename `videoJobId` to `videoUrl` in the result object for clarity, and update the frontend page `/create` accordingly if it polls a separate status endpoint.

Check `frontend/app/(app)/create/page.tsx` — if it polls `/api/create/video-status` or similar, those references should be removed or the component should just display `videoUrl` directly from the response.

Remove unused `generateVideo` from the apimart import at the top of create.js IF it's not used elsewhere in that file.

---

### 5. `backend/src/routes/scale.js`

**POST `/api/scale/generate-video`** (around line 412): Currently calls `generateVideo()` from apimart.

Replace with GeminiGen sync approach:

```js
const { generateFirstClip, pollUntilComplete } = require('../services/geminiGenService');

router.post('/generate-video', async (req, res) => {
  const { prompt, aspectRatio = '9:16', duration = 10 } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  const geminiARMap = { '9:16': 'portrait', '16:9': 'landscape', '1:1': 'square' };
  const { uuid } = await generateFirstClip({
    prompt,
    mode: 'normal',
    aspectRatio: geminiARMap[aspectRatio] || 'portrait',
    resolution: '720p',
    clipDuration: typeof duration === 'number' ? duration : parseInt(duration) || 10,
  });
  const { videoUrl, thumbnailUrl } = await pollUntilComplete(uuid);
  res.json({ uuid, videoUrl, thumbnailUrl });
});
```

Also remove unused `generateVideo` from the apimart import at the top of scale.js (grep first).

---

### 6. `backend/src/services/singleImageWorker.js`

Find the comment `'apimart/dall-e-3'` (or similar wrong model name). Change to `'apimart/gpt-image-2'`.

---

## Verification Steps

After all code changes:

1. **Grep check** — confirm no remaining references to `kling-v2-6` in routes/services:
   ```bash
   grep -r "kling" backend/src/routes/ backend/src/services/ --include="*.js"
   ```
   Expected: zero results (only OK in comments if explaining what was removed).

2. **Grep check** — confirm `generateVideo` from apimart is NOT called in the wrong places:
   ```bash
   grep -r "generateVideo" backend/src/routes/ backend/src/services/ --include="*.js"
   ```
   Should only appear in `videoRemakeService.js` (if it uses it) and NOT in: scale.js, scale-video.js, create.js, generate.js, scalingService.js.

3. **TypeScript check** (frontend):
   ```bash
   cd frontend && npx tsc --noEmit
   ```
   Must be 0 errors.

4. **Commit + push** — use the git lock workaround (FUSE bindfs requires rename not delete):
   ```python
   import os
   # Run this before git commit if .git/index.lock exists:
   try:
       os.rename('.git/index.lock', '.git/index.lock.bak')
   except: pass
   try:
       os.rename('.git/HEAD.lock', '.git/HEAD.lock.bak')
   except: pass
   ```
   Then: `git add -A && git commit -m "fix: replace all kling video gen with GeminiGen grok-3" && git push origin main`

5. **Deploy to Railway**:
   ```bash
   railway up --detach
   ```
   Or trigger via Railway dashboard if CLI unavailable.

6. **Self-audit** — after deploy, check each feature that generates video:
   - Scale Winning Video (`/scale-video`) → should return GeminiGen videoUrl
   - Create w/ Reference (`/create`, outputType=video) → videoUrl in response
   - Generate Video (`/generate/video`) → videoUrl in response
   - Scale generate-video (`/scale/generate-video`) → videoUrl in response
   - Create AI Reels (`/reels`) → unchanged, still uses GeminiGen ✅
   - Video Remake (`/scale-video/remake`) → unchanged, still uses doubao via apimart ✅

---

## What NOT to touch

- `backend/src/services/videoRemakeService.js` — uses doubao-seedance-2-0 via apimart, correct as-is
- `backend/src/services/geminiGenService.js` — already correct, do not modify
- `backend/src/routes/reels.js` — already uses GeminiGen correctly
- All image generation code (apimart gpt-image-2) — already correct
- `config.models.remake` — keep as `doubao-seedance-2-0`
