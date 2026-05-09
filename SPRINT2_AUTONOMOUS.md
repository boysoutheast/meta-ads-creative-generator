# SPRINT 2 AUTONOMOUS

Project root: `/Users/siscaliman/Documents/Claude/Projects/Ads creative generator`

**Jangan install package baru kecuali yang disebutkan di sini.**
**Jangan ubah: geminiGenService.js, videoRemakeService.js, routes/reels.js endpoints yang sudah ada.**
**API rules tetap: non-video = apimart, video = GeminiGen grok-3.**

---

## FEATURE A — Timeline Editor (Drag-Drop Clip Reorder)

### A1. `backend/src/services/reelsMerger.js`

Fungsi `mergeClips` sudah ada di baris ~192. Tambah support `clipOrder` di `options`:

```js
// Di dalam mergeClips(), setelah baris: const transitions = options.transitions || {};
const clipOrder = options.clipOrder && options.clipOrder.length > 0
  ? options.clipOrder
  : Array.from({ length: clipCount }, (_, i) => i);

// Ganti semua baris yang pakai Array.from({ length: clipCount }, ...) untuk inputPaths dengan:
// inputPaths = (options.ttsAudioPaths)
//   ? await dubClipsWithTTS(sessionId, clipCount, options.ttsAudioPaths, clipOrder)
//   : clipOrder.map(i => clipPath(sessionId, i));
```

Update `dubClipsWithTTS` untuk accept optional `clipOrder` parameter dan return paths in that order.

Tambah ke `module.exports`.

### A2. `backend/src/routes/reels.js`

Tambah endpoint baru sebelum `module.exports`:

```js
/**
 * POST /api/reels/:sessionId/merge-custom
 * Re-merge clips in a custom order (Timeline Editor).
 * Body: { clipOrder: number[], exportResolution?: string }
 */
router.post('/:sessionId/merge-custom', async (req, res) => {
  const { sessionId } = req.params;
  const { clipOrder, exportResolution } = req.body;

  const session = await getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!session.downloadReady && !session.clips?.length) {
    return res.status(400).json({ error: 'Clips not generated yet' });
  }

  const clipCount = session.storyboard?.length || (session.clips?.length ?? 0);
  if (!clipCount) return res.status(400).json({ error: 'No clips found' });

  // Validate clipOrder
  const order = Array.isArray(clipOrder) && clipOrder.length === clipCount
    ? clipOrder
    : Array.from({ length: clipCount }, (_, i) => i);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data) => {
    if (!res.writableEnded) { res.write(`data: ${JSON.stringify(data)}\n\n`); if (typeof res.flush === 'function') res.flush(); }
  };

  try {
    send({ type: 'merge_start' });
    const { mergeClips, getMergedPath } = require('../services/reelsMerger');
    const path = require('path');
    const fs = require('fs');
    const crypto = require('crypto');

    await mergeClips(sessionId, clipCount, (pct) => send({ type: 'merge_progress', pct }), {
      clipOrder: order,
      exportResolution: exportResolution || session.exportResolution || '720p',
      transitions: session.transitions || {},
      ttsAudioPaths: session.enableTTS ? undefined : undefined, // TTS already mixed in clips
    });

    const mergedFilePath = getMergedPath(sessionId);
    const stat = fs.statSync(mergedFilePath);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(mergedFilePath)).digest('hex').slice(0, 16);

    // Update session
    session.downloadReady = true;
    session.downloadUrl = `/api/reels/download/${sessionId}`;
    session.clipOrder = order;
    await saveSession(sessionId, session);

    send({ type: 'ready', downloadUrl: session.downloadUrl, sizeBytes: stat.size, mergedHash: hash });
    res.end();
  } catch (e) {
    send({ type: 'error', message: e.message });
    res.end();
  }
});
```

### A3. `frontend/lib/api.ts`

