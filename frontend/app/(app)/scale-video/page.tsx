'use client'
import { useEffect, useState, useRef } from 'react'
import { Loader2, AlertCircle, Video, Sparkles, Play, Download, Link2, Wand2, ChevronRight, Package, User, Ban, Plus, X, Image as ImageIcon } from 'lucide-react'
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
import { AngleSelector } from '@/components/ads/AngleSelector'
import {
  analyzeWinningVideo,
  analyzeWinningVideoFromUrl,
  translateVideoPrompt,
  generateScaleVideoJob,
  getProducts,
  type Product,
  type ScaleVideoGenerateResponse,
} from '@/lib/api'
import type { ScalingAngle, AngleVariation } from '@/lib/types'

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

  // Asset mode — product (existing) / character (new) / none
  const [assetMode, setAssetMode] = useState<'product' | 'character' | 'none'>('product')
  // Character mode states
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
  }, [])

  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight
    }
  }, [liveLog])

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
      setUserIntent('')
      setShowIntentStep(true)
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
      const result = await translateVideoPrompt({
        videoAnalysis,
        userIntent: userIntent.trim(),
        productName:
          assetMode === 'product'
            ? (selectedProduct?.name ?? 'Unknown Product')
            : assetMode === 'character'
            ? (characterName || 'Character')
            : 'Generic',
        productDescription:
          assetMode === 'product'
            ? (selectedProduct?.description ?? '')
            : assetMode === 'character'
            ? `Character name: ${characterName || 'unnamed'}. ${characterPhotos.length} character photo(s) provided.`
            : '',
        assetMode,
        characterPhotoBase64:
          assetMode === 'character' && characterPhotos.length > 0
            ? characterPhotos[0].replace(/^data:[^;]+;base64,/, '')
            : undefined,
        characterPhotoMime:
          assetMode === 'character' && characterPhotos.length > 0
            ? (characterPhotos[0].match(/^data:([^;]+);/)?.[1] ?? 'image/jpeg')
            : undefined,
      })
      setRefinedPrompt(result.videoPrompt || '')
      setHookVariants(result.hookVariants || [])
      setScriptOutline(result.scriptOutline || '')
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || 'Gagal generate prompt')
    } finally {
      setTranslating(false)
    }
  }

  const handleGenerate = async () => {
    if (!videoAnalysis || selectedAngles.length === 0) return
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
        productName = characterName || 'Character'
        productDescription = `Character: ${characterName || 'unnamed'}`
        if (characterPhotos.length > 0) {
          // First photo as primary image-to-video reference
          const firstMatch = characterPhotos[0].match(/^data:([^;]+);base64,(.+)$/)
          productPhotoBase64 = firstMatch?.[2] ?? undefined
          productPhotoMime = firstMatch?.[1] ?? undefined
          // All photos as additional references for combined description
          characterPhotosBase64 = characterPhotos.map((p) =>
            p.replace(/^data:[^;]+;base64,/, '')
          )
        }
      }
      // assetMode === 'none': all remain undefined/empty, productName='Generic'

      const resp = await generateScaleVideoJob({
        videoAnalysis,
        productName,
        productDescription,
        selectedAngles,
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
    <div className="space-y-8">
      <div>
        <div className="mb-2 inline-flex items-center gap-2">
          <Video className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Scale Winning Video</h1>
        </div>
        <p className="text-muted-foreground">
          Upload video iklan winning → AI analisis konsep → adaptasi ke produkmu → generate variasi video baru dengan GeminiGen grok-3 (10 detik).
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        {/* ── Left panel ── */}
        <div className="space-y-6">
          {/* Step 1 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">1. Upload & Analyze Video</CardTitle>
              <CardDescription>MP4 / MOV / WEBM, maks 50MB.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Sprint 3 — Input mode toggle (file upload vs URL) */}
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
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors flex items-center justify-center gap-1 ${
                    inputMode === 'url' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Dari URL
                </button>
              </div>

              {inputMode === 'file' ? (
                <Dropzone file={file} onChange={setFile} accept="video" />
              ) : (
                <div className="space-y-3">
                  <Input
                    type="url"
                    placeholder="https://www.instagram.com/reel/..."
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    className="text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Support: <b>YouTube Shorts</b>, <b>TikTok</b>, <b>Facebook</b>, <b>Instagram</b>*. Video harus publik.
                    <br />
                    <span className="text-amber-700 dark:text-amber-400 text-[11px]">*Instagram saat ini wajib login (yt-dlp limitation) — kalau gagal, download manual lalu Upload File.</span>
                  </p>

                  {/* Sprint 3 v2 — Analysis mode toggle */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Mode analisis:</p>
                    <div className="flex rounded-md border bg-muted/30 p-0.5 gap-0.5">
                      <button
                        type="button"
                        onClick={() => setAnalyzeMode('audio')}
                        className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                          analyzeMode === 'audio' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        🎙 Audio Only
                      </button>
                      <button
                        type="button"
                        onClick={() => setAnalyzeMode('full')}
                        className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                          analyzeMode === 'full' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        🎬 Visual + Audio
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {analyzeMode === 'audio'
                        ? 'Hanya analisis script/narasi (~15 detik, lebih murah)'
                        : 'Analisis visual + audio lengkap via Gemini 2.5 Flash (~30-45 detik)'}
                    </p>
                  </div>
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
          </Card>

          {/* Step 2 — Setting & Aset (asset mode + format + angles) */}
          {videoAnalysis && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">2. Setting & Aset</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">

                {/* ── Asset mode selector ─────────────────── */}
                <div className="space-y-2">
                  <Label>Tambahan aset tersimpan</Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { mode: 'product', icon: Package, label: 'Produk' },
                        { mode: 'character', icon: User, label: 'Karakter' },
                        { mode: 'none', icon: Ban, label: 'None' },
                      ] as const
                    ).map(({ mode, icon: Icon, label }) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setAssetMode(mode)}
                        className={`flex flex-col items-center gap-1 rounded-lg border py-2.5 text-xs font-medium transition-colors ${
                          assetMode === mode
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-background text-muted-foreground hover:text-foreground hover:border-muted-foreground'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── Product picker ───────────────────────── */}
                {assetMode === 'product' && products.length > 0 && (
                  <div className="space-y-2">
                    <Select
                      value={selectedProduct?.id || ''}
                      onValueChange={(id) => {
                        const p = products.find((x) => x.id === id)
                        if (p) setSelectedProduct(p)
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Pilih produk…" /></SelectTrigger>
                      <SelectContent>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}{p.price !== undefined ? ` — ${fmt(p.price)}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedProduct?.photos?.[0] && (
                      <p className="flex items-center gap-1 text-xs text-emerald-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                        Foto produk tersedia — image-to-video aktif
                      </p>
                    )}
                  </div>
                )}
                {assetMode === 'product' && products.length === 0 && (
                  <p className="text-xs text-muted-foreground rounded border border-dashed p-2 text-center">
                    Belum ada produk tersimpan. Tambah dulu di menu Produk.
                  </p>
                )}

                {/* ── Character builder ────────────────────── */}
                {assetMode === 'character' && (
                  <CharacterBuilder
                    name={characterName}
                    onNameChange={setCharacterName}
                    photos={characterPhotos}
                    onPhotosChange={setCharacterPhotos}
                  />
                )}

                {/* ── None info ────────────────────────────── */}
                {assetMode === 'none' && (
                  <p className="text-xs text-muted-foreground rounded border border-dashed p-2 text-center">
                    Generate tanpa referensi foto produk / karakter.
                  </p>
                )}

                {/* Format */}
                <div className="space-y-2">
                  <Label>Format</Label>
                  <div className="flex gap-2">
                    {FORMATS.map((f) => (
                      <Button
                        key={f.value}
                        type="button"
                        size="sm"
                        variant={aspectRatio === f.value ? 'default' : 'outline'}
                        onClick={() => setAspectRatio(f.value)}
                        className="flex-1 flex-col h-auto py-2"
                      >
                        <span className="text-xs font-semibold">{f.value}</span>
                        <span className="text-[10px] opacity-70">{f.hint}</span>
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Duration info badge */}
                <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                  <Video className="h-3.5 w-3.5 text-primary shrink-0" />
                  <p className="text-xs text-primary font-medium">Durasi: 10 detik · Model: GeminiGen grok-3</p>
                </div>

                {/* Angle selector */}
                {availableAngles.length > 0 && (
                  <div>
                    <Label className="mb-2 block">Pilih angle</Label>
                    <AngleSelector
                      angles={availableAngles}
                      selected={selectedAngles}
                      onChange={setSelectedAngles}
                    />
                  </div>
                )}

                <Button
                  className="w-full"
                  onClick={handleGenerate}
                  disabled={generating || selectedAngles.length === 0}
                >
                  {generating ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Generating videos… (bisa 5-10 menit)</>
                  ) : (
                    <><Video className="h-4 w-4" /> Generate {selectedAngles.length} variasi video</>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Right panel ── */}
        <div className="space-y-6">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Live action log — shows during URL analysis (SSE phase events) */}
          {(analyzing || liveLog.length > 0) && inputMode === 'url' && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  {analyzing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
                  )}
                  Live System Log
                </CardTitle>
                <CardDescription className="text-[11px]">
                  {analyzing ? 'Sistem sedang bekerja…' : 'Selesai ✓'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div ref={logScrollRef} className="max-h-48 overflow-y-auto rounded-md bg-muted/40 px-2.5 py-2 space-y-1 font-mono text-[10.5px]">
                  {liveLog.length === 0 ? (
                    <p className="text-muted-foreground italic">Initialising...</p>
                  ) : (
                    liveLog.map((entry, i) => {
                      const startTs = liveLog[0].ts
                      return (
                        <div key={i} className="flex gap-2 leading-snug">
                          <span className="shrink-0 text-muted-foreground/60 tabular-nums">
                            +{((entry.ts - startTs) / 1000).toFixed(1)}s
                          </span>
                          <span className={`shrink-0 font-semibold ${phaseColor(entry.phase)}`}>
                            [{entry.phase}]
                          </span>
                          <span className="text-foreground/80 break-words">{entry.message}</span>
                          {entry.detail && (
                            <span className="text-muted-foreground/60 italic ml-1 truncate">— {entry.detail.slice(0, 80)}</span>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Analyzing skeleton — only for file upload (URL has live log) */}
          {analyzing && inputMode === 'file' && (
            <Card>
              <CardContent className="space-y-3 p-6">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-4/5" />
              </CardContent>
            </Card>
          )}

          {/* Analysis result — NotebookLM-style rich detail with expandable sections */}
          {videoAnalysis && !analyzing && (
            <AnalysisCard analysis={videoAnalysis} />
          )}

          {/* Sprint 3 v2 — Step 1.5: Intent to Prompt */}
          {videoAnalysis && !analyzing && showIntentStep && (
            <Card className="border-primary/30 bg-primary/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Wand2 className="h-4 w-4 text-primary" />
                  Refine Prompt
                </CardTitle>
                <CardDescription>
                  Ceritakan mau dipakai untuk apa — AI akan translate analisis ini jadi video prompt yang spesifik untuk produkmu.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  placeholder="Contoh: jual suplemen kolagen untuk wanita 30-45 tahun, target ibu-ibu Jakarta yang aktif, tone: warm dan aspirational"
                  value={userIntent}
                  onChange={(e) => setUserIntent(e.target.value)}
                  rows={3}
                  className="text-sm resize-none"
                />

                <Button
                  className="w-full"
                  onClick={handleTranslatePrompt}
                  disabled={!userIntent.trim() || translating}
                >
                  {translating ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Generating refined prompt…</>
                  ) : (
                    <><Wand2 className="h-4 w-4" /> Refine Prompt dengan AI</>
                  )}
                </Button>

                {assetMode === 'product' && !selectedProduct && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    ℹ️ Belum pilih produk — refine akan pakai placeholder. Pilih produk untuk hasil terbaik.
                  </p>
                )}
                {assetMode === 'character' && !characterName.trim() && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    ℹ️ Isi nama karakter untuk hasil yang lebih spesifik.
                  </p>
                )}

                {refinedPrompt && (
                  <div className="space-y-3 pt-1">
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-primary">Video Prompt (editable):</p>
                      <Textarea
                        value={refinedPrompt}
                        onChange={(e) => setRefinedPrompt(e.target.value)}
                        rows={6}
                        className="text-xs font-mono resize-none"
                      />
                    </div>

                    {hookVariants.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-semibold text-muted-foreground">Hook variants:</p>
                        <div className="space-y-1">
                          {hookVariants.map((h, i) => (
                            <div key={i} className="rounded border bg-background px-2.5 py-1.5 text-xs">
                              <span className="font-medium text-primary">{i + 1}.</span> {h}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {scriptOutline && (
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Script outline</summary>
                        <p className="mt-1.5 rounded border bg-muted p-2.5 text-xs leading-relaxed whitespace-pre-wrap">{scriptOutline}</p>
                      </details>
                    )}

                    <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 px-3 py-2">
                      <ChevronRight className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                        Prompt siap — klik Generate di Step 2 untuk pakai prompt ini di semua variasi.
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Generating skeletons */}
          {generating && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-primary font-medium">
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating {selectedAngles.length} variasi video dengan GeminiGen grok-3… estimasi 5-10 menit
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {selectedAngles.map((_, i) => (
                  <Card key={i}>
                    <Skeleton className="aspect-video w-full rounded-t-lg" />
                    <CardContent className="space-y-2 p-4">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Results grid */}
          {result && !generating && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{result.totalVariations} variasi video siap</h2>
                <p className="text-sm text-muted-foreground">{result.productName} · {result.aspectRatio} · 10s</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {result.variations.map((v, i) => (
                  <VideoVariationCard key={i} variation={v} index={i} />
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!analyzing && !videoAnalysis && !error && (
            <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
              <Video className="mx-auto mb-3 h-10 w-10 opacity-40" />
              <p className="font-medium">Upload video iklan winning untuk mulai.</p>
              <p className="mt-1 text-sm">AI analisis konsep → generate variasi video baru.</p>
            </div>
          )}
        </div>
      </div>
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
                <div key={i} className="rounded-md border bg-muted/30 p-2.5 space-y-1 text-[11.5px] leading-relaxed">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className="text-[10px]">Scene {s.sceneNumber ?? i + 1}</Badge>
                    {s.duration && <span className="text-muted-foreground text-[10px] font-mono">{s.duration}</span>}
                    {s.title && <span className="font-semibold">{s.title}</span>}
                    {s.hook && <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-300">HOOK</Badge>}
                  </div>
                  {s.description && <div><b>Action:</b> {asString(s.description)}</div>}
                  {s.action && s.action !== s.description && <div><b>Action:</b> {asString(s.action)}</div>}
                  {s.setting && <div><b>Setting:</b> {asString(s.setting)}</div>}
                  {s.characters && (
                    <div><b>Characters:</b> {Array.isArray(s.characters) ? s.characters.map((c: any) => typeof c === 'object' ? `${c.role || ''}: ${c.appearance || ''}` : c).join('; ') : asString(s.characters)}</div>
                  )}
                  {s.dialogue && <div><b>Dialogue:</b> "{asString(s.dialogue)}"</div>}
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
