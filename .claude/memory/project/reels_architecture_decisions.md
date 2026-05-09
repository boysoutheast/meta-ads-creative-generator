# AI Reels — Architecture Decisions
_Last updated: 2026-05-09_

## Session Persistence (3-tier)
1. **Redis** (primary) — survives restarts, shared across instances; `REDIS_URL` set as `${{Redis.REDIS_URL}}` Railway reference
2. **/tmp JSON files** (backup) — survives single-instance restarts
3. **in-memory Map** (fallback) — last resort, lost on restart

## Clip Generation Strategy
- Each clip is generated **independently** (fresh generate, NOT chained extend)
- Per-clip inputs: `sceneImageUrl` (gpt-image-2 preview) + `grokPrompt` (full structured template) → passed to GeminiGen
- `extendClip` only used for explicit user-triggered retries, NOT for chaining

## Reference Images
- Max **6** reference images (matches GeminiGen `@image1`–`@image6` UI limit)
- Stored as files under `uploads/reels-refs/`
- Tagged as `@image1`…`@image6` in storyboard prompts
- **GPT-4o assigns `@imageN` tags intelligently per clip** — smarter assignment than GeminiGen's own UI

## Key File Responsibilities
| File | Responsibility |
|---|---|
| `services/reelsGenerator.js` | Full clip generation + FFmpeg merge pipeline (extracted from routes/reels.js) |
| `services/storyboardBuilder.js` | GPT-4o storyboard + per-clip @imageN tag assignment |
| `services/sceneImageService.js` | gpt-image-2 scene preview per clip (batch 5, parallel) |
| `services/geminiGenService.js` | GeminiGen Grok API calls (model=grok-3, file_urls[]) |
| `services/sessionStore.js` | 3-tier session persistence (Redis → /tmp → memory) |
| `services/reelsMerger.js` | Download clips → SHA256 verify → FFmpeg concat → verify merged |
| `components/reels/StoryboardClipCard.tsx` | Extracted storyboard clip card UI component |

## File Size Goals (post-refactor)
- `routes/reels.js`: 622 → 442 lines
- `reels/page.tsx`: 688 → 512 lines

## Why Independent Generation (not chaining)
- GeminiGen `/video-storyboard/grok` only supports 10s clips with last-frame chaining
- Independent generation allows: per-clip scene images, per-clip reference image selection, any duration (6/10/15s), any aspect ratio
- Better for ads: each scene is visually self-contained and optimized
