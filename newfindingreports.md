# NEW FINDINGS REPORT — Deep Feature Research
## Zopia.ai + Creatify + Arcads vs Our Product

> Research date: May 2026  
> Sources: Zopia.ai (direct browser exploration), gaga.art review, aibase.com, summarizemeeting.com, Creatify.ai, Arcads.ai

---

## EXECUTIVE SUMMARY

After deep research across Zopia.ai, Creatify, and Arcads, we identified **20 high-value features** our product currently lacks that would dramatically close the quality gap. The most impactful are: (1) Visual Style Presets, (2) Project Type Selector, (3) Product URL Scraper, (4) A/B Hook Generator, (5) Model Selection UI, (6) Character Consistency Pinning, (7) AI Script Expander, (8) Auto Subtitle/Caption Generator, (9) Voice Dubbing (TTS), and (10) Assets Library. Implementing these in order will bring our product to parity with — and in some ways beyond — the current competition.

---

## WHAT ZOPIA.AI HAS (Full Feature Map from Research)

### Core Architecture
- **Multi-Agent System**: Director Agent + Screenwriter Agent + Quality Review Agent working in concert
- **7-Step Pipeline**: Input → Script Generation → Asset Extraction → Storyboard → Video Generation → Auto Self-Review → Timeline Editing
- **Full-Pipeline Workspace**: Script → storyboard → footage → edit in one interface
- **Conversational workflow**: Chat with the AI at any point to adjust shots, style, or plot

### Project Creation
- **3 Project Types**: Story Video ("create an engaging short story film"), Product Promo ("create a product commercial keeping the product appearance exactly as-is"), Digital Human Ad ("create a digital human product showcase video")
- **Script Input Modes**: Free-text brief, screenplay paste, or chat with Screenwriter Agent
- **Language selection**, aspect ratio, video resolution, visual style — all selectable per project
- **AI Script Expander**: Accepts loglines, returns full structured script with scene headings, action lines, dialogue, camera cues

### Visual Styles (10 options)
1. Anime — Japanese/Korean (⭐ Hot)
2. Realistic — 3D CG
3. 3D — Pixar Cartoon
4. Realistic — Photorealistic
5. 3D — Chinese Style CG
6. Anime — Chibi Cute
7. Anime — Makoto Shinkai
8. Anime — Ghibli
9. Stylized — Pixel Art
10. Custom Style (free-text field)

### Model Hub (7 Video Models)
| Model | Vendor | Key Strength | Cost |
|-------|--------|-------------|------|
| Seedance 2.0 Pro | ByteDance | Cinematic realism, unlimited | **Free** |
| Kling O3 | Kuaishou | Fluid action, human scenes | Paid |
| HappyHorse 1.0 | Alibaba | Native synced audio, 7-language lip sync | Paid |
| PixVerse C1 | PixVerse | 20+ camera moves, storyboard-to-video | Paid |
| Vidu Q3 | Vidu | Up to 7 reference images, character coherence | Paid |
| Hailuo 2.3 | MiniMax | Micro-expressions, anime & ink-wash | Paid |
| Wan 2.6 i2v | Alibaba | Multi-shot storyboard, reference video, native audio | Paid |

### Model Hub (4 Image Models)
| Model | Vendor | Key Strength |
|-------|--------|-------------|
| Nano Banana 2 | Google | Up to 10 refs, consistent characters + products |
| Seedream 4.5 | ByteDance | Text rendering, 4K, up to 14 references |
| GPT Image 2 | OpenAI | ~99% text accuracy, 4K, built-in reasoning |
| Midjourney V7 | Midjourney | Best aesthetic quality, Omni Reference |

### Assets Library (Persistent Storage)
- **Tabs**: Personal / Characters / Scenes / Props
- **Usage**: Generate a character/scene/prop → click "Add to Assets" → reuse in any future project
- **Character consistency**: Asset anchoring — same character reference locked across all scenes
- **Custom upload**: If a generated image doesn't match, upload your own reference image

### Storyboarding
- **Scene-by-scene frames** generated with inherited character/environment consistency
- **Each frame inherits** costume, facial features, body proportions, lighting from previous shot
- **Manual override**: Edit any individual shot via chat ("make this shot wider", "change the emotion")
- **Preview before generation**: See storyboard frames before video generation starts

