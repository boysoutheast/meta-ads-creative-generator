# SPRINT 3 AUTONOMOUS — IG/TikTok URL → Scale Winning Video

Project root: `/Users/siscaliman/Documents/Claude/Projects/Ads creative generator`

**Jangan install package baru kecuali yang disebutkan di sini.**
**Jangan ubah: geminiGenService.js, videoRemakeService.js, routes/reels.js endpoints yang sudah ada.**
**API rules tetap: non-video = apimart, video = GeminiGen grok-3.**

---

## OVERVIEW

Tambah kemampuan ke "Scale Winning Video" agar user bisa paste URL Instagram/TikTok/YouTube
langsung — tanpa perlu download manual dulu. Pipeline baru:

```
URL → yt-dlp download → temp MP4
           ↓                      ↓
    FFmpeg extract audio    extractVideoFrames()
           ↓                      ↓
   apimart Whisper-1       GPT-4o vision analysis
           ↓                      ↓
       transcript          structuredAnalysis
              ↓ merge ↓
        enrich analysis (scriptStyle, hookWords, keyMessages)
              ↓
       delete temp files
              ↓
    return sama persis seperti /analyze endpoint
```

Generate flow (Step 2 — batchGenerateVideos via GeminiGen) tidak berubah sama sekali.

---

## FEATURE 1 — backend/src/services/videoAnalyzer.js

Tambah fungsi `transcribeAudio` SEBELUM `module.exports`. Sisipkan setelah baris
`async function generateVideoPromptFromReference`:

```js
/**
 * Extract audio from video and transcribe via apimart Whisper-1.
 * Returns transcript string (empty string on failure — non-blocking).
 */
async function transcribeAudio(videoPath) {
  try {
    const { execSync } = require('child_process');
    const audioPath = videoPath.replace(/\.[^.]+$/, '_audio.mp3');
    execSync(
      `ffmpeg -i "${videoPath}" -vn -ar 16000 -ac 1 -b:a 64k "${audioPath}" -y`,
      { timeout: 30000, stdio: 'pipe' }
    );
    if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size < 100) return '';

    const FormData = require('form-data');
    const axios = require('axios');
    const form = new FormData();
    form.append('file', fs.createReadStream(audioPath), { filename: 'audio.mp3', contentType: 'audio/mpeg' });
    form.append('model', 'whisper-1');

    const baseUrl = (config.apimart.baseUrl || '').replace(/\/$/, '');
    const { data } = await axios.post(`${baseUrl}/audio/transcriptions`, form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${config.apimart.apiKey}` },
      timeout: 60000,
    });
    fs.unlink(audioPath, () => {});
    return (data.text || '').trim();
  } catch (e) {
    console.warn('[Whisper] transcription failed (non-fatal):', e.message);
    return '';
  }
}
```

Update `module.exports` di bawah file untuk export `transcribeAudio`:

```js
module.exports = {
  analyzeImageReference,
  analyzeVideoReference,
  transcribeAudio,
  generateVideoPromptFromReference,
};
```

---

## FEATURE 2 — backend/src/services/videoUrlAnalyzer.js (file baru)

Buat file baru `backend/src/services/videoUrlAnalyzer.js`:

```js
/**
 * videoUrlAnalyzer.js
 *
 * Download a social media video URL via yt-dlp then analyze with
 * existing analyzeVideoReference + Whisper-1 transcription.
 *
 * Requires: yt-dlp + ffmpeg installed in the container (backend/Dockerfile).
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { analyzeVideoReference, transcribeAudio } = require('./videoAnalyzer');

/**
 * Download video from URL and analyze it.
 * @param {string} url - Instagram/TikTok/YouTube/Facebook URL
 * @returns {Promise<{ analysis, frames, transcript, platform, title }>}
 */
