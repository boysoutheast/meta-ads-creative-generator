'use client'
import { useEffect, useState, useRef } from 'react'
import { Loader2, AlertCircle, Video, Sparkles, Play, Download, Link2, Wand2, ChevronRight, Package, User, Ban, Plus, X, Image as ImageIcon, Clock, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Dropzone } from '@/components/ads/Dropzone'
// AngleSelector removed — angles auto-selected in scale-video flow
import {
  analyzeWinningVideo,
  analyzeWinningVideoFromUrl,
  translateVideoPrompt,
  generateScaleVideoSceneImages,
  generateScaleVideoJob,
  getProducts,
  getCharacters,
  type Product,
  type Character,
  type ScaleVideoGenerateResponse,
  type AdaptedAnalysis,
} from '@/lib/api'
import type { ScalingAngle, AngleVariation } from '@/lib/types'

const DURATION_OPTIONS = [10, 20, 30, 40, 50, 60, 90, 120]

const fmt = (n?: number) =>
  n !== undefined ? 'Rp ' + n.toLocaleString('id-ID') : ''

const FORMATS = [
  { value: '9:16', label: '9:16', hint: 'Reels / Story' },
  { value: '1:1', label: '1:1', hint: 'Feed' },
  { value: '16:9', label: '16:9', hint: 'Landscape' },
] as const

function phaseColor(phase: string): string {
  if (phase.includes('error') || phase.includes('Error')) return 'text-red-500'
  if (phase === 'cleanup') return 'text-emerald-500'
  if (['downloaded', 'transcribed', 'enriched', 'finalizing', 'gemini_done', 'parse_done'].includes(phase)) return 'text-emerald-600'
  if (['download_retry', 'transcript_empty', 'compress_skip'].includes(phase)) return 'text-amber-500'
  if (phase === 'downloading') return 'text-yellow-500'
  if (['compressing', 'compress_done', 'encoding', 'downloaded'].includes(phase)) return 'text-orange-500'
  if (['gemini_call', 'youtube_native', 'transcribing', 'enriching', 'gemini_empty'].includes(phase)) return 'text-purple-500'
  return 'text-blue-500'
}