### Self-Review Agent
- After all shots generated, AI runs a **quality review pass** automatically
- **Flags**: costume inconsistencies, prop changes between scenes, pacing issues
- **Auto-regeneration**: Detects and regenerates specific problematic shots on command
- Surfaces inconsistencies proactively — creator sees what to fix before exporting

### Final Editing & Export
- **Timeline Editor**: Auto-populates clips, allows duration adjustment and drag-drop reordering
- **Audio Sync**: Intelligent transitions + audio synchronization in final assembly
- **Voice Dubbing**: Auto-dub VO scripts (TTS)
- **One-click export**
- **Subtitle/Caption burn** as part of final product (implied by voice dubbing features)

### Automation & API
- **OpenClaw integration**: AI agent gateway, full API for automated production pipelines
- **24/7 batch production**: Set theme → agent cluster continuously produces episodes
- **API endpoints**: Project creation, settings, agent chat, asset generation
- **Round-the-clock automated mass production** for content studios

### Pricing & Access
- **Closed beta** with application; approved users get **2,000 daily credits**
- **Seedance 2.0 Pro**: Free + unlimited video generation
- **Beta users**: ~4-5 short-drama sequences per day included

---

## WHAT CREATIFY HAS (Key Differentiators)

- **Product URL → Video**: Paste Shopify/Amazon URL → auto-extract name, images, price, features → build storyboard
- **Batch Variant Generation (2026)**: Upload one product link → get 20 different hook variants for A/B testing
- **A/B Test Dashboard**: Tracks which hook, avatar, CTA performs best with ROAS data
- **1,500+ AI Avatars** with lip-sync in 75+ languages
- **800+ custom avatar options** (upload photo or describe from scratch)
- **140+ Voices**: Control emotion and pacing per segment
- **30+ language voiceover** localization
- **Script structure**: Hook → Product Benefits → CTA (enforced pattern)
- Starting at **$29/month**

---

## WHAT ARCADS HAS (Key Differentiators)

- **300+ AI actors** (digital avatars) with micro-expressions + natural gestures
- **Emotion Control**: Tags like "persuasive", "friendly", "excited" change facial geometry and gestures
- **Hook Testing**: Generate dozens of variations (different actors, different hooks) in minutes
- **Speed**: Script → finished video in ~2 minutes
- **Price**: ~$11 per video
- **UGC-style**: Videos designed to look like real user testimonials

---

## 20 FEATURES TO BUILD — DETAILED IMPLEMENTATION PLANS

---

### 🔴 FEATURE 1: Visual Style Presets
**What**: User picks a visual style before storyboard generation. Style affects the [STYLE] section of every grokPrompt and scene image prompt.

**Why it matters**: Zopia's #1 UX differentiator. Users can't currently get anime, Pixar 3D, or Ghibli aesthetic without manually writing it in the brief. This removes friction and ensures consistency.

**10 Styles to implement**:
- Anime — Japanese/Korean
- Realistic — 3D CG  
- 3D — Pixar Cartoon
- Realistic — Photorealistic
- 3D — Chinese Style CG (Donghua)
- Anime — Chibi Cute
- Anime — Makoto Shinkai (Weathering With You aesthetic)
- Anime — Ghibli
- Stylized — Pixel Art
- Custom (free text input)

