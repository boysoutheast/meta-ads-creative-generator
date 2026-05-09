# GeminiGen Docs Access — Lessons Learned
_Last updated: 2026-05-09_

## Problem
GeminiGen docs at **docs.geminigen.ai** are a **Nuxt SPA** — standard `WebFetch` fails completely (returns empty / JS bundle only).

## Solution: Chrome MCP + javascript_tool
Use `mcp__Claude_in_Chrome__javascript_tool` with `createTreeWalker` to extract visible text:

```js
const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
const texts = []
let node
while ((node = walker.nextNode())) {
  const t = node.textContent?.trim()
  if (
    t && t.length > 3 && t.length < 400 &&
    !/[=;&?%]/.test(t) &&
    !/[A-Za-z0-9]{40,}/.test(t) &&      // exclude base64/hashes
    !/^\s*[\{\}\[\]()]+\s*$/.test(t)    // exclude bare brackets
  ) texts.push(t)
}
JSON.stringify([...new Set(texts)])
```

## Navigation Strategy
- Get correct page URLs first from **nav links on `/getting-started`**, not by guessing paths
- Docs structure changes — always verify URLs from nav before deep-diving

## Confirmed API Params (as of 2026-05-09)
| Param | Value | Notes |
|---|---|---|
| `model` | `grok-3` | NOT `grok-video` |
| Reference images | `file_urls[]` | NOT `image_urls[]` — was completely broken before fix |
| `duration` | integer | NOT string |
| Aspect ratios | portrait, landscape, square, vertical, horizontal | 5 options |
| `resolution` | 480p (default), 720p | |