Tambah:
```ts
export async function mergeCustomOrder(
  sessionId: string,
  clipOrder: number[],
  exportResolution?: string
): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(`${API_URL}/reels/${sessionId}/merge-custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clipOrder, exportResolution }),
  })
  if (!response.ok) throw new Error('Merge failed')
  return response.body!
}
```

### A4. `frontend/app/(app)/results-reels/page.tsx`

Di `ReelSession` component (component yang render per-session card), setelah semua clip selesai (`downloadReady === true`), tambah:

**State:**
```ts
const [clipOrder, setClipOrder] = useState<number[]>([])
const [showTimeline, setShowTimeline] = useState(false)
const [remerging, setRemerging] = useState(false)
```

Inisialisasi `clipOrder` dari `clips.map((_, i) => i)` saat clips complete.

**Timeline UI** — tampilkan hanya ketika `downloadReady`:

```tsx
{downloadReady && clipOrder.length > 1 && (
  <div className="mt-4 rounded-lg border bg-muted/30 p-3">
    <button
      className="flex items-center gap-2 text-sm font-medium"
      onClick={() => setShowTimeline(v => !v)}
    >
      <GripVertical className="h-4 w-4" />
      Reorder Clips (Timeline Editor)
      {showTimeline ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
    </button>
    {showTimeline && (
      <div className="mt-3 space-y-2">
        <p className="text-xs text-muted-foreground">Drag thumbnail cards to reorder clips, then re-merge.</p>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {clipOrder.map((originalIdx, position) => {
            const clip = clips.find(c => c.index === originalIdx)
            return (
              <div
                key={originalIdx}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', String(position))}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const fromPos = parseInt(e.dataTransfer.getData('text/plain'))
                  const newOrder = [...clipOrder]
                  const [moved] = newOrder.splice(fromPos, 1)
                  newOrder.splice(position, 0, moved)
                  setClipOrder(newOrder)
                }}
                className="relative shrink-0 w-24 cursor-grab rounded border-2 border-muted bg-background p-1 text-center text-xs hover:border-primary"
              >
                <div className="font-bold text-muted-foreground">#{position + 1}</div>
                <div className="text-[10px]">Clip {originalIdx + 1}</div>
                {clip?.status === 'done' && <div className="mt-1 h-1.5 w-full rounded bg-green-400" />}
              </div>
            )
          })}
        </div>
        <button
          disabled={remerging}
          onClick={async () => {
            setRemerging(true)
            try {
              // Call merge-custom via SSE
              const stream = await mergeCustomOrder(session.sessionId, clipOrder)
              const reader = stream.getReader()
              const decoder = new TextDecoder()
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                const text = decoder.decode(value)
                text.split('\n').filter(l => l.startsWith('data:')).forEach(line => {
                  try {
                    const evt = JSON.parse(line.slice(5))
                    if (evt.type === 'ready') { setDownloadReady(true) }
                  } catch {}
                })
              }
            } catch (e) { console.error(e) }
            finally { setRemerging(false) }
          }}
          className="mt-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {remerging ? '⏳ Re-merging…' : '🔀 Merge in This Order'}
        </button>
      </div>
    )}
  </div>
)}
```

Import `GripVertical, ChevronUp` dari lucide-react + `mergeCustomOrder` dari api.ts.

---

## FEATURE B — Save Reel to Library

Library backend sudah support `type: 'video'`. Kita tambah "Save to Library" button di results-reels setelah video ready, dan pastikan library page render video player.

### B1. `frontend/lib/api.ts`

Tambah (kalau belum ada):
```ts
export async function saveToLibrary(payload: {
  type: 'video' | 'single_image' | 'carousel'
  title: string
  videoUrl?: string | null
  imageUrl?: string | null
  prompt?: string | null
  metadata?: any
}) {
  const res = await api.post('/library', payload)
  return res.data
}
```

### B2. `frontend/app/(app)/results-reels/page.tsx`

Setelah tombol download di per-session card, tambah:
```tsx
{downloadReady && (
  <Button
    variant="outline"
    size="sm"
    onClick={async () => {
      try {
        await saveToLibrary({
          type: 'video',
          title: stored.prompt?.slice(0, 80) || `Reel ${new Date().toLocaleDateString()}`,
          videoUrl: `${API_URL}/api/reels/download/${stored.sessionId}`,
          metadata: { sessionId: stored.sessionId, mode: stored.mode },
        })
        toast?.('Saved to Library ✅') // use window.alert as fallback if toast not imported
      } catch (e) { console.error(e) }
    }}
  >
    💾 Save to Library
  </Button>
)}
```

### B3. `frontend/app/(app)/library/page.tsx`

Pastikan item dengan `type === 'video'` render `<video>` tag bukan `<img>`:

Cari bagian yang render item image/thumbnail. Tambah kondisi:
```tsx
{item.videoUrl ? (
  <video src={item.videoUrl} controls className="h-full w-full object-cover" playsInline />
) : item.imageUrl ? (
  <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" />
) : (
  <div className="flex h-full items-center justify-center"><ImageIcon className="h-8 w-8 text-muted-foreground" /></div>
)}
```

---

## FEATURE C — Dashboard Enhancement

### C1. `frontend/app/(app)/dashboard/page.tsx`

Tambah section "Quick Actions" dengan cards yang link ke semua fitur utama:

```tsx
const QUICK_ACTIONS = [
  { href: '/reels', icon: Film, label: 'Create AI Reels', desc: 'Text → multi-clip video ad', color: 'from-purple-500 to-pink-500' },
  { href: '/scale', icon: Layers, label: 'Scale Winning Image', desc: 'Multiply best ad to 20 angles', color: 'from-orange-500 to-red-500' },
  { href: '/scale-video', icon: Video, label: 'Scale Winning Video', desc: 'Generate video variations', color: 'from-blue-500 to-cyan-500' },
  { href: '/remake', icon: Wand2, label: 'Video Remake', desc: 'Remake any video with AI', color: 'from-green-500 to-teal-500' },
  { href: '/create', icon: Palette, label: 'Create w/ Reference', desc: 'Upload ref → generate ad', color: 'from-yellow-500 to-orange-500' },
  { href: '/generate/single-image', icon: ImageIcon, label: 'Single Image', desc: 'Quick one-shot ad image', color: 'from-slate-500 to-gray-600' },
]
```

Render sebagai grid 2x3 cards dengan gradient icon badge, label, desc, dan arrow link.

Import: `Layers, Video, Wand2, Palette` dari lucide-react (sudah ada di nav-config, bisa import ulang).

Tambah juga section "Recent Activity" — ambil dari `stats` yang sudah ada, tampilkan last 3 library items kalau ada `items` di response. Kalau API stats tidak return items, skip section ini.

---

## FEATURE D — Scale-Video + Scale Page Polish

### D1. `frontend/app/(app)/scale-video/page.tsx`

Cek apakah variations hasil generate sudah bisa di-play langsung (ada `videoUrl`). Kalau belum ada `<video>` tag untuk tiap variation, tambah:

```tsx
{variation.videoUrl ? (
  <video src={variation.videoUrl} controls playsInline className="w-full rounded-lg" />
) : (
  <div className="flex h-32 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
    No video generated
  </div>
)}
```

### D2. `frontend/app/(app)/remake/page.tsx`

Pastikan completed remake video ditampilkan dengan `<video>` player bukan hanya link.

---

## FEATURE E — Global Error Boundary + Loading States

### E1. `frontend/app/(app)/layout.tsx`

Tambah global error toast setup. Kalau belum ada `<Toaster />` dari sonner, tambahkan:

```tsx
import { Toaster } from 'sonner'
// Di dalam return, setelah children:
<Toaster position="bottom-right" richColors />
```

Pastikan `sonner` terinstall — kalau belum: note untuk install `npm install sonner` di frontend.

### E2. Semua page yang punya `error` state

Pastikan error state menampilkan pesan yang jelas dengan retry button. Pattern yang konsisten:
```tsx
{error && (
  <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive flex items-center justify-between">
    <span>{error}</span>
    <button onClick={load} className="text-xs font-medium underline">Retry</button>
  </div>
)}
```

---

## AUDIT LOOP (WAJIB)

Jalankan loop sampai semua bersih:

```
1. cd frontend && npx tsc --noEmit → 0 error
2. node --check pada semua backend file yang dimodifikasi
3. grep -rn "kling\|dall-e-3\|dall-e\|runway" backend/src/ --include="*.js" → 0 hasil
4. Semua api.ts calls punya matching backend route
5. Kalau ada error, fix dan ulangi dari step 1
```

---

## COMMIT + DEPLOY

```python
import os
for f in ['.git/index.lock', '.git/HEAD.lock']:
    try: os.rename(f, f + '.bak')
    except: pass
```
```bash
git add -A
git commit -m "feat: sprint 2 — timeline editor, save to library, dashboard polish, video players, error states"
git push origin main
railway up --detach
```