**Implementation**:
- **Frontend**: `reels/page.tsx` — Add style picker grid before the brief form (visual cards with preview thumbnails). Store `visualStyle` in state.
- **API**: `buildStoryboard` request body gains `visualStyle: string` field.
- **Backend routes/reels.js**: Accept `visualStyle` in POST /build-storyboard. Store in session.
- **sessionStore.js**: `createSession()` stores `visualStyle`.
- **storyboardBuilder.js**: `buildStoryboard()` receives `visualStyle`. Every clip's `technicalConfig.visualStyle` gets overridden by the selected preset. `compileGrokPrompt()` injects style-specific keywords into [STYLE] section.
- **Style keyword map** (in storyboardBuilder.js):
  ```js
  const VISUAL_STYLE_PROMPTS = {
    'anime-jp': 'cel-shaded anime style, Japanese animation, clean linework, vibrant saturated colors, expressive characters',
    'realistic-3dcg': 'photorealistic 3D CG render, subsurface scattering, ray-traced lighting, ultra detailed textures',
    'pixar-3d': 'Pixar 3D animation style, soft rounded characters, warm lighting, expressive eyes, cinematic depth of field',
    'photorealistic': 'hyperrealistic photography style, DSLR quality, natural lighting, real skin textures',
    'chinese-cg': '3D Chinese animation style (Donghua), ink wash backgrounds, wuxia aesthetic, dramatic lighting',
    'chibi': 'chibi anime style, super deformed proportions, cute pastel colors, big sparkly eyes',
    'makoto-shinkai': 'Makoto Shinkai film aesthetic, hyperdetailed backgrounds, lens flare, golden hour light, watercolor sky',
    'ghibli': 'Studio Ghibli animation style, hand-painted backgrounds, warm soft light, lush nature details',
    'pixel-art': 'retro pixel art style, 16-bit aesthetic, limited color palette, chunky sprites',
    'custom': '' // user provides free text
  };
  ```
- **Estimated effort**: 4-6 hours (frontend picker + backend propagation)

---

### 🔴 FEATURE 2: Project Type Selector
**What**: Explicit mode selection before creating a project: Story Video / Product Promo / Digital Human Ad

**Why it matters**: The prompt architecture is fundamentally different for each. Product Promo needs to lock product appearance exactly as-is. Digital Human needs a presenter. Story Video needs narrative arc.

**3 Project Types**:
- **Story Video**: "Create an engaging short story film" — focus on narrative, character arc, world-building
- **Product Promo**: "Create a product commercial, keeping product appearance exactly as-is" — product always centered, CTA at end, product shots dominate
- **Digital Human Ad**: "Create a digital human product showcase" — talking presenter + product demo

**Implementation**:
- **Frontend**: `reels/page.tsx` — Add prominent 3-card selector at the very start of the flow (before anything else)
- **Backend**: `projectType: 'story' | 'product_promo' | 'digital_human'` stored in session
- **storyboardBuilder.js**: `buildStoryboard()` adjusts prompt architecture by projectType:
  - `product_promo`: Forces `needsProduct=true` for ALL clips, clip 1 = hook, last clip = CTA, middle clips = product benefits
  - `story`: Enables character arc structure, emotional beats, narrative flow  
  - `digital_human`: Adds presenter/avatar slot to storyboard, presenter speaks to camera
- **Estimated effort**: 3-4 hours

---

### 🔴 FEATURE 3: Model Selection UI
**What**: User picks which video generation model to use per project.

**Why it matters**: Different models excel at different content. Free model (Seedance 2.0) for drafts, Kling O3 for human scenes, HappyHorse for audio-synced.

**Models to offer**:
- Kling O3 / grok-3 (current default, "Fluid human scenes")
- Hailuo 2.3 ("Micro-expressions, anime")
- PixVerse C1 ("20+ camera moves")
- Vidu Q3 ("Character coherence, 7 refs")
- Wan 2.6 ("Multi-shot, native audio")

**Implementation**:
- **Frontend**: `reels/page.tsx` — model dropdown or card selector in "Advanced Settings" section
- **Backend config**: `config/index.js` — add model registry with display names + API IDs
- **geminiGenService.js**: Read `model` from job params, send correct model ID to GeminiGen API
- **Session**: Store `videoModel` field
- **Estimated effort**: 2-3 hours

---

### 🔴 FEATURE 4: Product URL Scraper → Auto Brief
**What**: User pastes a product URL (Shopify, Amazon, Tokopedia, etc.) → system auto-scrapes product name, description, images, price, features → pre-fills brief + uploads product image as reference

**Why it matters**: Creatify's #1 most-used feature. Eliminates brief-writing for product marketers. Reduces time from 10 minutes to 30 seconds.

**Implementation**:
- **New backend service**: `backend/src/services/productScraper.js`
  - Uses `node-fetch` + `cheerio` to scrape: product title, description, bullet features, price, first product image
  - Fallback: use OpenAI/Claude to parse HTML if structured data missing
  - Returns: `{ title, description, features[], price, imageUrl, brand }`