async function analyzeVideoFromUrl(url) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdl_'));
  const tmpFile = path.join(tmpDir, 'source.mp4');

  try {
    // Download: prefer mp4/720p, max 50MB, no playlist
    execSync(
      `yt-dlp --no-playlist ` +
      `--format "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]" ` +
      `--merge-output-format mp4 --max-filesize 50M ` +
      `--output "${tmpFile}" "${url}"`,
      { timeout: 120000, stdio: 'pipe' }
    );

    if (!fs.existsSync(tmpFile) || fs.statSync(tmpFile).size < 10000) {
      throw new Error('Download gagal atau file terlalu kecil (mungkin video private/removed)');
    }

    // Visual analysis + audio transcription in parallel
    const [transcript, { analysis, frames }] = await Promise.all([
      transcribeAudio(tmpFile),
      analyzeVideoReference(tmpFile),
    ]);

    // Enrich analysis with transcript-derived insights (non-blocking)
    if (transcript && transcript.length > 20) {
      analysis.transcript = transcript.slice(0, 1000);
      try {
        const { chatCompletion } = require('./apimart');
        const config = require('../config');
        const enrichRaw = await chatCompletion({
          model: config.models.chat,
          messages: [
            {
              role: 'system',
              content: 'You are a copywriter analyzing ad video scripts. Return only valid JSON, no markdown.',
            },
            {
              role: 'user',
              content: `Analyze this ad video script and extract copywriting insights.

Transcript: "${transcript.slice(0, 600)}"
Visual style: "${analysis.overallStyle || ''}"
Hook type: "${analysis.hookType || ''}"

Return JSON:
{
  "hookWords": "first 8-10 words of the hook",
  "scriptStructure": "how the script flows (e.g. pain→agitate→solution→cta)",
  "toneOfVoice": "casual/formal/urgency/storytelling/educational",
  "keyMessages": ["main claim 1", "main claim 2"]
}`,
            },
          ],
          maxTokens: 300,
        });
        const enrichMatch = enrichRaw.match(/\{[\s\S]*\}/);
        if (enrichMatch) {
          const enrich = JSON.parse(enrichMatch[0]);
          Object.assign(analysis, enrich);
        }
      } catch (e) {
        console.warn('[videoUrlAnalyzer] enrich non-fatal:', e.message);
      }
    }

    return {
      analysis,
      frames,
      transcript: transcript.slice(0, 300) || '',
      platform: detectPlatform(url),
      title: url.slice(-60),
    };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

function detectPlatform(url) {
  if (url.includes('instagram.com')) return 'Instagram';
  if (url.includes('tiktok.com')) return 'TikTok';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'YouTube';
  if (url.includes('facebook.com') || url.includes('fb.watch')) return 'Facebook';
  return 'Video';
}

module.exports = { analyzeVideoFromUrl, detectPlatform };
```

---

## FEATURE 3 — backend/src/routes/scale-video.js

### 3.1 Tambah import di baris atas (setelah baris `const { startRemakeJob, getJob } = ...`):

```js
const { analyzeVideoFromUrl } = require('../services/videoUrlAnalyzer');
```

### 3.2 Tambah endpoint baru sebelum `module.exports = router`:

```js
/**
 * POST /api/scale-video/analyze-from-url
 * Download & analyze a social media video URL (Instagram, TikTok, YouTube, Facebook).
 * Body: { url: string }
 * Returns: same format as /analyze endpoint + { platform, transcript }
 */
router.post('/analyze-from-url', async (req, res) => {
  const { url } = req.body;
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'url is required and must start with http' });
  }

  try {
    const { analysis, frames, transcript, platform } = await analyzeVideoFromUrl(url);
    const availableAngles = Object.entries(SCALING_ANGLES).map(([key, val]) => ({
      key,
      label: val.label,
      hook: val.hook,
    }));
    res.json({
      analysis,
      framesAnalyzed: frames,
      filename: `${platform}: ${url.slice(-50)}`,
      platform,
      transcript,
      availableAngles,
    });
  } catch (err) {
    const msg = err.message || 'Gagal menganalisis URL';
    // Friendly error for missing yt-dlp
    if (msg.includes('yt-dlp') || msg.includes('not found') || msg.includes('spawn')) {
      return res.status(500).json({ error: 'yt-dlp tidak tersedia. Silakan upload file manual.' });
    }
    res.status(500).json({ error: msg });
  }
});
```

---

## FEATURE 4 — frontend/lib/api.ts

Tambah fungsi baru setelah `analyzeWinningVideo`:

```ts
export async function analyzeWinningVideoFromUrl(
  url: string
): Promise<AnalyzeWinningResponse & { platform?: string; transcript?: string }> {
  const res = await api.post('/scale-video/analyze-from-url', { url })
  return res.data
}
```

---

## FEATURE 5 — frontend/app/(app)/scale-video/page.tsx

### 5.1 Tambah imports (tambah ke import list yang sudah ada):

```ts
import { analyzeWinningVideoFromUrl } from '@/lib/api'
import { Input } from '@/components/ui/input'
```

Di lucide-react import, tambah `Link2` (atau `Link`):
```ts
import { Loader2, AlertCircle, Video, Sparkles, Play, Download, Link2 } from 'lucide-react'
```

### 5.2 Tambah state (setelah `const [error, setError] = useState<string | null>(null)`):

```ts
const [inputMode, setInputMode] = useState<'file' | 'url'>('file')
const [urlInput, setUrlInput] = useState('')
```

### 5.3 Ganti seluruh fungsi `handleAnalyze` dengan versi yang support URL mode:

```ts
const handleAnalyze = async () => {
  if (inputMode === 'file' && !file) return
  if (inputMode === 'url' && !urlInput.trim()) return
  setError(null)
  setAnalyzing(true)
  setVideoAnalysis(null)
  setResult(null)
  setAvailableAngles([])
  setSelectedAngles([])
  try {
    const resp = inputMode === 'url'
      ? await analyzeWinningVideoFromUrl(urlInput.trim())
      : await analyzeWinningVideo(file!)
    setVideoAnalysis(resp.analysis)
    if (resp.availableAngles?.length) {
      setAvailableAngles(resp.availableAngles)
      setSelectedAngles(resp.availableAngles.map((a) => a.key))
    }
  } catch (e: any) {
    setError(e?.response?.data?.error || e.message || 'Gagal menganalisis video')
  } finally {
    setAnalyzing(false)
  }
}
```

### 5.4 Ganti Step 1 Card CardContent seluruhnya:

Cari:
```tsx
<CardContent className="space-y-4">
  <Dropzone file={file} onChange={setFile} accept="video" />
  <Button
    className="w-full"
    onClick={handleAnalyze}
    disabled={!file || analyzing}
  >
    {analyzing ? (
      <><Loader2 className="h-4 w-4 animate-spin" /> Menganalisis video…</>
    ) : (
      <><Sparkles className="h-4 w-4" /> Analyze Video</>
    )}
  </Button>
