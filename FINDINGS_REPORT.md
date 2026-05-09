# FINDINGS REPORT — Zopia.ai Analysis + Codebase Audit
_Generated: 2026-05-09_

---

## Executive Summary (Top 10 Findings)

1. **All 5 wiring chains are fully ✅ PASS** — voType, reference images, aspectRatio/resolution/clipDuration, scene images, and frontend display are all correctly wired end-to-end.
2. **Zopia's biggest differentiator is a structured multi-tab production canvas** (Script → Characters → Storyboard → Timeline) — we have no timeline or character management system.
3. **Zopia supports 4 dedicated generation workflows** (Keyframes→Video, Elements Sequential, Elements Parallel, Start Frame) vs our single fresh-generate approach.
4. **Zopia has 8+ visual style presets** (Realistic, Anime, 3D CG, Ghibli, Chibi, Makoto Shinkai…) — we hardcode `3D semi-cartoon premium skincare`.
5. **Zopia has 4 project types** (Story Video, Music MV, **Product Promo**, **Digital Human Ad**) — Product Promo keeps product appearance exactly as-is, which maps directly to our use case.
6. **Zopia has a dedicated Characters system** with a separate AI model (Seedream 4.5) — we generate character prompts in text only, no dedicated character reference image model.
7. **Zopia uses a credit system** (✦ credits) — we have no usage/billing metering.
8. **Our storyboard power template (13 sections, 300+ word grokPrompt) is architecturally superior** to Zopia's basic prompt — this is our moat for output quality.
9. **Our independent per-clip generation with scene preview images is a unique advantage** — Zopia chains clips via last-frame extend (worse visual control per clip).
10. **sizeBytes is correctly persisted** after merge and exposed via GET /session — no bug found here.

---

## Zopia.ai Complete Feature Map

