You are doing a full audit + deploy prep for the Create AI Reels feature. Work autonomously until everything is verified and fixed. No dead ends.

## YOUR TASKS (in order):

### 1. AUDIT ALL NEW REELS FILES
Read and audit these files for bugs, dead ends, missing error handling:
- backend/src/services/sessionStore.js
- backend/src/services/storyboardBuilder.js  
- backend/src/services/reelsMerger.js
- backend/src/routes/reels.js
- frontend/app/(app)/reels/page.tsx
- frontend/lib/api.ts

For each file check:
- Every async function has try/catch
- No undefined variable references
- No dead-end code paths (functions that can fail silently)
- TypeScript types match between frontend and backend SSE events
- SSE event type strings match exactly (frontend switch cases vs backend sse() calls)

### 2. VERIFY AGAINST GEMINIGEN API DOCS
Fetch and read: https://api.geminigen.ai/docs (or check https://geminigen.ai/docs)
If docs not accessible, verify against these CONFIRMED working endpoints:
- POST https://api.geminigen.ai/uapi/v1/video-gen/grok
  - Auth: x-api-key header
  - Body (FormData): prompt, model="grok-video", aspect_ratio="portrait", resolution="720p", duration="10", mode (optional)
  - Returns: { uuid: string }
- POST https://api.geminigen.ai/uapi/v1/video-extend/grok  
  - Auth: x-api-key header
  - Body (FormData): prompt, ref_history=<uuid>, resolution="720p", duration="10"
  - Returns: { uuid: string }
- GET https://api.geminigen.ai/uapi/v1/history/{uuid}
  - Auth: x-api-key header
  - Returns: { status: 1|2|3, status_percentage: number, generated_video: [{video_url}], thumbnail_url, error_message }
  - Status: 1=processing, 2=completed, 3=failed

Verify backend/src/services/geminiGenService.js matches these exactly.

### 3. PREDICT AND FIX ERRORS
Check for these known failure patterns:
- FFmpeg concat: does it handle single clip correctly (only 1 clip, no extend needed)?
- Redis ioredis: does it handle ECONNREFUSED gracefully without crashing server?
- Session TTL: does getSession() handle Redis key expiry (null response) correctly?
- storyboardBuilder: does refreshFromIndex(fromIndex=0) work correctly (clipsToKeep=[])?
- reelsMerger downloadClips: does axios handle GeminiGen CDN redirects (follow redirects)?
- routes/reels.js generate-stream: if res.writableEnded before merge completes, does it crash?
- frontend handleSSE: n param passed to useCallback — is there a stale closure issue?
- api.ts startReelGeneration: does it handle SSE 'error' event where resumable=true without throwing?

Fix every issue found.

### 4. CHECK PACKAGE.JSON
Verify backend/package.json has: ioredis, fluent-ffmpeg, ffmpeg-static, uuid, form-data, axios
If any missing, add them.

### 5. CHECK RAILWAY DEPLOYMENT READINESS  
- Verify backend/src/index.js has the reels route registered: app.use('/api/reels', reelsRoutes)
- Verify CORS allows the frontend URL
- Check if Railway's nixpacks will pick up ffmpeg-static correctly (it should, npm package)
- Add a startup log in sessionStore.js so we can see Redis connection status in Railway logs

### 6. GIT COMMIT ALL FIXES
After all fixes:
git add -A
git commit -m "fix: reels audit — error handling, SSE type safety, GeminiGen API alignment, Redis resilience"
git push origin main

Report what was found and fixed. Be specific.