- **New backend endpoint**: `POST /api/reels/scrape-product` — accepts `{ url }`, returns scraped data
- **Frontend**: `reels/page.tsx` — Add "Paste product URL" field at top of brief form with "Auto-fill" button
  - On success: pre-fill brief textarea with structured product brief
  - Auto-upload product image as reference image
- **Brief template**:
  ```
  Product: {title} by {brand}
  Price: {price}
  Key Features: {features.join(', ')}
  Description: {description}
  Create a compelling product ad that showcases the product benefits and drives purchase intent.
  ```
- **Estimated effort**: 4-6 hours

---

### 🔴 FEATURE 5: A/B Hook Generator
**What**: After storyboard is built, generate 3-5 different "hook" variations for clip 1 (the opening). User picks the strongest.

**Why it matters**: Creatify's 2026 headline feature. The hook is what determines if users keep watching. Testing 3-5 hooks costs nothing extra in generation but can 3× ad performance.

**5 Hook Types to generate**:
1. **Problem Hook**: Opens with the problem the product solves ("Tired of X?")
2. **Curiosity Hook**: Opens with a surprising claim ("This changed everything about X")
3. **Social Proof Hook**: Opens with results ("After 10,000 users tried X...")
4. **Direct Hook**: Opens with the product itself ("Introducing X")
5. **Emotional Hook**: Opens with emotional moment/story

**Implementation**:
- **New backend endpoint**: `POST /api/reels/generate-hooks` — accepts `{ brief, productName, clipCount }`, returns 5 alternative grokPrompts for clip 1
- **Frontend**: After storyboard loads, show "🎯 Generate Hook Variants" button above clip 1
  - Opens a panel showing 5 hook options (text preview)
  - User selects one → replaces clip 1's grokPrompt
- **storyboardBuilder.js**: New `generateHookVariants(brief, style)` function using separate LLM call
- **Estimated effort**: 4-5 hours

---

### 🟡 FEATURE 6: Character Consistency Pinning
**What**: User can designate one reference image as the "Main Character" and it will be injected into EVERY clip's image references, ensuring the character looks the same in all clips.

**Why it matters**: Zopia's asset anchoring system — their #1 technical differentiator. Without this, characters change appearance between clips, breaking immersion.

**Implementation**:
- **Frontend**: In the reference images upload area, add "Pin as Main Character" toggle per image
- **Session**: Store `pinnedCharacterImageUrl` separately from `referenceImageUrls`
- **reelsGenerator.js**: Always prepend `pinnedCharacterImageUrl` as first `imageUrl` for every clip
- **storyboardBuilder.js**: When `pinnedCharacter` is present, EVERY clip's [REFERENCES] section includes "Main character must match reference image exactly"
- **Estimated effort**: 3-4 hours

---

### 🟡 FEATURE 7: AI Script Expander
**What**: Given a 1-2 sentence brief (logline), AI auto-expands it into a full structured script with scene-by-scene breakdown, dialogue, actions, and camera notes — before storyboard generation.

**Why it matters**: Zopia's "Screenwriter Agent". Bridges the gap between a rough idea and a well-structured multi-clip storyboard. Users who write thin briefs will get much better storyboards.

**Implementation**:
- **New backend endpoint**: `POST /api/reels/expand-script` — accepts `{ brief, projectType, clipCount, voType }`, returns expanded script with scene breakdown
- **Prompt**: "You are a professional screenwriter. Expand this brief into a {clipCount}-scene video script. For each scene: setting, action, dialogue, camera shot, emotion. Brief: {brief}"
- **Frontend**: After user types brief, show "✨ Expand to Full Script" button. Opens expanded script panel — user reviews and edits before generating storyboard.
- The expanded script feeds into `buildStoryboard()` as an enhanced brief
- **Estimated effort**: 3-4 hours

---

### 🟡 FEATURE 8: Auto Subtitle / Caption Generator
**What**: After storyboard is built, auto-generate SRT/VTT subtitle files from the VO scripts. Optionally burn captions onto the final merged video.

**Why it matters**: 85% of social media videos are watched without sound. Captions are no longer optional — they're required for ad performance. Competitors all have this.