export default function ScaleVideoPage() {
  // Step 1 — upload + analyze
  const [file, setFile] = useState<File | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [videoAnalysis, setVideoAnalysis] = useState<any>(null)
  const [availableAngles, setAvailableAngles] = useState<ScalingAngle[]>([])
  const [selectedAngles, setSelectedAngles] = useState<string[]>([])

  // Step 2 — settings
  const [products, setProducts] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [characters, setCharacters] = useState<Character[]>([])
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null)

  // Asset mode — product / character (saved) / none
  const [assetMode, setAssetMode] = useState<'product' | 'character' | 'none'>('product')
  // Character mode — inline builder (fallback if no saved characters used)
  const [characterName, setCharacterName] = useState('')
  const [characterPhotos, setCharacterPhotos] = useState<string[]>([]) // base64 data URLs, max 10
  const [aspectRatio, setAspectRatio] = useState<string>('9:16')

  // Step 3 — generate
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<ScaleVideoGenerateResponse | null>(null)

  const [error, setError] = useState<string | null>(null)

  // Sprint 3 — input mode: file upload OR URL paste
  const [inputMode, setInputMode] = useState<'file' | 'url'>('file')
  const [urlInput, setUrlInput] = useState('')

  // Sprint 3 v2 — analysis mode for URL input
  const [analyzeMode, setAnalyzeMode] = useState<'audio' | 'full'>('full')

  // Sprint 3 v2 — Intent-to-prompt step
  const [userIntent, setUserIntent] = useState('')
  const [translating, setTranslating] = useState(false)
  const [refinedPrompt, setRefinedPrompt] = useState<string>('')
  const [hookVariants, setHookVariants] = useState<string[]>([])
  const [scriptOutline, setScriptOutline] = useState('')
  const [showIntentStep, setShowIntentStep] = useState(false)
  const [adaptedScenes, setAdaptedScenes] = useState<Array<{
    scene: number; duration: string; voiceover: string; imagePrompt: string; imageUrl?: string | null
  }>>([])
  const [generatingSceneImages, setGeneratingSceneImages] = useState(false)
  // Duration-aware comparison
  const [targetDuration, setTargetDuration] = useState<number>(10)
  const [adaptedAnalysis, setAdaptedAnalysis] = useState<AdaptedAnalysis | null>(null)

  // Wizard step: 1=Analyze, 2=Asset, 3=Refine, 4=Generate
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)

  // Live action log — populated by SSE phase events from /analyze-from-url
  const [liveLog, setLiveLog] = useState<Array<{ ts: number; phase: string; message: string; detail?: string }>>([])
  const logScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getProducts()
      .then((list) => {
        setProducts(list)
        if (list.length > 0) setSelectedProduct(list[0])
      })
      .catch(() => {})
    getCharacters()
      .then((list) => {
        setCharacters(list)
        if (list.length > 0) setSelectedCharacter(list[0])
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight
    }
  }, [liveLog])

  // Auto-set duration from analysis (round to nearest 10s, min 10s)
  useEffect(() => {
    if (videoAnalysis) {
      const raw = videoAnalysis.recommendedDuration
        ?? (Array.isArray(videoAnalysis.scenes) ? videoAnalysis.scenes.length * 5 : 30)
      const rounded = Math.max(10, Math.round(raw / 10) * 10)
      setTargetDuration(rounded)
    }
  }, [videoAnalysis])

  const handleAnalyze = async () => {
    if (inputMode === 'file' && !file) return
    if (inputMode === 'url' && !urlInput.trim()) return
    setError(null)
    setAnalyzing(true)
    setVideoAnalysis(null)
    setResult(null)
    setAvailableAngles([])
    setSelectedAngles([])
    setLiveLog([])
    try {
      const resp = inputMode === 'url'
        ? await analyzeWinningVideoFromUrl(urlInput.trim(), analyzeMode, (evt) => {
            if (evt.type === 'phase') {
              setLiveLog((prev) => [...prev, { ts: evt.ts, phase: evt.phase, message: evt.message, detail: evt.detail }])
            }
          })
        : await analyzeWinningVideo(file!)
      setVideoAnalysis(resp.analysis)
      if (resp.availableAngles?.length) {
        setAvailableAngles(resp.availableAngles)
        setSelectedAngles(resp.availableAngles.map((a) => a.key))
      }
      // Reset intent step on every fresh analysis
      setRefinedPrompt('')
      setHookVariants([])
      setScriptOutline('')
      setAdaptedScenes([])
      setAdaptedAnalysis(null)
      setUserIntent('')
      setShowIntentStep(true)
      setStep(2)  // auto-advance to asset setup
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || 'Gagal menganalisis video')
    } finally {
      setAnalyzing(false)
    }
  }

  // Sprint 3 v2 — Translate analysis + intent → tailored video prompt
  const handleTranslatePrompt = async () => {
    if (!userIntent.trim() || !videoAnalysis) return
    setError(null)
    setTranslating(true)
    try {
      // Resolve character data — saved character takes priority over inline builder
      const activeCharacter = assetMode === 'character' && selectedCharacter
        ? selectedCharacter
        : null
      const activeCharPhotos = activeCharacter?.photos ?? characterPhotos
      const activeCharName = activeCharacter?.name ?? characterName

      const result = await translateVideoPrompt({
        videoAnalysis,
        userIntent: userIntent.trim(),
        productName:
          assetMode === 'product'
            ? (selectedProduct?.name ?? 'Unknown Product')
            : assetMode === 'character'
            ? (activeCharName || 'Character')
            : 'Generic',
        productDescription:
          assetMode === 'product'
            ? (selectedProduct?.description ?? '')
            : assetMode === 'character'
            ? `Character: ${activeCharName || 'unnamed'}. ${activeCharPhotos.length} reference photo(s).${activeCharacter?.description ? ' ' + activeCharacter.description : ''}`
            : '',
        assetMode,
        // Pass ALL character photos (up to 10) — backend builds comprehensive character sheet from all
        characterPhotosBase64:
          assetMode === 'character' && activeCharPhotos.length > 0
            ? activeCharPhotos  // data URLs; translatePromptService strips prefix per photo
            : undefined,
        // Product mode: pass first product photo for visual description
        productPhotoBase64:
          assetMode === 'product' && selectedProduct?.photos?.[0]
            ? selectedProduct.photos[0].replace(/^data:[^;]+;base64,/, '')
            : undefined,
        targetDuration,
      })
      setRefinedPrompt(result.videoPrompt || '')
      setHookVariants(result.hookVariants || [])
      setScriptOutline(result.scriptOutline || '')
      setAdaptedAnalysis(result.adaptedAnalysis || null)
      const scenes = result.adaptedScenes || []
      setAdaptedScenes(scenes)

      // Build asset photo references for scene image generation — pass all (up to 10) for max fidelity
      let assetPhotosBase64: string[] | undefined
      if (assetMode === 'product' && selectedProduct?.photos && selectedProduct.photos.length > 0) {
        assetPhotosBase64 = selectedProduct.photos.slice(0, 10)
      } else if (assetMode === 'character') {
        const charPhotos = selectedCharacter?.photos ?? characterPhotos
        if (charPhotos.length > 0) assetPhotosBase64 = charPhotos.slice(0, 10)
      }

      // Auto-generate storyboard images in background
      if (scenes.length > 0) {
        setGeneratingSceneImages(true)
        generateScaleVideoSceneImages(scenes, assetPhotosBase64)
          .then((withImages) => setAdaptedScenes(withImages))
          .catch((e) => console.warn('[scene-images] gen failed:', e.message))
          .finally(() => setGeneratingSceneImages(false))
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || 'Gagal generate prompt')
    } finally {
      setTranslating(false)
    }
  }

  const handleGenerate = async () => {
    if (!videoAnalysis) return
    setError(null)
    setGenerating(true)
    setResult(null)

    try {
      // Build asset payload depending on mode
      let productPhotoBase64: string | undefined
      let productPhotoMime: string | undefined
      let productName = 'Generic'
      let productDescription = ''
      let characterPhotosBase64: string[] | undefined

      if (assetMode === 'product' && selectedProduct) {
        const photoDataUrl = selectedProduct.photos?.[0]
        const photoMatch = photoDataUrl?.match(/^data:([^;]+);base64,(.+)$/)
        productPhotoBase64 = photoMatch?.[2] ?? undefined
        productPhotoMime = photoMatch?.[1] ?? undefined
        productName = selectedProduct.name
        productDescription = selectedProduct.description ?? ''
      } else if (assetMode === 'character') {
        // Saved character takes priority over inline builder
        const activeChar = selectedCharacter
        const activePhotos = activeChar?.photos ?? characterPhotos
        productName = (activeChar?.name ?? characterName) || 'Character'
        productDescription = `Character: ${productName}${activeChar?.description ? '. ' + activeChar.description : ''}`
        if (activePhotos.length > 0) {
          const firstMatch = activePhotos[0].match(/^data:([^;]+);base64,(.+)$/)
          productPhotoBase64 = firstMatch?.[2] ?? undefined
          productPhotoMime = firstMatch?.[1] ?? undefined
          characterPhotosBase64 = activePhotos.map((p) => p.replace(/^data:[^;]+;base64,/, ''))
        }
      }
      // assetMode === 'none': all remain undefined/empty, productName='Generic'

      const resp = await generateScaleVideoJob({
        videoAnalysis,
        productName,
        productDescription,
        selectedAngles: availableAngles.map((a) => a.key), // auto-select all angles
        aspectRatio,
        productPhotoBase64,
        productPhotoMime,
        characterPhotosBase64,
        assetMode,
        customVideoPrompt: refinedPrompt || undefined,
      })
      setResult(resp)
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || 'Gagal generate video')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5 pb-12">

      {/* ── Header ── */}
      <div>
        <div className="mb-1 inline-flex items-center gap-2">
          <Video className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Scale Winning Video</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Analisis video iklan winning → adaptasi untuk produkmu → generate 1 video 10 detik via GeminiGen grok-3.
        </p>
      </div>

      {/* ── Step indicator ── */}
      <div className="flex items-center">
        {([
          { n: 1, label: 'Analyze' },
          { n: 2, label: 'Asset' },
          { n: 3, label: 'Refine' },
          { n: 4, label: 'Generate' },
        ] as const).map(({ n, label }, i) => {
          const done = step > n
          const active = step === n
          const clickable = done || active
          return (
            <>
              <button
                key={n}
                type="button"
                onClick={() => { if (clickable) setStep(n) }}
                className={[
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  active ? 'bg-primary text-primary-foreground shadow-sm'
                    : done ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 cursor-pointer'
                    : 'text-muted-foreground cursor-default',
                ].join(' ')}
              >
                <span className={[
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold',
                  active ? 'bg-primary-foreground/20 text-primary-foreground'
                    : done ? 'bg-emerald-500 text-white'
                    : 'bg-muted-foreground/20 text-muted-foreground',
                ].join(' ')}>
                  {done ? '✓' : n}
                </span>
                {label}
              </button>
              {i < 3 && (
                <div className={['flex-1 h-px mx-1', step > n ? 'bg-emerald-400' : 'bg-border'].join(' ')} />
              )}
            </>
          )
        })}
      </div>

      {/* ── Global error ── */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          STEP 1 — Analyze
      ══════════════════════════════════════════════ */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. Upload & Analyze Video Winning</CardTitle>
            <CardDescription>MP4 / MOV / WEBM · maks 50MB · atau paste URL YouTube / TikTok / Instagram</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Input mode toggle */}
            <div className="flex rounded-lg border bg-muted/40 p-1 gap-1">
              <button type="button" onClick={() => setInputMode('file')}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${inputMode === 'file' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                📁 Upload File
              </button>
              <button type="button" onClick={() => setInputMode('url')}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors flex items-center justify-center gap-1 ${inputMode === 'url' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                <Link2 className="h-3.5 w-3.5" /> Dari URL
              </button>
            </div>

            {inputMode === 'file' ? (
              <Dropzone file={file} onChange={setFile} accept="video" />
            ) : (
              <div className="space-y-3">
                <Input type="url" placeholder="https://www.instagram.com/reel/..." value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)} className="text-sm" />
                <p className="text-xs text-muted-foreground">
                  Support: <b>YouTube Shorts</b>, <b>TikTok</b>, <b>Facebook</b>, <b>Instagram</b>*.{' '}
                  <span className="text-amber-700 dark:text-amber-400">*Instagram wajib login (yt-dlp limitation).</span>
                </p>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Mode analisis:</p>
                  <div className="flex rounded-md border bg-muted/30 p-0.5 gap-0.5">
                    <button type="button" onClick={() => setAnalyzeMode('audio')}
                      className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${analyzeMode === 'audio' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                      🎙 Audio Only
                    </button>
                    <button type="button" onClick={() => setAnalyzeMode('full')}
                      className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${analyzeMode === 'full' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                      🎬 Visual + Audio
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {analyzeMode === 'audio' ? 'Hanya analisis script/narasi (~15 detik)' : 'Analisis visual + audio via Gemini 2.5 Flash (~30-45 detik)'}
                  </p>
                </div>
              </div>
            )}

            <Button className="w-full" onClick={handleAnalyze}
              disabled={(inputMode === 'file' ? !file : !urlInput.trim()) || analyzing}>
              {analyzing
                ? <><Loader2 className="h-4 w-4 animate-spin" />{inputMode === 'url' ? 'Downloading & analyzing…' : 'Menganalisis video…'}</>
                : <><Sparkles className="h-4 w-4" />{inputMode === 'url' ? 'Analyze dari URL' : 'Analyze Video'}</>}
            </Button>

            {/* Live log — URL mode */}
            {(analyzing || liveLog.length > 0) && inputMode === 'url' && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                  {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3 text-emerald-500" />}
                  Live System Log{analyzing ? '' : ' — Selesai ✓'}
                </p>
                <div ref={logScrollRef} className="max-h-40 overflow-y-auto rounded-md bg-muted/40 px-2.5 py-2 space-y-1 font-mono text-[10.5px]">
                  {liveLog.length === 0
                    ? <p className="text-muted-foreground italic">Initialising...</p>
                    : liveLog.map((entry, i) => (
                        <div key={i} className="flex gap-2 leading-snug">
                          <span className="shrink-0 text-muted-foreground/60 tabular-nums">+{((entry.ts - liveLog[0].ts) / 1000).toFixed(1)}s</span>
                          <span className={`shrink-0 font-semibold ${phaseColor(entry.phase)}`}>[{entry.phase}]</span>
                          <span className="text-foreground/80 break-words">{entry.message}</span>
                          {entry.detail && <span className="text-muted-foreground/60 italic ml-1 truncate">— {entry.detail.slice(0, 80)}</span>}
                        </div>
                      ))}
                </div>
              </div>
            )}

            {/* Analyzing skeleton — file mode */}
            {analyzing && inputMode === 'file' && (
              <div className="space-y-2 pt-1">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 1 compact summary */}
      {step > 1 && videoAnalysis && (
        <StepSummary
          n={1} label="Video Dianalisis"
          value={[
            typeof videoAnalysis.overallStyle === 'string'
              ? videoAnalysis.overallStyle.slice(0, 70)
              : 'Video berhasil dianalisis',
            Array.isArray(videoAnalysis.scenes) && videoAnalysis.scenes.length > 0
              ? `${videoAnalysis.scenes.length} scenes`
              : null,
          ].filter(Boolean).join(' · ')}
          onClick={() => setStep(1)}
        />
      )}

      {/* ══════════════════════════════════════════════
          STEP 2 — Asset & Format
      ══════════════════════════════════════════════ */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Asset & Format</CardTitle>
            <CardDescription>Pilih produk / karakter yang mau di-scale, dan format output video.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Asset mode */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Aset yang dipakai</Label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { mode: 'product', icon: Package, label: 'Produk' },
                  { mode: 'character', icon: User, label: 'Karakter' },
                  { mode: 'none', icon: Ban, label: 'None' },
                ] as const).map(({ mode, icon: Icon, label }) => (
                  <button key={mode} type="button" onClick={() => setAssetMode(mode)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border py-3.5 text-sm font-medium transition-colors ${
                      assetMode === mode
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-background text-muted-foreground hover:text-foreground hover:border-muted-foreground'
                    }`}>
                    <Icon className="h-5 w-5" />{label}
                  </button>
                ))}
              </div>
            </div>

            {/* Product picker */}
            {assetMode === 'product' && products.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pilih Produk</Label>
                <Select value={selectedProduct?.id || ''} onValueChange={(id) => { const p = products.find((x) => x.id === id); if (p) setSelectedProduct(p) }}>
                  <SelectTrigger><SelectValue placeholder="Pilih produk…" /></SelectTrigger>
                  <SelectContent>
                    {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.price !== undefined ? ` — ${fmt(p.price)}` : ''}</SelectItem>)}
                  </SelectContent>
                </Select>
                {selectedProduct?.photos && selectedProduct.photos.length > 0 && (
                  <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
                    <div className="flex gap-1">
                      {selectedProduct.photos.slice(0, 4).map((src, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={src} alt="" className="h-10 w-10 rounded-lg object-cover border" />
                      ))}
                      {selectedProduct.photos.length > 4 && (
                        <div className="h-10 w-10 rounded-lg border bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
                          +{selectedProduct.photos.length - 4}
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-emerald-600 flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                      {selectedProduct.photos.length} foto produk · image reference aktif
                    </p>
                  </div>
                )}
              </div>
            )}
            {assetMode === 'product' && products.length === 0 && (
              <p className="text-xs text-muted-foreground rounded-xl border border-dashed p-3 text-center">
                Belum ada produk. <a href="/products" className="underline text-primary">Tambah di Insert Produk →</a>
              </p>
            )}

            {/* Character picker */}
            {assetMode === 'character' && (
              characters.length > 0 ? (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pilih Karakter</Label>
                  <Select value={selectedCharacter?.id || ''} onValueChange={(id) => { const c = characters.find((x) => x.id === id); if (c) setSelectedCharacter(c) }}>
                    <SelectTrigger><SelectValue placeholder="Pilih karakter…" /></SelectTrigger>
                    <SelectContent>
                      {characters.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.photos?.length ? ` — ${c.photos.length} foto` : ''}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {selectedCharacter?.photos && selectedCharacter.photos.length > 0 && (
                    <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
                      <div className="flex gap-1">
                        {selectedCharacter.photos.slice(0, 5).map((src, i) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={i} src={src} alt="" className="h-10 w-10 rounded-lg object-cover border" />
                        ))}
                        {selectedCharacter.photos.length > 5 && (
                          <div className="h-10 w-10 rounded-lg border bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
                            +{selectedCharacter.photos.length - 5}
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-emerald-600 flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                        {selectedCharacter.photos.length} foto reference · character sheet aktif
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-amber-700 dark:text-amber-400 rounded-xl border border-dashed p-3 text-center">
                    Belum ada karakter. <a href="/characters" className="underline">Tambah di Insert Karakter →</a>
                  </p>
                  <CharacterBuilder name={characterName} onNameChange={setCharacterName} photos={characterPhotos} onPhotosChange={setCharacterPhotos} />
                </div>
              )
            )}
            {assetMode === 'none' && (
              <p className="text-xs text-muted-foreground rounded-xl border border-dashed p-3 text-center">
                Generate tanpa foto referensi — prompt saja yang drives the visual.
              </p>
            )}

            {/* Format */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Format Output</Label>
              <div className="flex gap-2">
                {FORMATS.map((f) => (
                  <Button key={f.value} type="button" size="sm"
                    variant={aspectRatio === f.value ? 'default' : 'outline'}
                    onClick={() => setAspectRatio(f.value)}
                    className="flex-1 flex-col h-auto py-3">
                    <span className="text-sm font-bold">{f.value}</span>
                    <span className="text-[10px] opacity-70">{f.hint}</span>
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setStep(1)} className="shrink-0">← Kembali</Button>
              <Button className="flex-1" onClick={() => setStep(3)}>
                Lanjut ke Refine Prompt →
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2 compact summary */}
      {step > 2 && (
        <StepSummary
          n={2} label="Asset & Format"
          value={[
            assetMode === 'product' ? `Produk: ${selectedProduct?.name ?? '—'}`
              : assetMode === 'character' ? `Karakter: ${selectedCharacter?.name ?? (characterName || '—')}`
              : 'No asset',
            aspectRatio,
          ].join(' · ')}
          onClick={() => setStep(2)}
        />
      )}

      {/* ══════════════════════════════════════════════
          STEP 3 — Refine Prompt
      ══════════════════════════════════════════════ */}
      {step === 3 && (
        <div className="space-y-4">
          {/* Analysis reference — expandable */}
          {videoAnalysis && (
            <details className="group">
              <summary className="cursor-pointer list-none flex items-center gap-2 rounded-xl border bg-muted/30 px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors">
                <Sparkles className="h-4 w-4 text-primary shrink-0" />
                <span className="flex-1">Lihat hasil analisis video winning (referensi)</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-open:rotate-90 transition-transform" />
              </summary>
              <div className="mt-2">
                <AnalysisCard analysis={videoAnalysis} />
              </div>
            </details>
          )}

          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-primary" />
                3. Refine Prompt
              </CardTitle>
              <CardDescription>
                Ceritakan tujuan video ini — AI buat prompt spesifik + storyboard 3 scene (10 detik total).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                placeholder="Contoh: jual suplemen kolagen untuk wanita 30-45 tahun, target ibu-ibu Jakarta yang aktif, tone: warm dan aspirational"
                value={userIntent} onChange={(e) => setUserIntent(e.target.value)}
                rows={3} className="text-sm resize-none"
              />
              <Button className="w-full" onClick={handleTranslatePrompt} disabled={!userIntent.trim() || translating}>
                {translating
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating prompt + storyboard…</>
                  : <><Wand2 className="h-4 w-4" /> Refine dengan AI</>}
              </Button>

              {/* Refined output */}
              {refinedPrompt && (
                <div className="space-y-4 pt-2">
                  {/* Editable prompt */}
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-primary">Video Prompt (editable):</p>
                    <Textarea value={refinedPrompt} onChange={(e) => setRefinedPrompt(e.target.value)}
                      rows={5} className="text-xs font-mono resize-none" />
                  </div>

                  {/* Hook variants */}
                  {hookVariants.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground">Hook variants (3 detik pertama):</p>
                      <div className="space-y-1">
                        {hookVariants.map((h, i) => (
                          <div key={i} className="rounded-lg border bg-background px-3 py-2 text-xs">
                            <span className="font-semibold text-primary">{i + 1}.</span> {h}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Adapted Analysis Card — same format as winning video, scenes have image previews */}
                  {(adaptedAnalysis || adaptedScenes.length > 0) && (
                    <AnalysisCard analysis={{
                      ...(adaptedAnalysis || {}),
                      scenes: adaptedScenes.map((s) => ({
                        sceneNumber: s.scene,
                        duration: s.duration,
                        description: s.imagePrompt,
                        voiceover: s.voiceover,
                        imageUrl: s.imageUrl ?? null,
                        generatingImage: generatingSceneImages && !s.imageUrl,
                        hook: s.scene === 1,
                      })),
                    }} />
                  )}

                  {/* Script outline collapsible */}
                  {scriptOutline && (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none">Script outline ↓</summary>
                      <p className="mt-1.5 rounded-lg border bg-muted p-2.5 text-xs leading-relaxed whitespace-pre-wrap">{scriptOutline}</p>
                    </details>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button variant="outline" size="sm" onClick={() => setStep(2)} className="shrink-0">← Kembali</Button>
                    <Button className="flex-1" onClick={() => setStep(4)}>
                      Lanjut ke Generate →
                    </Button>
                  </div>
                </div>
              )}

              {!refinedPrompt && (
                <Button variant="outline" size="sm" className="w-full" onClick={() => setStep(2)}>← Kembali ke Asset</Button>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 3 compact summary */}
      {step > 3 && refinedPrompt && (
        <StepSummary
          n={3} label="Prompt Refined"
          value={refinedPrompt.slice(0, 90) + (refinedPrompt.length > 90 ? '…' : '')}
          onClick={() => setStep(3)}
        />
      )}

      {/* ══════════════════════════════════════════════
          STEP 4 — Generate
      ══════════════════════════════════════════════ */}
      {step === 4 && !result && !generating && (
        <Card className="border-emerald-300 dark:border-emerald-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Video className="h-4 w-4 text-primary" />
              4. Generate Video
            </CardTitle>
            <CardDescription>
              Semua siap. Klik Generate untuk buat 1 video 10 detik.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Config summary */}
            <div className="rounded-xl border divide-y text-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-muted/20">
                <span className="text-xs text-muted-foreground">Asset</span>
                <span className="text-xs font-semibold">
                  {assetMode === 'product' ? (selectedProduct?.name ?? '—')
                    : assetMode === 'character' ? (selectedCharacter?.name ?? (characterName || '—'))
                    : 'None'}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-xs text-muted-foreground">Format · Durasi</span>
                <span className="text-xs font-semibold">{aspectRatio} · 10 detik</span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-xs text-muted-foreground">Model</span>
                <span className="text-xs font-semibold">GeminiGen grok-3</span>
              </div>
              <div className="px-4 py-2.5">
                <p className="text-xs text-muted-foreground mb-1">Prompt</p>
                <p className="text-xs leading-relaxed text-foreground/80 line-clamp-4 font-mono">{refinedPrompt}</p>
              </div>
            </div>

            {/* Storyboard mini preview */}
            {adaptedScenes.length > 0 && (
              <div className="flex gap-1.5 overflow-hidden rounded-lg">
                {adaptedScenes.map((s, i) => (
                  <div key={i} className="flex-1 relative overflow-hidden rounded-lg bg-muted" style={{ aspectRatio: '9/16' }}>
                    {s.imageUrl
                      ? <img src={s.imageUrl} alt="" className="w-full h-full object-cover" /> // eslint-disable-line @next/next/no-img-element
                      : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="h-4 w-4 text-muted-foreground/40" /></div>}
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 px-1.5 pb-1">
                      <p className="text-[9px] text-white font-semibold">{s.duration}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setStep(3)} className="shrink-0">← Edit Prompt</Button>
              <Button className="flex-1" size="lg" onClick={handleGenerate}>
                <Video className="h-4 w-4" /> Generate Video 10 Detik
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Generating progress ── */}
      {generating && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-6 space-y-5">
            <div className="flex items-center gap-4">
              <div className="relative h-12 w-12 shrink-0">
                <div className="absolute inset-0 rounded-full border-4 border-primary/20" />
                <div className="absolute inset-0 rounded-full border-4 border-t-primary animate-spin" />
                <Video className="absolute inset-0 m-auto h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold">Generating video 10 detik…</p>
                <p className="text-sm text-muted-foreground">GeminiGen grok-3 · estimasi 2–5 menit</p>
              </div>
            </div>
            <div className="space-y-2.5">
              {[
                { label: 'Prompt dikirim ke GeminiGen', done: true },
                { label: 'Rendering video frames', done: false, active: true },
                { label: 'Encode & finalize', done: false },
              ].map((s, i) => (
                <div key={i} className="flex items-center gap-2.5 text-sm">
                  {s.done
                    ? <span className="h-5 w-5 rounded-full bg-emerald-500 flex items-center justify-center shrink-0 text-white text-[10px] font-bold">✓</span>
                    : s.active
                    ? <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                    : <span className="h-5 w-5 rounded-full border-2 border-muted-foreground/20 shrink-0" />}
                  <span className={s.active ? 'text-primary font-medium' : s.done ? 'text-emerald-600' : 'text-muted-foreground'}>
                    {s.label}
                  </span>
                </div>
              ))}
            </div>
            <div className="h-1.5 rounded-full bg-primary/20 overflow-hidden">
              <div className="h-full w-1/3 rounded-full bg-primary animate-pulse" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Result ── */}
      {result && !generating && (
        <Card className="overflow-hidden border-emerald-200 dark:border-emerald-800">
          <CardHeader className="pb-2 bg-emerald-50/50 dark:bg-emerald-900/10 border-b border-emerald-100 dark:border-emerald-800/50">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 inline-block" />
              Video Siap!
              <span className="ml-auto text-xs font-normal text-muted-foreground">{result.productName} · {result.aspectRatio} · 10s</span>
            </CardTitle>
          </CardHeader>

          <div className="relative bg-black flex items-center justify-center min-h-[320px]">
            {result.variations[0]?.videoUrl ? (
              <video src={result.variations[0].videoUrl} controls autoPlay loop
                className="max-h-[520px] w-full object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-3 py-16 text-destructive/70">
                <AlertCircle className="h-8 w-8" />
                <p className="text-sm">{result.variations[0]?.videoError || 'Video tidak tersedia'}</p>
              </div>
            )}
          </div>

          <CardContent className="p-4 space-y-3">
            <div className="flex gap-2">
              {result.variations[0]?.videoUrl && (
                <Button className="flex-1" onClick={async () => {
                  try {
                    const r = await fetch(result.variations[0].videoUrl!)
                    const blob = await r.blob()
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `scale-video-${result.productName}-${Date.now()}.mp4`
                    document.body.appendChild(a); a.click(); document.body.removeChild(a)
                    URL.revokeObjectURL(url)
                  } catch { window.open(result.variations[0].videoUrl!, '_blank') }
                }}>
                  <Download className="h-4 w-4" /> Download Video
                </Button>
              )}
              <Button variant="outline" onClick={() => { setResult(null); setStep(3); setRefinedPrompt(''); setAdaptedScenes([]); setHookVariants([]); setScriptOutline(''); setUserIntent('') }}>
                Refine Ulang
              </Button>
              <Button variant="outline" onClick={() => { setResult(null); setStep(4) }}>
                Generate Ulang
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ── StepSummary — clickable compact summary for completed steps ────────────────
function StepSummary({ n, label, value, onClick }: { n: number; label: string; value: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="w-full flex items-center gap-3 rounded-xl border bg-muted/20 px-4 py-3 text-left hover:bg-muted/40 transition-colors group">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 text-[10px] font-bold">✓</span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Step {n} — {label}</p>
        <p className="text-sm font-medium truncate text-foreground/80">{value}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0 group-hover:translate-x-0.5 transition-transform" />
    </button>
  )
}


// ── ComparisonView — kiri-kanan: original AI analysis vs adapted version ─────

interface ComparisonViewProps {
  original: any
  adapted: AdaptedAnalysis
  productName: string
  targetDuration: number
  hookVariants: string[]
  scriptOutline: string
}

function ComparisonRow({ label, left, right }: { label: string; left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-0 border-b border-border/40 last:border-0">
      <div className="px-3 py-2.5 border-r border-border/40">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
        <div className="text-xs leading-relaxed text-foreground/80">{left}</div>
      </div>
      <div className="px-3 py-2.5 bg-primary/[0.03]">
        <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-wide mb-1">{label}</p>
        <div className="text-xs leading-relaxed text-foreground">{right}</div>
      </div>
    </div>
  )
}

function ComparisonView({ original, adapted, productName, targetDuration, hookVariants, scriptOutline }: ComparisonViewProps) {
  const a = original || {}

  // ── Helpers ──────────────────────────────────────────────────────────────
  const hookTypeStr = asString(a.hookType)
  const emotionArcStr = typeof a.emotionArc === 'object'
    ? (Array.isArray(a.emotionArc?.phases) ? a.emotionArc.phases.join(' → ') : flattenObjectToText(a.emotionArc))
    : asString(a.emotionArc)
  const overallStyle = asString(a.overallStyle)
  const scriptStructureOrig = typeof a.scriptStructure === 'object' && a.scriptStructure
    ? { framework: asString(a.scriptStructure.framework), hookLine: asString(a.scriptStructure.hookLine), ctaLine: asString(a.scriptStructure.ctaLine) }
    : { framework: asString(a.scriptStructure), hookLine: '', ctaLine: '' }
  const keyMessagesOrig: any[] = Array.isArray(a.keyMessages) ? a.keyMessages : []
  const ctaOrig = typeof a.ctaStrategy === 'object' && a.ctaStrategy
    ? `${asString(a.ctaStrategy.type)} — "${asString(a.ctaStrategy.wording)}" @ ${asString(a.ctaStrategy.placement)}`
    : asString(a.ctaStrategy)
  const audioOrig = typeof a.audioDesign === 'object' ? flattenObjectToText(a.audioDesign) : asString(a.musicVibe)

  // Hook breakdown
  const hookOrig = typeof a.hookBreakdown === 'object' && a.hookBreakdown
    ? `"${asString(a.hookBreakdown.hookWords)}" — ${asString(a.hookBreakdown.hookMechanism)}`
    : hookTypeStr || ''
  const hookAdapted = adapted.hookBreakdown
    ? `"${adapted.hookBreakdown.hookWords ?? ''}" — ${adapted.hookBreakdown.hookMechanism ?? ''}`
    : adapted.hookType || ''

  // Script structure adapted
  const scriptAdapted = adapted.scriptStructure
    ? `${adapted.scriptStructure.framework ?? ''} — hook: "${adapted.scriptStructure.hookLine ?? ''}" · CTA: "${adapted.scriptStructure.ctaLine ?? ''}"`
    : ''

  const ctaAdapted = adapted.ctaStrategy
    ? `${adapted.ctaStrategy.type ?? ''} — "${adapted.ctaStrategy.wording ?? ''}" @ ${adapted.ctaStrategy.placement ?? ''}`
    : ''

  // Scenes count estimation
  const origSceneCount = Array.isArray(a.scenes) ? a.scenes.length : '?'
  const origDuration = a.recommendedDuration ?? (Array.isArray(a.scenes) ? a.scenes.length * 5 : '?')

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-2 gap-0 border-b border-border bg-muted/40">
        <div className="px-3 py-2 border-r border-border">
          <p className="text-[11px] font-bold text-muted-foreground flex items-center gap-1.5">
            🎬 ORIGINAL
            <Badge variant="outline" className="text-[9px]">{origSceneCount} scenes · {origDuration}s</Badge>
          </p>
        </div>
        <div className="px-3 py-2 bg-primary/5">
          <p className="text-[11px] font-bold text-primary flex items-center gap-1.5">
            ✨ ADAPTASI: {productName}
            <Badge className="text-[9px] bg-primary/20 text-primary border-0">{targetDuration}s</Badge>
          </p>
        </div>
      </div>

      {/* Hook */}
      <ComparisonRow
        label="Hook Strategy"
        left={hookOrig || <span className="text-muted-foreground/50 italic">—</span>}
        right={hookAdapted || hookVariants[0] || <span className="text-muted-foreground/50 italic">—</span>}
      />

      {/* Hook variants (only right side) */}
      {hookVariants.length > 0 && (
        <div className="grid grid-cols-2 gap-0 border-b border-border/40">
          <div className="px-3 py-2.5 border-r border-border/40">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Hook Variants</p>
            {typeof a.hookBreakdown === 'object' && a.hookBreakdown ? (
              <div className="text-xs text-foreground/80 space-y-0.5">
                {a.hookBreakdown.first3Seconds && <div>3s: {asString(a.hookBreakdown.first3Seconds)}</div>}
                {a.hookBreakdown.viewerReaction && <div className="text-muted-foreground/70">Reaksi: {asString(a.hookBreakdown.viewerReaction)}</div>}
              </div>
            ) : <span className="text-muted-foreground/40 text-xs italic">—</span>}
          </div>
          <div className="px-3 py-2.5 bg-primary/[0.03]">
            <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-wide mb-1">Hook Variants (3 opsi)</p>
            <div className="space-y-1">
              {hookVariants.map((h, i) => (
                <div key={i} className="text-xs leading-relaxed">
                  <span className="font-medium text-primary">{i + 1}.</span> {h}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Overall Style */}
      {(overallStyle || adapted.overallStyle) && (
        <ComparisonRow
          label="Visual Style"
          left={overallStyle || <span className="text-muted-foreground/50 italic">—</span>}
          right={adapted.overallStyle || <span className="text-muted-foreground/50 italic">—</span>}
        />
      )}

      {/* Emotion Arc */}
      {(emotionArcStr || adapted.emotionArc) && (
        <ComparisonRow
          label="Emotion Arc"
          left={emotionArcStr || <span className="text-muted-foreground/50 italic">—</span>}
          right={adapted.emotionArc || <span className="text-muted-foreground/50 italic">—</span>}
        />
      )}

      {/* Script Structure */}
      {(scriptStructureOrig.framework || adapted.scriptStructure?.framework) && (
        <div className="grid grid-cols-2 gap-0 border-b border-border/40">
          <div className="px-3 py-2.5 border-r border-border/40">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Script Structure</p>
            <div className="text-xs space-y-0.5 text-foreground/80">
              {scriptStructureOrig.framework && <div className="font-medium">{scriptStructureOrig.framework}</div>}
              {scriptStructureOrig.hookLine && <div>Hook: "{scriptStructureOrig.hookLine}"</div>}
              {scriptStructureOrig.ctaLine && <div>CTA: "{scriptStructureOrig.ctaLine}"</div>}
            </div>
          </div>
          <div className="px-3 py-2.5 bg-primary/[0.03]">
            <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-wide mb-1">Script Structure</p>
            <div className="text-xs space-y-0.5">
              {adapted.scriptStructure?.framework && <div className="font-medium">{adapted.scriptStructure.framework}</div>}
              {adapted.scriptStructure?.hookLine && <div>Hook: "{adapted.scriptStructure.hookLine}"</div>}
              {Array.isArray(adapted.scriptStructure?.agitationPoints) && adapted.scriptStructure.agitationPoints.length > 0 && (
                <div className="text-muted-foreground">Agitasi: {adapted.scriptStructure.agitationPoints.slice(0, 2).join(' · ')}</div>
              )}
              {adapted.scriptStructure?.solutionReveal && <div>Solusi: {adapted.scriptStructure.solutionReveal}</div>}
              {adapted.scriptStructure?.ctaLine && <div>CTA: "{adapted.scriptStructure.ctaLine}"</div>}
            </div>
          </div>
        </div>
      )}

      {/* Key Messages */}
      {(keyMessagesOrig.length > 0 || (adapted.keyMessages && adapted.keyMessages.length > 0)) && (
        <div className="grid grid-cols-2 gap-0 border-b border-border/40">
          <div className="px-3 py-2.5 border-r border-border/40">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Key Messages</p>
            <ul className="text-xs space-y-0.5 text-foreground/80">
              {keyMessagesOrig.slice(0, 4).map((m: any, i: number) => (
                <li key={i}>· {typeof m === 'object' ? asString(m.message) : asString(m)}</li>
              ))}
            </ul>
          </div>
          <div className="px-3 py-2.5 bg-primary/[0.03]">
            <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-wide mb-1">Key Messages</p>
            <ul className="text-xs space-y-0.5">
              {(adapted.keyMessages ?? []).slice(0, 4).map((m, i) => (
                <li key={i}>· {m}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* CTA Strategy */}
      {(ctaOrig || ctaAdapted) && (
        <ComparisonRow
          label="CTA Strategy"
          left={ctaOrig || <span className="text-muted-foreground/50 italic">—</span>}
          right={ctaAdapted || <span className="text-muted-foreground/50 italic">—</span>}
        />
      )}

      {/* Audio Direction */}
      {(audioOrig || adapted.audioDirection) && (
        <ComparisonRow
          label="Audio & Music"
          left={audioOrig || <span className="text-muted-foreground/50 italic">—</span>}
          right={adapted.audioDirection || <span className="text-muted-foreground/50 italic">—</span>}
        />
      )}

      {/* Script outline (right only) */}
      {scriptOutline && (
        <div className="grid grid-cols-2 gap-0">
          <div className="px-3 py-2.5 border-r border-border/40">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Script Outline</p>
            <span className="text-xs text-muted-foreground/50 italic">Lihat kolom kanan →</span>
          </div>
          <div className="px-3 py-2.5 bg-primary/[0.03]">
            <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-wide mb-1">Script Outline ({targetDuration}s)</p>
            <p className="text-xs leading-relaxed whitespace-pre-wrap text-foreground/80">{scriptOutline}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Video variation card ──────────────────────────────────────────────────────

function VideoVariationCard({ variation, index }: { variation: AngleVariation; index: number }) {
  const [copying, setCopying] = useState(false)
  const hasVideo = !!variation.videoUrl

  const copyText = () => {
    const txt = [variation.headline, variation.subheadline, variation.bodyText, variation.cta && `CTA: ${variation.cta}`]
      .filter(Boolean)
      .join('\n\n')
    navigator.clipboard.writeText(txt)
    setCopying(true)
    setTimeout(() => setCopying(false), 1500)
  }

  const handleDownload = async () => {
    if (!variation.videoUrl) return
    try {
      const res = await fetch(variation.videoUrl)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `video-${variation.angle || index}-${Date.now()}.mp4`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      window.open(variation.videoUrl, '_blank')
    }
  }

  return (
    <Card className="overflow-hidden">
      {/* Video / placeholder */}
      <div className="relative bg-muted">
        {hasVideo ? (
          <video
            src={variation.videoUrl!}
            controls
            loop
            className="w-full"
            style={{ maxHeight: '280px', display: 'block' }}
          />
        ) : (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 text-muted-foreground p-4 text-center">
            {variation.videoError ? (
              <>
                <AlertCircle className="h-6 w-6 text-destructive/60" />
                <p className="text-xs text-destructive/80">{variation.videoError}</p>
              </>
            ) : (
              <>
                <Video className="h-8 w-8 opacity-30" />
                <p className="text-xs">Video not available</p>
              </>
            )}
          </div>
        )}
        {variation.angle && (
          <div className="absolute left-2 top-2">
            <Badge className="text-xs">{variation.angle.replace(/_/g, ' ')}</Badge>
          </div>
        )}
      </div>

      {/* Copy */}
      <CardContent className="space-y-2 p-4">
        {variation.headline && <p className="font-semibold leading-snug">{variation.headline}</p>}
        {variation.subheadline && <p className="text-sm text-muted-foreground">{variation.subheadline}</p>}
        {variation.bodyText && <p className="text-sm">{variation.bodyText}</p>}
        {variation.cta && (
          <div className="pt-1">
            <Badge variant="outline">CTA: {variation.cta}</Badge>
          </div>
        )}

        {variation.translatedConcept && (
          <details className="pt-1">
            <summary className="cursor-pointer text-xs text-emerald-700 hover:text-emerald-900">
              ✦ Concept translation
            </summary>
            <p className="mt-1 rounded border border-emerald-100 bg-emerald-50 p-2 text-xs leading-relaxed text-emerald-800">
              {variation.translatedConcept}
            </p>
          </details>
        )}

        {variation.imagePrompt && (
          <details className="pt-1">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Lihat video prompt
            </summary>
            <p className="mt-1 max-h-32 overflow-auto rounded bg-muted p-2 text-xs leading-relaxed">
              {variation.imagePrompt}
            </p>
          </details>
        )}

        <div className="flex gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={copyText} className="flex-1">
            {copying ? '✓ Tersalin' : 'Copy text'}
          </Button>
          {hasVideo && (
            <Button size="sm" onClick={handleDownload} className="flex-1">
              <Download className="h-4 w-4" />
              Download
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── CharacterBuilder — name + photo grid (max 10) ─────────────────────────

interface CharacterBuilderProps {
  name: string
  onNameChange: (n: string) => void
  photos: string[]           // base64 data URLs
  onPhotosChange: (p: string[]) => void
}

function CharacterBuilder({ name, onNameChange, photos, onPhotosChange }: CharacterBuilderProps) {
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    const remaining = 10 - photos.length
    const toAdd = Array.from(files).slice(0, remaining)
    let collected: string[] = []
    let pending = toAdd.length
    if (pending === 0) return
    toAdd.forEach((file) => {
      if (!file.type.startsWith('image/')) {
        pending--
        if (pending === 0 && collected.length) onPhotosChange([...photos, ...collected])
        return
      }
      const reader = new FileReader()
      reader.onload = (e) => {
        const result = e.target?.result as string
        if (result) collected.push(result)
        pending--
        if (pending === 0) onPhotosChange([...photos, ...collected])
      }
      reader.onerror = () => {
        pending--
        if (pending === 0 && collected.length) onPhotosChange([...photos, ...collected])
      }
      reader.readAsDataURL(file)
    })
  }

  const removePhoto = (i: number) => {
    onPhotosChange(photos.filter((_, idx) => idx !== i))
  }

  return (
    <div className="space-y-3">
      <Input
        placeholder="Nama karakter (contoh: Mbak Rini)"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        className="text-sm"
      />

      {/* Photo grid */}
      <div className="grid grid-cols-5 gap-1.5">
        {photos.map((src, i) => (
          <div key={i} className="relative group aspect-square rounded-md overflow-hidden border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`char-${i}`} className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => removePhoto(i)}
              className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label={`Hapus foto ${i + 1}`}
            >
              <X className="h-2.5 w-2.5 text-white" />
            </button>
            {i === 0 && (
              <div className="absolute bottom-0 left-0 right-0 bg-emerald-600/85 text-white text-[8px] py-0.5 text-center font-semibold">
                REF UTAMA
              </div>
            )}
          </div>
        ))}
        {photos.length < 10 && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="aspect-square rounded-md border border-dashed flex flex-col items-center justify-center gap-0.5 text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="text-[9px]">Foto</span>
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <p className="text-[10px] text-muted-foreground">
        {photos.length}/10 foto · Foto pertama jadi image-to-video reference utama untuk GeminiGen
      </p>
    </div>
  )
}

// ─── AnalysisCard — NotebookLM-style rich detail renderer ────────────────────
// Handles BOTH legacy flat shape and new nested-object shape from Gemini 2.5 Flash.

type AnyAnalysis = Record<string, any>

function asString(v: any, fallback = ''): string {
  if (v == null) return fallback
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map((x) => asString(x)).filter(Boolean).join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function flattenObjectToText(obj: any, depth = 0): string {
  if (obj == null) return ''
  if (typeof obj !== 'object') return String(obj)
  if (Array.isArray(obj)) return obj.map((x) => flattenObjectToText(x, depth + 1)).filter(Boolean).join(', ')
  return Object.entries(obj)
    .filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => {
      if (typeof v === 'object') return `${k}: ${flattenObjectToText(v, depth + 1)}`
      return `${k}: ${v}`
    })
    .join(' · ')
}

function AnalysisCard({ analysis }: { analysis: AnyAnalysis }) {
  const a = analysis || {}

  // Normalise possibly-nested fields to text
  const hookTypeStr = asString(a.hookType)
  const overallStyle = asString(a.overallStyle)
  const emotionArcStr = typeof a.emotionArc === 'object'
    ? (Array.isArray(a.emotionArc?.phases) ? a.emotionArc.phases.join(' → ') : flattenObjectToText(a.emotionArc))
    : asString(a.emotionArc)
  const pacingStr = typeof a.pacing === 'object'
    ? `${a.pacing?.speed || ''} · ${a.pacing?.rhythm || ''}`.replace(/^ · /, '').replace(/ · $/, '')
    : asString(a.pacing)
  const toneStr = asString(a.toneOfVoice)
  const cameraStr = typeof a.cameraMovement === 'object'
    ? flattenObjectToText(a.cameraMovement)
    : asString(a.cameraMovement)
  const musicStr = asString(a.musicVibe)

  // Color palette: object {primary, secondary[], accents[]} OR flat string[]
  const palette: string[] = (() => {
    if (Array.isArray(a.colorPalette)) return a.colorPalette
    if (a.colorPalette && typeof a.colorPalette === 'object') {
      return [
        a.colorPalette.primary,
        ...(Array.isArray(a.colorPalette.secondary) ? a.colorPalette.secondary : []),
        ...(Array.isArray(a.colorPalette.accents) ? a.colorPalette.accents : []),
      ].filter(Boolean)
    }
    return []
  })()

  const scenes: any[] = Array.isArray(a.scenes) ? a.scenes : []
  const transcript = asString(a.transcript)
  const keyMessages: any[] = Array.isArray(a.keyMessages) ? a.keyMessages : []
  const visualMotifs: string[] = Array.isArray(a.visualMotifs) ? a.visualMotifs : []
  const brandingMoments: any[] = Array.isArray(a.brandingMoments) ? a.brandingMoments : []
  const uniqueSellingProps: string[] = Array.isArray(a.uniqueSellingProps) ? a.uniqueSellingProps : []

  const scriptStructureStr = typeof a.scriptStructure === 'object' && a.scriptStructure
    ? `${a.scriptStructure.framework || ''}${a.scriptStructure.framework ? ' — ' : ''}${a.scriptStructure.structureBreakdown || ''}`
    : asString(a.scriptStructure)

  const audioDesignStr = typeof a.audioDesign === 'object' && a.audioDesign
    ? flattenObjectToText(a.audioDesign)
    : ''

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Analisis AI {scenes.length > 0 && <Badge variant="outline" className="text-[10px]">{scenes.length} scenes</Badge>}
        </CardTitle>
        <CardDescription className="text-[11px]">
          NotebookLM-style detailed analysis · gunakan untuk Refine Prompt → recreate creative DNA
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {/* Quick summary */}
        {hookTypeStr && (
          <div><span className="font-medium text-muted-foreground">Hook Type: </span><span>{hookTypeStr}</span></div>
        )}
        {overallStyle && (
          <div><span className="font-medium text-muted-foreground">Overall Style: </span><span className="leading-relaxed">{overallStyle}</span></div>
        )}
        {emotionArcStr && (
          <div><span className="font-medium text-muted-foreground">Emotion Arc: </span><span>{emotionArcStr}</span></div>
        )}
        {pacingStr && (
          <div><span className="font-medium text-muted-foreground">Pacing: </span><span>{pacingStr}</span></div>
        )}
        {toneStr && (
          <div><span className="font-medium text-muted-foreground">Tone: </span><span>{toneStr}</span></div>
        )}
        {palette.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-medium text-muted-foreground mr-1">Colors:</span>
            {palette.map((c, i) => (
              <Badge key={i} variant="outline" className="text-xs">{c}</Badge>
            ))}
          </div>
        )}

        {/* Hook breakdown */}
        {a.hookBreakdown && typeof a.hookBreakdown === 'object' && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold text-primary hover:text-primary/80 select-none">
              🎯 Hook Breakdown {a.hookBreakdown.hookWords ? `— "${asString(a.hookBreakdown.hookWords).slice(0, 60)}…"` : ''}
            </summary>
            <div className="mt-2 ml-3 space-y-1 text-xs border-l-2 border-primary/20 pl-3 leading-relaxed">
              {a.hookBreakdown.first3Seconds && <div><b>First 3s:</b> {asString(a.hookBreakdown.first3Seconds)}</div>}
              {a.hookBreakdown.hookWords && <div><b>Hook words:</b> "{asString(a.hookBreakdown.hookWords)}"</div>}
              {a.hookBreakdown.hookMechanism && <div><b>Mechanism:</b> {asString(a.hookBreakdown.hookMechanism)}</div>}
              {a.hookBreakdown.viewerReaction && <div><b>Target reaction:</b> {asString(a.hookBreakdown.viewerReaction)}</div>}
              {a.hookBreakdown.scrollStopPower && <div><b>Scroll-stop:</b> {asString(a.hookBreakdown.scrollStopPower)}</div>}
            </div>
          </details>
        )}

        {/* Scenes */}
        {scenes.length > 0 && (
          <details className="group" open>
            <summary className="cursor-pointer text-xs font-semibold text-primary hover:text-primary/80 select-none">
              📽 Scenes ({scenes.length})
            </summary>
            <div className="mt-2 space-y-2.5">
              {scenes.map((s, i) => (
                <div key={i} className="rounded-md border bg-muted/30 overflow-hidden text-[11.5px] leading-relaxed">
                  {/* Scene header */}
                  <div className="flex items-center gap-2 px-2.5 pt-2.5 pb-1.5">
                    <Badge className="text-[10px]">Scene {s.sceneNumber ?? i + 1}</Badge>
                    {s.duration && <span className="text-muted-foreground text-[10px] font-mono">{s.duration}</span>}
                    {s.title && <span className="font-semibold">{s.title}</span>}
                    {s.hook && <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-300">HOOK</Badge>}
                    {s.generatingImage && <span className="text-[9px] text-primary flex items-center gap-1"><span className="animate-spin inline-block">⏳</span> generating…</span>}
                  </div>
                  {/* Image preview — shown if available */}
                  {s.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.imageUrl} alt={`Scene ${s.sceneNumber ?? i + 1}`} className="w-full object-cover max-h-48" />
                  )}
                  {/* Text fields */}
                  <div className="px-2.5 pb-2.5 pt-1 space-y-1">
                    {s.description && <div><b>Action:</b> {asString(s.description)}</div>}
                    {s.action && s.action !== s.description && <div><b>Action:</b> {asString(s.action)}</div>}
                    {s.setting && <div><b>Setting:</b> {asString(s.setting)}</div>}
                    {s.characters && (
                      <div><b>Characters:</b> {Array.isArray(s.characters) ? s.characters.map((c: any) => typeof c === 'object' ? `${c.role || ''}: ${c.appearance || ''}` : c).join('; ') : asString(s.characters)}</div>
                    )}
                    {(s.voiceover || s.dialogue) && <div><b>Voiceover:</b> <i>"{asString(s.voiceover || s.dialogue)}"</i></div>}
                    {s.textOverlay && <div><b>Text overlay:</b> "{asString(s.textOverlay)}"</div>}
                    {s.cameraShot && <div><b>Camera:</b> {asString(s.cameraShot)} {s.cameraMovement ? `· ${asString(s.cameraMovement)}` : ''}</div>}
                    {s.lighting && <div><b>Lighting:</b> {asString(s.lighting)}</div>}
                    {s.colorGrading && <div><b>Color grade:</b> {asString(s.colorGrading)}</div>}
                    {Array.isArray(s.soundEffects) && s.soundEffects.length > 0 && (
                      <div><b>SFX:</b> {s.soundEffects.join(', ')}</div>
                    )}
                    {s.musicCue && <div><b>Music cue:</b> {asString(s.musicCue)}</div>}
                    {s.transition && <div><b>Transition:</b> {asString(s.transition)}</div>}
                    {Array.isArray(s.visualEffects) && s.visualEffects.length > 0 && (
                      <div><b>Effects:</b> {s.visualEffects.join(', ')}</div>
                    )}
                    {Array.isArray(s.visualElements) && s.visualElements.length > 0 && (
                      <div><b>Visual elements:</b> {s.visualElements.join(', ')}</div>
                    )}
                    {s.purpose && <div><b>Purpose:</b> {asString(s.purpose)}</div>}
                    {s.emotion && <div><b>Emotion:</b> {asString(s.emotion)}</div>}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Script structure */}
        {scriptStructureStr && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold text-primary hover:text-primary/80 select-none">
              📝 Script Structure
            </summary>
            <div className="mt-2 ml-3 space-y-1 text-xs border-l-2 border-primary/20 pl-3 leading-relaxed">
              {typeof a.scriptStructure === 'object' && a.scriptStructure ? (
                <>
                  {a.scriptStructure.framework && <div><b>Framework:</b> {asString(a.scriptStructure.framework)}</div>}
                  {a.scriptStructure.hookLine && <div><b>Hook line:</b> "{asString(a.scriptStructure.hookLine)}"</div>}
                  {Array.isArray(a.scriptStructure.agitationPoints) && a.scriptStructure.agitationPoints.length > 0 && (
                    <div><b>Agitation:</b>
                      <ul className="list-disc ml-4 mt-0.5">
                        {a.scriptStructure.agitationPoints.map((p: string, i: number) => <li key={i}>{p}</li>)}
                      </ul>
                    </div>
                  )}
                  {a.scriptStructure.solutionReveal && <div><b>Solution reveal:</b> {asString(a.scriptStructure.solutionReveal)}</div>}
                  {a.scriptStructure.ctaLine && <div><b>CTA:</b> "{asString(a.scriptStructure.ctaLine)}"</div>}
                  {a.scriptStructure.structureBreakdown && <div><b>Breakdown:</b> {asString(a.scriptStructure.structureBreakdown)}</div>}
                </>
              ) : (
                <div>{scriptStructureStr}</div>
              )}
            </div>
          </details>
        )}

        {/* Audio Design */}
        {audioDesignStr && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold text-primary hover:text-primary/80 select-none">
              🔊 Audio Design
            </summary>
            <div className="mt-2 ml-3 space-y-1 text-xs border-l-2 border-primary/20 pl-3 leading-relaxed">
              {a.audioDesign?.voiceover && (
                <div><b>Voiceover:</b> {flattenObjectToText(a.audioDesign.voiceover)}</div>
              )}
              {a.audioDesign?.music && (
                <div><b>Music:</b> {flattenObjectToText(a.audioDesign.music)}</div>
              )}
              {Array.isArray(a.audioDesign?.soundEffects) && a.audioDesign.soundEffects.length > 0 && (
                <div><b>SFX:</b> {a.audioDesign.soundEffects.join(', ')}</div>
              )}
              {musicStr && <div><b>Vibe:</b> {musicStr}</div>}
            </div>
          </details>
        )}

        {/* Camera */}
        {cameraStr && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold text-primary hover:text-primary/80 select-none">
              🎥 Camera & Composition
            </summary>
            <div className="mt-2 ml-3 text-xs border-l-2 border-primary/20 pl-3 leading-relaxed">{cameraStr}</div>
          </details>
        )}

        {/* Key messages */}
        {keyMessages.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold text-primary hover:text-primary/80 select-none">
              💡 Key Messages ({keyMessages.length})
            </summary>
            <ul className="mt-2 ml-3 space-y-1 text-xs border-l-2 border-primary/20 pl-3 list-disc list-inside leading-relaxed">
              {keyMessages.map((m, i) => (
                <li key={i}>
                  {typeof m === 'object' ? (
                    <>
                      <b>{asString(m.message)}</b>
                      {m.deliveryMethod && <span className="text-muted-foreground"> · via {asString(m.deliveryMethod)}</span>}
                      {m.sceneRef != null && <span className="text-muted-foreground"> · scene {m.sceneRef}</span>}
                    </>
                  ) : asString(m)}
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* Visual motifs */}
        {visualMotifs.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold text-primary hover:text-primary/80 select-none">
              🎨 Visual Motifs
            </summary>
            <ul className="mt-2 ml-3 text-xs border-l-2 border-primary/20 pl-3 list-disc list-inside leading-relaxed">
              {visualMotifs.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          </details>
        )}

        {/* Branding moments */}
        {brandingMoments.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold text-primary hover:text-primary/80 select-none">
              🏷 Branding Moments ({brandingMoments.length})
            </summary>
            <ul className="mt-2 ml-3 space-y-0.5 text-xs border-l-2 border-primary/20 pl-3 leading-relaxed">
              {brandingMoments.map((b, i) => (
                <li key={i}>
                  <span className="font-mono text-[10px]">{asString(b.timestamp)}</span>
                  {' '}<Badge variant="outline" className="text-[9px]">{asString(b.type)}</Badge>
                  {' '}{asString(b.description)}
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* Product placement */}
        {a.productPlacement && typeof a.productPlacement === 'object' && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold text-primary hover:text-primary/80 select-none">
              📦 Product Placement
            </summary>
            <div className="mt-2 ml-3 space-y-1 text-xs border-l-2 border-primary/20 pl-3 leading-relaxed">
              {a.productPlacement.frequency && <div><b>Frequency:</b> {asString(a.productPlacement.frequency)}</div>}
              {a.productPlacement.placement && <div><b>Placement:</b> {asString(a.productPlacement.placement)}</div>}
              {a.productPlacement.transformation && <div><b>Transformation:</b> {asString(a.productPlacement.transformation)}</div>}
            </div>
          </details>
        )}

        {/* CTA strategy */}
        {a.ctaStrategy && typeof a.ctaStrategy === 'object' && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold text-primary hover:text-primary/80 select-none">
              🎯 CTA Strategy
            </summary>
            <div className="mt-2 ml-3 space-y-1 text-xs border-l-2 border-primary/20 pl-3 leading-relaxed">
              {a.ctaStrategy.type && <div><b>Type:</b> {asString(a.ctaStrategy.type)}</div>}
              {a.ctaStrategy.placement && <div><b>Placement:</b> {asString(a.ctaStrategy.placement)}</div>}
              {a.ctaStrategy.wording && <div><b>Wording:</b> "{asString(a.ctaStrategy.wording)}"</div>}
              {a.ctaStrategy.visualCue && <div><b>Visual cue:</b> {asString(a.ctaStrategy.visualCue)}</div>}
            </div>
          </details>
        )}

        {/* Target audience */}
        {a.targetAudience && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold text-primary hover:text-primary/80 select-none">
              👥 Target Audience
            </summary>
            <div className="mt-2 ml-3 text-xs border-l-2 border-primary/20 pl-3 leading-relaxed">{asString(a.targetAudience)}</div>
          </details>
        )}

        {/* Unique selling props */}
        {uniqueSellingProps.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold text-primary hover:text-primary/80 select-none">
              ⭐ Unique Selling Props
            </summary>
            <ul className="mt-2 ml-3 text-xs border-l-2 border-primary/20 pl-3 list-disc list-inside leading-relaxed">
              {uniqueSellingProps.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          </details>
        )}

        {/* Platform optimizations */}
        {a.platformOptimizations && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold text-primary hover:text-primary/80 select-none">
              📱 Platform Optimizations
            </summary>
            <div className="mt-2 ml-3 text-xs border-l-2 border-primary/20 pl-3 leading-relaxed">{asString(a.platformOptimizations)}</div>
          </details>
        )}

        {/* Creative director notes */}
        {a.creativeDirectorNotes && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold text-primary hover:text-primary/80 select-none">
              🎬 Creative Director Notes
            </summary>
            <div className="mt-2 ml-3 text-xs border-l-2 border-primary/20 pl-3 leading-relaxed italic">{asString(a.creativeDirectorNotes)}</div>
          </details>
        )}

        {/* Full transcript */}
        {transcript && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold text-primary hover:text-primary/80 select-none">
              📜 Full Transcript ({transcript.length} chars)
            </summary>
            <div className="mt-2 ml-3 text-xs border-l-2 border-primary/20 pl-3 leading-relaxed font-mono whitespace-pre-wrap">{transcript}</div>
          </details>
        )}
      </CardContent>
    </Card>
  )
}
