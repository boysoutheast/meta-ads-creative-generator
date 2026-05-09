'use client'
import { useEffect, useState } from 'react'
import { Loader2, AlertCircle, Video, Sparkles, Play, Download, Link2, Wand2, ChevronRight } from 'lucide-react'
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

  useEffect(() => {
    getProducts()
      .then((list) => {
        setProducts(list)
        if (list.length > 0) setSelectedProduct(list[0])
      })
      .catch(() => {})
  }, [])

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
        ? await analyzeWinningVideoFromUrl(urlInput.trim(), analyzeMode)
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
    if (!userIntent.trim() || !videoAnalysis || !selectedProduct) return
    setError(null)
    setTranslating(true)
    try {
      const result = await translateVideoPrompt({
        videoAnalysis,
        userIntent: userIntent.trim(),
        productName: selectedProduct.name,
        productDescription: selectedProduct.description,
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
    if (!videoAnalysis || !selectedProduct || selectedAngles.length === 0) return
    setError(null)
    setGenerating(true)
    setResult(null)

    try {
      const photoDataUrl = selectedProduct.photos?.[0]
      const photoMatch = photoDataUrl?.match(/^data:([^;]+);base64,(.+)$/)
      const productPhotoMime = photoMatch?.[1] ?? undefined
      const productPhotoBase64 = photoMatch?.[2] ?? undefined

      const resp = await generateScaleVideoJob({
        videoAnalysis,
        productName: selectedProduct.name,
        productDescription: selectedProduct.description,
        selectedAngles,
        aspectRatio,
        productPhotoBase64,
        productPhotoMime,
        // Sprint 3 v2 — when user has refined a prompt via intent-to-prompt, use that for every variation
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
                    Support: Instagram Reels, TikTok, YouTube Shorts, Facebook. Video harus publik.
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

          {/* Step 2 */}
          {videoAnalysis && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">2. Pilih Produk & Setting</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Product selector */}
                {products.length > 0 && (
                  <div className="space-y-2">
                    <Label>Produk</Label>
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
                  disabled={generating || !selectedProduct || selectedAngles.length === 0}
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

          {/* Analyzing skeleton */}
          {analyzing && (
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

          {/* Analysis summary */}
          {videoAnalysis && !analyzing && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" /> Analisis AI
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {videoAnalysis.hookType && (
                  <div><span className="font-medium text-muted-foreground">Hook: </span>{videoAnalysis.hookType}</div>
                )}
                {videoAnalysis.overallStyle && (
                  <div><span className="font-medium text-muted-foreground">Style: </span>{videoAnalysis.overallStyle}</div>
                )}
                {videoAnalysis.emotionArc && (
                  <div><span className="font-medium text-muted-foreground">Emotion: </span>{videoAnalysis.emotionArc}</div>
                )}
                {videoAnalysis.pacing && (
                  <div><span className="font-medium text-muted-foreground">Pacing: </span>{videoAnalysis.pacing}</div>
                )}
                {videoAnalysis.colorPalette?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {videoAnalysis.colorPalette.map((c: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs">{c}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
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
                  disabled={!userIntent.trim() || !selectedProduct || translating}
                >
                  {translating ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Generating refined prompt…</>
                  ) : (
                    <><Wand2 className="h-4 w-4" /> Refine Prompt dengan AI</>
                  )}
                </Button>

                {!selectedProduct && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    ⚠️ Pilih produk dulu di Step 2 (panel kiri) untuk enable refine.
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
