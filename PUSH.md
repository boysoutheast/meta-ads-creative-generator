# PUSH.md — Commit & Push Pending Changes

> Execute autonomously. No manual steps.

## TASK — Commit and push all pending changes

```bash
cd "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator"
rm -f .git/index.lock .git/HEAD.lock
git add -A
git commit -m "fix: text-in-image via gpt-image-2 prompt injection + restore flux-kontext-pro for product photo accuracy"
git push origin main
```

## What was changed (already done, just needs push)

- `backend/src/services/scalingService.js`
  - Added `appendTextOverlayToPrompt()`: bakes headline + CTA text directly into image prompt — gpt-image-2 renders legible text on images
  - `generateVariationPrompts`: now appends text overlay instructions to every imagePrompt
  - `batchGenerateImages`: restored `productImageUrl` param — photo available → flux-kontext-pro (accurate product), no photo → gpt-image-2

- `backend/src/services/apimart.js`
  - `generateImage`: restored dual-path — `imageUrl` provided → flux-kontext-pro (img2img), no `imageUrl` → gpt-image-2

- `backend/src/routes/scale.js`
  - `generate-variations`: restored `uploadImageToApimart` + passes `productImageUrl` to `batchGenerateImages`
  - `generate-carousel`: restored product photo upload + flux-kontext-pro for carousel

## Verify after push

Railway auto-redeploy. Test generate with product that has a saved photo — expected result:
1. Product visually matches the real product (flux-kontext-pro img2img reference)
2. Headline text rendered ON the image, not just below it