</CardContent>
```

Ganti dengan:
```tsx
<CardContent className="space-y-4">
  {/* Input mode toggle */}
  <div className="flex rounded-lg border bg-muted/40 p-1 gap-1">
    <button
      type="button"
      onClick={() => setInputMode('file')}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        inputMode === 'file' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      📁 Upload File
    </button>
    <button
      type="button"
      onClick={() => setInputMode('url')}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        inputMode === 'url' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <Link2 className="inline h-3.5 w-3.5 mr-1" />
      Dari URL
    </button>
  </div>

  {inputMode === 'file' ? (
    <Dropzone file={file} onChange={setFile} accept="video" />
  ) : (
    <div className="space-y-2">
      <Input
        type="url"
        placeholder="https://www.instagram.com/reel/..."
        value={urlInput}
        onChange={(e) => setUrlInput(e.target.value)}
        className="text-sm"
      />
      <p className="text-xs text-muted-foreground">
        Support: Instagram Reels, TikTok, YouTube Shorts, Facebook. Video harus publik.
      </p>
    </div>
  )}

  <Button
    className="w-full"
    onClick={handleAnalyze}
    disabled={(inputMode === 'file' ? !file : !urlInput.trim()) || analyzing}
  >
    {analyzing ? (
      <>
        <Loader2 className="h-4 w-4 animate-spin" />
        {inputMode === 'url' ? 'Downloading & analyzing…' : 'Menganalisis video…'}
      </>
    ) : (
      <>
        <Sparkles className="h-4 w-4" />
        {inputMode === 'url' ? 'Analyze dari URL' : 'Analyze Video'}
      </>
    )}
  </Button>
</CardContent>
```

### 5.5 Fix teks lama yang masih sebut "kling-v2-6"

Cari dan ganti semua kemunculan `kling-v2-6` di file ini:
- Di deskripsi halaman: ganti "kling-v2-6 (10 detik)" → "GeminiGen grok-3 (10 detik)"
- Di badge info: ganti "Model: kling-v2-6" → "Model: GeminiGen grok-3"
- Di generating banner: ganti "variasi video dengan kling-v2-6…" → "variasi video dengan GeminiGen grok-3…"

---

## FEATURE 6 — backend/Dockerfile

Ganti baris:
```
RUN apk add --no-cache ffmpeg openssl
```

Dengan:
```
RUN apk add --no-cache ffmpeg openssl python3 py3-pip && \
    pip3 install --no-cache-dir --break-system-packages yt-dlp
```

---

## AUDIT LOOP (WAJIB)

Jalankan loop sampai semua bersih:

```
1. cd frontend && npx tsc --noEmit → 0 error
2. node --check backend/src/services/videoUrlAnalyzer.js
3. node --check backend/src/services/videoAnalyzer.js
4. node --check backend/src/routes/scale-video.js
5. grep -rn "kling\|dall-e-3\|dall-e\|runway" backend/src/ --include="*.js" → 0 hasil
6. Pastikan analyzeWinningVideoFromUrl di api.ts punya matching POST /api/scale-video/analyze-from-url
7. Kalau ada error, fix dan ulangi dari step 1
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
git commit -m "feat: sprint 3 — IG/TikTok/YouTube URL analyze in Scale Winning Video (yt-dlp + Whisper-1)"
git push origin main
railway up --detach
```