**Implementation**:
- **New backend service**: `backend/src/services/subtitleService.js`
  - Reads all VO scripts from storyboard clips
  - Estimates timing based on `clipDuration` per clip
  - Generates SRT format: clip 1 (0:00-0:10), clip 2 (0:10-0:20), etc.
  - Returns SRT content + VTT content
- **New backend endpoint**: `GET /api/reels/:sessionId/subtitles` — returns SRT download
- **FFmpeg integration**: In `reelsMerger.js`, optional `burnSubtitles` flag that uses `ffmpeg -vf subtitles=file.srt` before final export
- **Frontend**: After generation complete, show "📝 Download Subtitles (.srt)" button
- **Estimated effort**: 4-5 hours

---

### 🟡 FEATURE 9: Voice Dubbing (TTS Auto-Dub)
**What**: After video is generated, auto-generate TTS audio from VO scripts and mix it into the final video export.

**Why it matters**: Zopia does this automatically in final editing. Our product currently generates videos with AI-generated audio but no voiced-over narration from the script. This bridges that gap.

**Implementation**:
- **New backend service**: `backend/src/services/ttsService.js`
  - Uses ElevenLabs API (or OpenAI TTS) to convert VO scripts to audio
  - Voice ID selectable per project (narrator, energetic, calm, etc.)
  - Returns audio file URLs per clip
- **reelsMerger.js**: Mix TTS audio over video using FFmpeg `amix` filter
- **Frontend**: Add "🔊 Add AI Voiceover" toggle in advanced settings. If enabled, show voice selector (8-10 voice options with preview).
- **Session**: Store `enableTTS: boolean, ttsVoiceId: string`
- **Estimated effort**: 6-8 hours

---

### 🟡 FEATURE 10: Assets Library (Persistent Characters/Scenes/Props)
**What**: A reusable library where users can save generated images (characters, scenes, products) and use them in future projects to maintain visual consistency.

**Why it matters**: Zopia's Assets Library (Personal / Characters / Scenes / Props) is core to their value prop for repeat creators. A creator building a campaign with consistent characters needs this.

**Implementation**:
- **Database**: New `Asset` model in Prisma schema: `{ id, userId, type: 'character'|'scene'|'product', name, imageUrl, createdAt }`
- **New backend routes**: `GET/POST/DELETE /api/assets`
- **Frontend**: New `/library` page (already exists as `library/page.tsx` — enhance it)
  - Tabs: All / Characters / Scenes / Products
  - "Add to Assets" button on generated scene images in StoryboardClipCard
  - In reference image upload: "From Assets Library" option shows user's saved assets
- **Estimated effort**: 6-8 hours

---

### 🟡 FEATURE 11: Batch Storyboard Generation (Hook A/B Variants)
**What**: From one brief, generate 3 complete storyboard variants with different angles/hooks/moods. User picks the best one before spending on video generation.

**Why it matters**: Creatify's 2026 "Batch Variant Generation". Testing creative direction at storyboard stage (before video spend) is much cheaper than testing after.

**3 Variant Types**:
1. **Emotional/Story angle**: Focus on emotional connection
2. **Benefits/Features angle**: Focus on product features  
3. **Social Proof angle**: Focus on credibility, reviews, results

**Implementation**:
- **Frontend**: `reels/page.tsx` — "Generate 3 Variants" option instead of single storyboard
- **Backend**: `POST /api/reels/build-storyboard-variants` — calls `buildStoryboard` 3× concurrently with different angle prompts
- Each variant stored with an angle label; user picks one to proceed to video generation
- **Estimated effort**: 4-5 hours

---

### 🟡 FEATURE 12: Timeline Editor (Drag-Drop Clip Reordering)
**What**: After video generation, allow users to drag-and-drop clips to reorder them, trim duration, or delete clips before final merge.

**Why it matters**: Zopia has a full timeline editor. Our current flow is linear — clips merge in the order they were generated. Creators need creative control over final sequence.

**Implementation**:
- **Frontend**: `results-reels/page.tsx` — Add a timeline strip showing clip thumbnails. Use `@dnd-kit/sortable` for drag-drop reordering.
- **State**: `orderedClips[]` array that user can reorder
- **Backend**: Modify `reelsMerger.js` to accept `clipOrder: number[]` in merge request. `downloadClips()` downloads in the specified order.
- **New endpoint**: `POST /api/reels/:sessionId/merge-ordered` — accepts `{ clipOrder }` instead of using index order
- **Estimated effort**: 6-8 hours

