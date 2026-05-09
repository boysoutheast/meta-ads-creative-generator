You are doing a full autonomous deep-dive research + engineering improvement session. No confirmation needed — just execute everything end to end.

---

## STEP 1 — EXPLORE ZOPIA.AI (use WebFetch + WebSearch extensively)

Visit and read every page. Extract ALL feature details.

```
WebFetch: https://zopia.ai/home
WebFetch: https://zopia.ai/pricing
WebFetch: https://zopia.ai/features (if exists)
WebFetch: https://zopia.ai/docs (if exists)
WebSearch: site:zopia.ai
WebSearch: "zopia.ai" AI video ads storyboard features 2024 2025
WebSearch: "zopia ai" review features how it works
WebSearch: zopia.ai vs creatify vs arcads AI video generation
WebSearch: zopia.ai product brief storyboard generation
WebSearch: zopia.ai image generation ads
```

From each page, extract:
- Every feature name and description
- The exact UX workflow (step 1 → step 2 → ...)
- AI models mentioned
- Pricing tiers and what each includes
- Anything unique about their technical approach
- Any screenshots or demo descriptions mentioned in copy

---

## STEP 2 — READ ENTIRE CODEBASE

Read every file listed below completely:

```
backend/src/config.js
backend/src/index.js
backend/src/routes/reels.js
backend/src/routes/scale.js
backend/src/services/apimart.js
backend/src/services/geminiGenService.js
backend/src/services/reelsGenerator.js
backend/src/services/reelsMerger.js
backend/src/services/sceneImageService.js
backend/src/services/scalingService.js
backend/src/services/sessionStore.js
backend/src/services/storyboardBuilder.js
frontend/lib/api.ts
frontend/lib/types.ts
frontend/lib/reels-sessions.ts
frontend/app/(app)/reels/page.tsx
frontend/app/(app)/results-reels/page.tsx
frontend/app/(app)/scale/page.tsx
frontend/app/(app)/history/page.tsx
frontend/components/reels/StoryboardClipCard.tsx
frontend/components/ui/sidebar.tsx (if exists)
```

Also run:
```bash
find backend/src -name "*.js" | sort
find frontend/app -name "*.tsx" | sort
find frontend/components -name "*.tsx" | sort
```

To catch any files not listed above.

For each file note: purpose, inputs, outputs, hardcoded values, missing params, broken chains.

---

## STEP 3 — WIRING AUDIT (check every data chain end to end)

Trace these exact chains and mark each ✅ PASS or ❌ FAIL with reason:

**Chain A: voType brief → storyboard → grokPrompt → video**
- routes/reels.js: does POST /build-storyboard accept voType? ✅/❌
- sessionStore.js: does createSession store voType? ✅/❌
- storyboardBuilder.js: does buildStoryboard receive voType? ✅/❌
- storyboardBuilder.js: does getAudioRules(voType) exist and cover all 5 types? ✅/❌
- storyboardBuilder.js: does compileGrokPrompt handle asmr/dialogue/narration/demo/story differently? ✅/❌
- routes/reels.js: does POST /refresh-clips pass session.voType to refreshFromIndex? ✅/❌

**Chain B: reference images → storyboard → grokPrompt → video generation**
- routes/reels.js: does saveReferenceImages work and return {tag, label, url}? ✅/❌
- storyboardBuilder.js: does classifyRefImage exist and handle unknown labels as 'product'? ✅/❌
- storyboardBuilder.js: does buildConditionalContext set needsProduct=true for any non-character ref? ✅/❌
- storyboardBuilder.js: does compileGrokPrompt include [REFERENCES] section? ✅/❌
- reelsGenerator.js: does it pass imageUrls (referenceImageUrls.map(r=>r.url)) to generateFirstClip? ✅/❌
- geminiGenService.js: does generateFirstClip send file_urls[] (NOT image_urls[])? ✅/❌

