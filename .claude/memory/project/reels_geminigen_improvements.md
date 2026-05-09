# AI Reels — GeminiGen/Grok API Improvements
_Last updated: 2026-05-09_

## Summary
Major upgrade to the AI Reels feature (backend + frontend) completing the full GeminiGen Grok API integration.

## Critical Bug Fixes in geminiGenService.js
- **Wrong model name**: `grok-video` → `grok-3` (the correct model identifier)
- **Wrong param name**: `image_urls[]` → `file_urls[]` — reference images were **completely broken** before this fix; this is the confirmed param name per GeminiGen docs
- **Duration type**: was sent as string, must be sent as **integer**

## extendClip Cleanup
- GeminiGen docs confirm `extend` only accepts `prompt` + `ref_history` — no image refs or resolution overrides allowed on extend calls
- Cleaned up extendClip to only send supported params

## New Configurable Params (exposed end-to-end)
| Param | Values | Notes |
|---|---|---|
| `aspectRatio` | portrait / landscape / square / vertical / horizontal | 5 options from GeminiGen |
| `resolution` | 480p / 720p | 480p is GeminiGen default |
| `clipDuration` | 6 / 10 / 15 seconds | per-clip duration |

## Storyboard Adaptations
- `storyboardBuilder` adapts VO density: **2 sentences** for 6s clips, **3 sentences** for 10s/15s clips
- `totalClips` calculation now uses `clipDuration` (was hardcoded `÷10`)
- `[FORMAT]` line in `grokPrompt` now reflects actual aspect ratio + duration

## Architecture Decision: GeminiGen Storyboard API NOT Used
The `/video-storyboard/grok` endpoint was deliberately **not integrated** because:
- Only supports 10s clips with last-frame chaining
- No per-clip image refs supported
- Our independent fresh-generate + scene image approach is architecturally superior for ads

## Commit
`feat(reels): unlock full GeminiGen Grok API capabilities`