---

### 🟡 FEATURE 13: Scene Transition Planner
**What**: User can specify the transition type between each pair of clips (Cut, Fade to Black, Cross-Dissolve, Zoom In/Out, Whip Pan).

**Why it matters**: Professional ads use deliberate transitions. Current FFmpeg merge uses simple concatenation. Adding 5 transition types makes final output look significantly more polished.

**Implementation**:
- **Frontend**: Between each clip card in the storyboard, add a small transition selector dropdown
- **Session**: `transitions: [{ afterClip: 0, type: 'dissolve' }, ...]`
- **reelsMerger.js**: Implement FFmpeg filter_complex for each transition type:
  - `cut`: simple concat (current)
  - `fade`: `fade=out:st={end-0.5}:d=0.5,fade=in:st=0:d=0.5`
  - `dissolve`: `xfade=dissolve:offset={clipEnd-0.5}:duration=0.5`
  - `zoom`: `xfade=zoomin:offset={clipEnd-0.3}:duration=0.3`
- **Estimated effort**: 5-6 hours

---

### 🟡 FEATURE 14: Conversational Shot Editing
**What**: After storyboard is generated, user can type natural language instructions to modify specific clips. "Make clip 3 more dramatic", "Change clip 1 to a close-up", "Add rain to clip 4".

**Why it matters**: Zopia's "chat and edit on the go" feature. Currently our users must regenerate the entire storyboard to fix one clip. Chat-based editing is far more efficient.

**Implementation**:
- **Frontend**: Add chat input below each StoryboardClipCard: "✏️ Edit this clip..." text input
- **New backend endpoint**: `POST /api/reels/:sessionId/edit-clip` — accepts `{ clipIndex, instruction }`, returns modified clip with updated grokPrompt + new sceneImage
- **Logic**: Takes existing clip's grokPrompt + technicalConfig + instruction → sends to LLM → returns updated values → regenerates scene image
- **Estimated effort**: 5-6 hours

---

### 🟢 FEATURE 15: Export Options (Resolution + Format)
**What**: Let users choose export resolution (720p / 1080p / 4K) and format (MP4 H.264 / MP4 H.265 / MOV).

**Why it matters**: Currently hardcoded to 720p. Professional advertisers need 1080p for Meta/TikTok ads. 4K for YouTube.

**Implementation**:
- **Frontend**: "Export Settings" section in `results-reels/page.tsx` 
- **reelsMerger.js**: Pass `-vf scale=1920:1080` or `-vf scale=3840:2160` to FFmpeg based on selected resolution
- **Session**: Store `exportResolution: '720p'|'1080p'|'4k'` and `exportFormat: 'mp4'|'mov'`
- **Estimated effort**: 2-3 hours

---

### 🟢 FEATURE 16: Multi-Reference per Clip (Override)
**What**: Allow users to override the reference images for specific individual clips, rather than applying the same global reference images to all clips.

**Why it matters**: Vidu Q3 supports up to 7 references per generation. Currently all clips use the same global references. Clip 5 (a product close-up) might need different refs than clip 1 (a wide establishing shot).

**Implementation**:
- **Frontend**: In StoryboardClipCard, add "Override references for this clip" expandable section
- **Session**: `storyboard[i].clipReferenceUrls: string[]` — per-clip override
- **reelsGenerator.js**: When `storyboard[i].clipReferenceUrls` exists, use those instead of `session.referenceImageUrls`
- **Estimated effort**: 3-4 hours

---

### 🟢 FEATURE 17: Self-Review Agent (Quality Check Pass)
**What**: After all clips are generated, run an AI review that analyzes clip thumbnails and VO scripts to flag potential issues (low quality, inconsistent character, wrong mood).

**Why it matters**: Zopia's "Automated Self-Review Agent" runs after generation and surfaces issues proactively. Catches problems before the user wastes time downloading bad output.

**Implementation**:
- **New backend service**: `backend/src/services/reviewAgent.js`
  - After all clips complete, send clip thumbnails + storyboard metadata to GPT-4V
  - Ask: "Review these clips for: (1) character consistency, (2) mood alignment with brief, (3) technical quality issues"
  - Return: `{ issues: [{ clipIndex, severity, message }], overallScore: 0-100 }`