### Project Types
| Type | Description |
|---|---|
| Story Video | General narrative video (short drama, music video, movie, animation, children's story) |
| Music MV | Music video generation |
| **Product Promo** | "Create a product commercial keeping the product appearance exactly as-is" |
| **Digital Human Ad** | "Create a digital human product showcase video, the product is:" |

### Production Canvas (ZoClaw)
- **4-tab interface**: Script · Characters · Storyboard · Timeline
- **AI Screenwriter**: chat agent to auto-generate script from description
- **Upload Script**: import existing script text
- **Upload Storyboard**: import existing storyboard
- **Characters panel**: dedicated character management with AI concept art generation

### Technical Configuration
| Setting | Options |
|---|---|
| Canvas Spec | Ratio / Size / Resolution (e.g. 16:9 · 2K · 720p) |
| Storyboard Image Model | Nano Banana 2 (keyframes, shot continuity, storyboard regeneration) |
| Character/Scene Image Model | Seedream 4.5 (character, scene, prop concept images) |
| Video Model | Kling O3 (10s ≈ 112 credits), Kling |
| Generate Audio | Auto |

### Generation Workflows
1. **Keyframes Images to Video**: Multi-grid keyframe images → video reference
2. **Elements to Video Sequential**: Character refs → video, clip-by-clip for continuity
3. **Elements to Video Parallel**: Character refs → all clips at once, no keyframes needed
4. **Start Frame (Outdated)**: Legacy start-frame generation

### Visual Styles (8+)
- Realistic - 3D CG
- Anime - Japanese/Korean
- 3D - Pixar Cartoon
- Realistic - Photorealistic
- 3D - Chinese Style CG
- Anime - Chibi Cute
- Anime - Makoto Shinkai
- Anime - Ghibli
- (+ more via "Show More")

### Platform Features
- **Credit system** (✦ credits) with upgrade tiers
- **Assets Library** — manage all generated assets
- **Projects** — full project management
- **Showcase gallery** — community-generated content (Short Drama, Advertisement, Music Video, Movie, Animation, Science)
- **13 languages** — en, ar, de, es, fr, it, ja, ko, pt, ru, zh, zh-TW, zh-TW
- **Upgrade/Top Up** — billing management in-app

---

## Our Complete Feature Map

### AI Reels Pipeline
| Feature | Status |
|---|---|
| Brief → Storyboard (GPT-4o, 13 sections) | ✅ |
| 5 VO types (narration/dialogue/asmr/demo/story) | ✅ |
| Scene preview images (gpt-image-2, 9:16) | ✅ |
| 6 reference images (@image1–@image6) | ✅ |
| Intelligent @imageN classification (product vs character) | ✅ |
| 5 aspect ratios (portrait/landscape/square/vertical/horizontal) | ✅ |
| 3 clip durations (6s/10s/15s) | ✅ |
| 2 resolutions (480p/720p) | ✅ |
| 4 generation modes (normal/crazy/spicy/custom) | ✅ |
| SSE real-time progress | ✅ |
| Resume on page reload | ✅ |
| 3-tier session store (Redis → /tmp → memory) | ✅ |
| FFmpeg merge + SHA256 verify | ✅ |
| 48h merged video retention + sweep | ✅ |
| Storyboard refresh from any clip index | ✅ |
| Per-clip scene image auto-regeneration on refresh | ✅ |
| Download merged MP4 | ✅ |

### Scale Winning Ad (Images)
| Feature | Status |
|---|---|
| Winning ad analysis (image/video) | ✅ |
| 10+ angle types | ✅ |
| SSE progress bar | ✅ |
| Product photo reference (uploaded) | ✅ |
| Aspect ratio selection | ✅ |
| Carousel generation | ✅ |
| Bulk download | ✅ |

### Platform
| Feature | Status |
|---|---|
| Auth (login/register/JWT) | ✅ |
| Library | ✅ |
| History | ✅ |
| Products DB | ✅ |
| Sidebar navigation | ✅ |

---

## Gap Analysis Table

| Feature | Zopia | Us | Priority |
|---|---|---|---|
| Product Promo (keep product exact) | ✅ | ✅ (via ref images) | — |
| Digital Human Ad type | ✅ | ❌ | 🟡 High |
| Visual style presets (Anime/3D/Realistic) | ✅ 8+ | ❌ hardcoded | 🟡 High |
| Multi-tab production canvas (Script/Chars/Story/Timeline) | ✅ | ❌ | 🔵 Big Bet |
| Timeline editor | ✅ | ❌ | 🔵 Big Bet |
| Dedicated character system + AI concept art | ✅ | ❌ | 🟡 High |
| Multiple generation workflows (sequential/parallel/keyframe) | ✅ | ❌ (fresh-generate only) | 🟡 High |
| Upload existing script | ✅ | ❌ | 🟢 Quick Win |
| Upload existing storyboard | ✅ | ❌ | 🟢 Quick Win |
| Assets Library | ✅ | ❌ | 🟡 High |
| Community showcase gallery | ✅ | ❌ | 🟡 High |
| Credit/usage metering | ✅ | ❌ | 🟡 High |
| 13-section cinema-grade storyboard template | ❌ | ✅ | OUR MOAT |
| Per-clip scene preview images | ❌ | ✅ | OUR MOAT |
| 5 VO audio types | ❌ | ✅ | OUR MOAT |
| 3-tier session persistence (Redis) | ❌ | ✅ | OUR MOAT |
| SSE real-time progress | ❌ | ✅ | OUR MOAT |
| Winning ad analysis + scale | ❌ | ✅ | OUR MOAT |
| Carousel generation | ❌ | ✅ | OUR MOAT |

---

## Wiring Audit Results

### Chain A: voType → storyboard → grokPrompt → video
| Check | Result | Detail |
|---|---|---|
| `/build-storyboard` accepts `voType` | ✅ PASS | routes/reels.js:124 — `voType = 'narration'` default, validated against VALID_VO_TYPES |
| `createSession` stores `voType` | ✅ PASS | sessionStore.js:173 — `voType` field in session object |
| `buildStoryboard` receives `voType` | ✅ PASS | storyboardBuilder.js:363 — destructured from args |
| `getAudioRules(voType)` covers all 5 types | ✅ PASS | storyboardBuilder.js:64–174 — narration/dialogue/asmr/demo/story all handled |
| `compileGrokPrompt` routes by voType | ✅ PASS | storyboardBuilder.js:232–247 — asmr→[AUDIO], dialogue→[AUDIO] Character, others→[VO] |
| `/refresh-clips` passes `session.voType` | ✅ PASS | routes/reels.js:233 — `voType: session.voType \|\| 'narration'` |

**Chain A: ALL ✅ PASS**

---

### Chain B: reference images → storyboard → grokPrompt → video
| Check | Result | Detail |
|---|---|---|
| `saveReferenceImages` returns `{tag, label, url}` | ✅ PASS | routes/reels.js:71–73 — `{ tag, label, url }` returned |
| `classifyRefImage` handles unknown labels as 'product' | ✅ PASS | storyboardBuilder.js:276–281 — default returns 'product' |
| `buildConditionalContext` needsProduct for any non-character ref | ✅ PASS | storyboardBuilder.js:297 — `needsProduct: hasProduct \|\| hasProductRef \|\| (refs.length > 0 && !hasCharacterRef)` |
| `compileGrokPrompt` includes `[REFERENCES]` section | ✅ PASS | storyboardBuilder.js:186–189 — `[REFERENCES]` compiled if refs exist |
| `reelsGenerator` passes `imageUrls` to `generateFirstClip` | ✅ PASS | reelsGenerator.js:69 — `(session.referenceImageUrls \|\| []).forEach(r => imageUrls.push(r.url))` |
| `generateFirstClip` sends `file_urls[]` (not `image_urls[]`) | ✅ PASS | geminiGenService.js:114 — `form.append('file_urls[]', url)` |

**Chain B: ALL ✅ PASS**

---

### Chain C: aspectRatio + resolution + clipDuration → video
| Check | Result | Detail |
|---|---|---|
| `/build-storyboard` accepts all 3 params | ✅ PASS | routes/reels.js:121–123 — all 3 with defaults, validated |
| `sessionStore` saves all 3 | ✅ PASS | sessionStore.js:170–172 — `aspectRatio`, `resolution`, `clipDuration` all stored |
| `reelsGenerator` reads from session, passes to `generateFirstClip` | ✅ PASS | reelsGenerator.js:27 — destructured from session; line 81 — passed to `generateFirstClip` |
| `geminiGenService` sends `duration` as integer | ✅ PASS | geminiGenService.js:110 — `form.append('duration', clipDuration)` — JS number, not string |
| `aspect_ratio` and `resolution` sent correctly | ✅ PASS | geminiGenService.js:108–109 — `aspect_ratio` and `resolution` appended to form |

**Chain C: ALL ✅ PASS**

---

### Chain D: scene images
| Check | Result | Detail |
|---|---|---|
| `sceneImageService` uses new power template fields | ✅ PASS | sceneImageService.js:35–44 — uses `worldBuilding`, `characterDesign`, `productDesign`, `effects`, `colorPalette` |
| `/generate-scene-images` merges back to `session.storyboard` | ✅ PASS | routes/reels.js:290–292 — finds clip by clipNumber, sets `sceneImageUrl` |
| `StoryboardClipCard` shows `sceneImageUrl` | ✅ PASS | StoryboardClipCard.tsx:79–83 — renders `<img>` when `clip.sceneImageUrl` exists |

**Chain D: ALL ✅ PASS**

---

### Chain E: frontend display
| Check | Result | Detail |
|---|---|---|
| `api.ts` TechnicalConfig has `voType`, `voiceType`, `soundDesign`, `ambientSounds` | ✅ PASS | api.ts:157–160 — all 4 fields present |
| `page.tsx` `voType` state exists + passed to `buildStoryboard` | ✅ PASS | reels/page.tsx:108, 183 — state exists and passed |
| `StoryboardClipCard` correct audio section per voType | ✅ PASS | StoryboardClipCard.tsx:55–148 — ASMR→soundDesign, others→voScript + voiceType badge |
| Storyboard summary shows voType label | ✅ PASS | reels/page.tsx:504 — shows voType icon + label |

**Chain E: ALL ✅ PASS**

---

## Critical Bugs Found

**None.** All 5 wiring chains pass. No runtime errors found in reviewed files.

Minor observations (non-breaking):
- `reelsGenerator.js:104` — `clip.uuid` in SSE `clip_done` event will be `undefined` (using local `result.uuid` instead) — the `clip` object from `pollUntilComplete` doesn't have a `uuid` field. Cosmetic only — SSE payload has `undefined` for uuid in `clip_done` but functionality is unaffected.
- `sceneImageService.js` comment says "Gemini Image 2.0" but actually uses `gpt-image-2` via apimart — misleading comment only.

---

## Improvement Roadmap

### 🔴 Priority 1 — Fix Now

#### 1. `clip_done` SSE event has `uuid: undefined`
- **File**: `backend/src/services/reelsGenerator.js` line 104
- **Issue**: `clip: { uuid: clip.uuid, ... }` — `clip` from `pollUntilComplete` has no `uuid` field; it's on `result`
- **Fix**: Change to `clip: { uuid: result.uuid, videoUrl: clip.videoUrl, thumbnailUrl: clip.thumbnailUrl }`
- **Lines**: 1 line change

---

### 🟡 Priority 2 — High Value Adds (1–3 days each)

#### 1. Visual Style Presets
- **What**: Let user pick visual style: `Premium 3D` / `Realistic` / `Anime` / `Cinematic Live Action` / `Cartoon`
- **Why**: Zopia offers 8+; our storyboard hardcodes `3D semi-cartoon premium skincare` — limits use cases
- **Files**: `storyboardBuilder.js` (pass `visualStyle` to system prompt), `reels/page.tsx` (style selector UI)

#### 2. Digital Human Ad type
- **What**: Dedicated project type where a "digital human presenter" is the focus
- **Why**: Zopia's dedicated Digital Human Ad type is a standout product feature
- **Files**: New `voType` or project type selector, storyboard prompt adaptation for human-focused ads

#### 3. Assets Library
- **What**: Gallery of all generated scene images, merged reels, and downloaded files
- **Why**: Zopia has it; users need to re-access their generated content
- **Files**: New `/assets` page, backend `GET /api/reels/library` endpoint using session store

#### 4. Usage/Credit Metering
- **What**: Track generation credits per user, show balance in UI
- **Why**: Needed for monetization; Zopia uses credits prominently
- **Files**: Prisma schema (credits table), auth middleware, UI badge

#### 5. Storyboard Edit Mode
- **What**: Allow users to directly edit `visualSummary`, `voScript`, `grokPrompt` per clip before generating
- **Why**: Power users want direct control over the storyboard text before spending credits
- **Files**: `StoryboardClipCard.tsx` (add edit toggle + inline textarea), `results-reels/page.tsx`

---

### 🟢 Priority 3 — Quick Wins (< 2 hours each)

#### 1. Upload Script
- **What**: Paste/upload existing ad script text → auto-generate storyboard from it
- **Why**: Zopia has it; many users already have copy written
- **Files**: `reels/page.tsx` (add textarea for script paste), storyboard prompt tweak

#### 2. Fix `clip_done` SSE uuid (Priority 1 above — 1 line)

#### 3. Fix misleading comment in `sceneImageService.js`
- Line 11: change "Gemini Image 2.0" to "gpt-image-2 via apimart"

#### 4. Storyboard clip count preview
- **What**: Show "X clips × Ys = Zs total" more prominently before generating
- Already exists at page.tsx:502 — make it a badge/card in the brief form

#### 5. Generation mode descriptions in UI
- **What**: Add tooltip/description for each mode (normal / crazy / spicy / custom)
- Already in `MODE_OPTIONS` array — add `desc` tooltip to the selector buttons

---

### 🔵 Priority 4 — Big Bets (1 week+)

#### 1. Multi-tab Production Canvas (Script → Characters → Storyboard → Timeline)
- Full Zopia-style canvas with dedicated tabs
- Characters: dedicated AI concept art model per character, frozen design across clips
- Timeline: visual drag-arrange of clips before generating
- **Business case**: This is the core Zopia UX — building it would make us feature-competitive

#### 2. Multiple Generation Workflows
- **Sequential**: each clip's last frame used as first frame of next (better visual continuity)
- **Parallel**: all clips generate simultaneously (current approach, faster)
- **Keyframe Grid**: generate multi-panel keyframe image first, then video from it
- **Business case**: Enables long-form narrative video, not just isolated ads

#### 3. Community Showcase Gallery
- Public gallery of generated reels and ads by all users
- "Try This" remix feature (clone a showcase project)
- **Business case**: Viral growth, social proof, template library

#### 4. Multi-language UI
- Currently Indonesian-only copy in prompts; UI is English
- Full i18n for 13 languages (Zopia already supports)

---

## Recommended Next 5 Builds (Ordered by Value)

1. **🔴 Fix `clip_done` SSE uuid** — 1 line, 5 minutes. Fix now.
2. **🟢 Upload Script support** — Users paste their ad copy, GPT-4o generates storyboard from it. 2h. High UX value.
3. **🟡 Visual Style Presets** — 5-button style selector (Premium 3D / Realistic / Anime / Cinematic / Cartoon). 1 day. Unlocks non-skincare verticals.
4. **🟡 Storyboard Edit Mode** — Inline editing of voScript + visualSummary per clip. 1 day. Power user feature.
5. **🟡 Assets Library** — `/results-reels` already lists sessions; make a full gallery page with scene images + download history. 2 days.