**Chain C: aspectRatio + resolution + clipDuration → video**
- routes/reels.js: accepts all 3 params? ✅/❌
- sessionStore.js: saves all 3? ✅/❌
- reelsGenerator.js: reads from session and passes to generateFirstClip? ✅/❌
- geminiGenService.js: sends aspect_ratio, resolution, duration as integers? ✅/❌

**Chain D: scene images**
- sceneImageService.js: uses worldBuilding/characterDesign/productDesign/effects/colorPalette fields? ✅/❌
- routes/reels.js: /generate-scene-images endpoint merges results back to session.storyboard? ✅/❌
- frontend page.tsx: calls generateSceneImages after buildStoryboard returns? ✅/❌
- StoryboardClipCard.tsx: shows sceneImageUrl when available? ✅/❌

**Chain E: frontend display**
- api.ts: TechnicalConfig has voType, voiceType, soundDesign, ambientSounds fields? ✅/❌
- page.tsx: voType state exists and is passed to buildStoryboard? ✅/❌
- StoryboardClipCard.tsx: shows correct audio section for each voType (ASMR = soundDesign, others = voScript)? ✅/❌
- page.tsx storyboard summary: shows voType label in review screen? ✅/❌

---

## STEP 4 — GAP ANALYSIS TABLE

Build this table based on your Zopia research + codebase reading:

| Feature | Zopia | Us | Priority |
|---------|-------|----|----------|
| AI video brief from text | ✅ | ✅ | - |
| ... fill every feature ... | | | |

Then list:
**TOP 10 features Zopia has that we should build** (ranked by user value)
**TOP 5 wiring issues found** (ranked by severity)
**TOP 5 UX improvements** (ranked by impact)

---

## STEP 5 — WRITE FINDINGS_REPORT.md

Save a complete report to `FINDINGS_REPORT.md` in the project root.

Structure:
```
# FINDINGS REPORT — Zopia.ai Analysis + Codebase Audit

## Executive Summary (top 10 findings, 1 sentence each)

## Zopia.ai Complete Feature Map
(every feature with description)

## Our Complete Feature Map
(every feature with description)

## Gap Analysis Table
(full comparison table)

## Wiring Audit Results
(every chain, pass/fail, details)

## Critical Bugs Found
(anything that will cause runtime errors)

## Improvement Roadmap

### 🔴 Priority 1 — Fix Now (wiring bugs, broken chains)
For each: File + Function + Exact fix needed + Estimated lines

### 🟡 Priority 2 — High Value Adds (1-3 days each)
For each: Feature + Why it matters + Files to create/edit + Approach

### 🟢 Priority 3 — Quick Wins (< 2 hours each)
For each: Change + File + What to do

### 🔵 Priority 4 — Big Bets (1 week+)
For each: Feature + Business case + Technical approach

## Recommended Next 5 Builds
(concrete, specific, ordered)
```

---

## STEP 6 — FIX ALL PRIORITY 1 ISSUES IMMEDIATELY

After writing the report, go back and fix every ❌ FAIL found in the wiring audit.

For each fix:
1. Edit the exact file
2. Fix the exact issue
3. Note what was changed

After all fixes, run:
```bash
cd backend && node --check src/services/storyboardBuilder.js && node --check src/routes/reels.js && node --check src/services/reelsGenerator.js && node --check src/services/geminiGenService.js && echo "Backend OK"
cd ../frontend && npx tsc --noEmit && echo "Frontend OK"
```

If errors, fix them.

---

## STEP 7 — GIT COMMIT

```bash
cd "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator"
rm -f .git/index.lock .git/HEAD.lock
git add -A
git commit -m "research: zopia analysis + wiring audit fixes

- Added FINDINGS_REPORT.md with full competitive analysis
- Fixed all Priority 1 wiring issues found in audit
- [list specific fixes made]"
git push origin main
```

---

## FINAL OUTPUT IN CHAT

After everything is done, output:
1. **Top 5 critical findings** (1 sentence each)
2. **Top 5 features to build next** (with why)
3. **Wiring issues fixed** (list of what was broken → now fixed)
4. **Link**: "Report saved to FINDINGS_REPORT.md"

Do not ask for confirmation at any step. Execute everything autonomously.