- **Frontend**: Show review results banner after generation: "✅ 4/5 clips look great. ⚠️ Clip 3 may have character inconsistency"
- **Estimated effort**: 4-5 hours

---

### 🟢 FEATURE 18: Credit / Usage Dashboard
**What**: Show users how many credits they've used, how many remain, and cost breakdown per operation (scene image, video clip, merge).

**Why it matters**: Zopia uses 2,000 daily credits system. Users need visibility into what operations cost to manage their budget and understand the value they're getting.

**Implementation**:
- **Backend**: Track credit usage per operation in session metadata and user profile
- **New endpoint**: `GET /api/credits/usage` — returns monthly usage breakdown
- **Frontend**: Add credit counter to nav bar and detailed usage page at `/profile`
- **Operation costs** (estimated, based on API pricing): scene image = 5 credits, video clip = 50 credits, merge = 10 credits
- **Estimated effort**: 3-4 hours

---

### 🟢 FEATURE 19: Language / Localization Selector
**What**: Select the output language for VO scripts, auto-generated text overlays, and subtitles. Currently hardcoded to English.

**Why it matters**: HappyHorse 1.0 supports 7-language lip sync. Creatify supports 75+ languages. Southeast Asian markets (our user base) need Bahasa Indonesia, Thai, Vietnamese support.

**Priority languages**: English, Bahasa Indonesia, Thai, Vietnamese, Mandarin, Hindi, Spanish

**Implementation**:
- **Frontend**: Language dropdown in project settings
- **Session**: Store `outputLanguage: string` (e.g., "id", "th", "en")
- **storyboardBuilder.js**: Add language instruction to master prompt: "Write all dialogue and VO in {language}"
- **geminiGenService.js**: No change needed — the prompt language drives the output
- **Estimated effort**: 2-3 hours

---

### 🔵 FEATURE 20: Native Audio Sync Model (HappyHorse-style)
**What**: Support video generation models that produce audio-synced output (sound effects, music, dialogue) natively in the video, not just silent video clips.

**Why it matters**: HappyHorse 1.0 (Alibaba) generates video WITH synchronized audio — sound effects, ambient audio, even lip-synced dialogue. This is the next frontier. Silent AI video is becoming outdated.

**Technical Context**: 
- HappyHorse 1.0 params: `audio_prompt` + `reference_audio` → generates video with synced sound
- Wan 2.6 also supports `native_audio: true` parameter
- This eliminates the need for post-production audio mixing

**Implementation**:
- **geminiGenService.js**: Add `audioMode: 'native' | 'silent'` parameter. If `native`, include `audio_prompt` in API request
- **storyboardBuilder.js**: When `audioMode === 'native'`, generate `audioPrompt` field in clip: description of sounds, music, ambiance for that scene
- **reelsMerger.js**: When clips have native audio, use `ffmpeg -c:a copy` instead of silent-assume merge
- **Frontend**: Toggle "🔊 Native Audio" in model settings (only shown when audio-capable model selected)
- **Estimated effort**: 6-8 hours (blocked on GeminiGen API supporting these models)

---

## IMPLEMENTATION PRIORITY MATRIX

| # | Feature | Effort | Impact | Priority | Sprint |
|---|---------|--------|--------|----------|--------|
| 1 | Visual Style Presets | 5h | ⭐⭐⭐⭐⭐ | 🔴 P1 | Sprint 1 |
| 2 | Project Type Selector | 4h | ⭐⭐⭐⭐⭐ | 🔴 P1 | Sprint 1 |
| 3 | Model Selection UI | 3h | ⭐⭐⭐⭐ | 🔴 P1 | Sprint 1 |
| 4 | Product URL Scraper | 6h | ⭐⭐⭐⭐⭐ | 🔴 P1 | Sprint 1 |
| 5 | A/B Hook Generator | 5h | ⭐⭐⭐⭐⭐ | 🔴 P1 | Sprint 1 |
| 6 | Character Consistency Pinning | 4h | ⭐⭐⭐⭐⭐ | 🟡 P2 | Sprint 2 |
| 7 | AI Script Expander | 4h | ⭐⭐⭐⭐ | 🟡 P2 | Sprint 2 |
| 8 | Auto Subtitle Generator | 5h | ⭐⭐⭐⭐ | 🟡 P2 | Sprint 2 |
| 9 | Voice Dubbing (TTS) | 8h | ⭐⭐⭐⭐ | 🟡 P2 | Sprint 2 |
| 10 | Assets Library | 8h | ⭐⭐⭐⭐ | 🟡 P2 | Sprint 2 |
| 11 | Batch Storyboard Variants | 5h | ⭐⭐⭐⭐ | 🟡 P2 | Sprint 3 |
| 12 | Timeline Editor | 7h | ⭐⭐⭐ | 🟡 P2 | Sprint 3 |
| 13 | Scene Transition Planner | 6h | ⭐⭐⭐ | 🟡 P2 | Sprint 3 |
| 14 | Conversational Shot Editing | 6h | ⭐⭐⭐⭐ | 🟡 P2 | Sprint 3 |
| 15 | Export Options | 3h | ⭐⭐⭐ | 🟢 P3 | Sprint 4 |
| 16 | Multi-Reference per Clip | 3h | ⭐⭐⭐ | 🟢 P3 | Sprint 4 |
| 17 | Self-Review Agent | 5h | ⭐⭐⭐⭐ | 🟢 P3 | Sprint 4 |
| 18 | Credit/Usage Dashboard | 4h | ⭐⭐⭐ | 🟢 P3 | Sprint 4 |
| 19 | Language Selector | 2h | ⭐⭐⭐⭐ | 🟢 P3 | Sprint 4 |
| 20 | Native Audio Sync | 8h | ⭐⭐⭐⭐⭐ | 🔵 P4 | Sprint 5 |

---

## RECOMMENDED SPRINT 1 — BUILD NOW

These 5 features deliver maximum impact in minimum time and require no external API dependencies:

### Sprint 1 Deliverables (estimated ~23 hours total):
1. **Visual Style Presets** — Frontend picker + storyboardBuilder propagation
2. **Project Type Selector** — 3-card selector UI + prompt architecture changes
3. **Model Selection UI** — Dropdown in advanced settings + geminiGenService routing
4. **A/B Hook Generator** — New endpoint + storyboard panel UI
5. **Language Selector** — Simple dropdown + prompt injection

### Sprint 2 Deliverables (estimated ~30 hours):
6. **Product URL Scraper** — Cheerio scraper service + auto-fill brief
7. **Character Consistency Pinning** — Pin toggle + reelsGenerator injection
8. **AI Script Expander** — LLM expansion endpoint + review panel
9. **Auto Subtitle Generator** — SRT service + download endpoint
10. **Batch Storyboard Variants** — 3-variant generation flow

---

## COMPETITIVE GAP CLOSURE

After Sprint 1 + Sprint 2:
- **vs Zopia**: Closed ~60% of feature gap (style presets, project types, model selection, script expander, character consistency)
- **vs Creatify**: Closed ~50% of feature gap (product URL, hook generator, language support, batch variants)
- **vs Arcads**: Still behind on avatar/talking head features (different product category)

After Sprint 3 + Sprint 4:
- **vs Zopia**: Closed ~85% (adds timeline editor, transitions, chat editing, self-review, assets library)
- **vs Creatify**: Closed ~75% (adds TTS dubbing, subtitles, export options, credits)
- **Product uniqueness**: Our 13-section cinema-grade grokPrompt + independent clip architecture is more advanced than Zopia's approach

---

## UNIQUE ADVANTAGES WE HAVE (Don't Lose Them)

1. **13-section cinema-grade grokPrompt** — More detailed than any competitor prompt system
2. **Independent clip generation** (not chained extend) — Each clip uses fresh scene image + all refs → better consistency
3. **5 VO Types** (ASMR, dialogue, narration, demo, story) — Unique audio intent system
4. **3-tier session persistence** (Redis + file + memory) — Enterprise-grade session management
5. **Resume-after-failure** — Can resume generation from any failed clip
6. **SSE real-time progress** — Live clip-by-clip updates during generation

---

*Report generated: May 2026*  
*Next action: Implement Sprint 1 features starting with Visual Style Presets + Project Type Selector*
