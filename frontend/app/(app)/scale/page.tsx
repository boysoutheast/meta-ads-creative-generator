'use client'
import { useEffect, useState } from 'react'
import { Loader2, Sparkles, AlertCircle, Layers, Presentation, ChevronDown, ChevronUp, Download } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Dropzone } from '@/components/ads/Dropzone'
import { AngleSelector } from '@/components/ads/AngleSelector'
import { AnalysisCard } from '@/components/ads/AnalysisCard'
import { AdCard } from '@/components/ads/AdCard'
import { CarouselPreview } from '@/components/ads/CarouselPreview'
import {
  analyzeWinningAd,
  generateScalingVariations,
  generateScalingVariationsStream,
  generateScaleCarousel,
  getProducts,
  type Product,
  type StreamEvent,
} from '@/lib/api'
import { saveHistoryEntry } from '@/lib/history'
import { compressImage } from '@/lib/utils'
import { ASPECT_RATIOS } from '@/lib/types'
import type {
  AnalyzeWinningResponse,
  GenerateVariationsResponse,
  ScaleCarouselResponse,
  AspectRatio,
  ScalingAngle,
} from '@/lib/types'

const fmt = (n?: number) =>
  n !== undefined ? 'Rp ' + n.toLocaleString('id-ID') : ''

async function downloadAllImages(variations: any[], productName: string) {
  const allUrls: { url: string; filename: string }[] = []
  variations.forEach((v) => {
    const urls: string[] = v.imageUrls?.length ? v.imageUrls : (v.imageUrl ? [v.imageUrl] : [])
    urls.forEach((url, idx) => {
      const angleSlug = (v.angle || 'ad').replace(/_/g, '-').toLowerCase()
      const headlineSlug = (v.headline || '').slice(0, 25).toLowerCase()
        .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/-$/, '')
      const suffix = urls.length > 1 ? `-${idx + 1}` : ''
      allUrls.push({ url, filename: `${angleSlug}${headlineSlug ? '-' + headlineSlug : ''}${suffix}.jpg` })
    })
  })
  for (const { url, filename } of allUrls) {
    try {
      const res = await fetch(url, { mode: 'cors' })
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
      // Small delay to avoid browser blocking rapid downloads
      await new Promise((r) => setTimeout(r, 300))
    } catch {
      window.open(url, '_blank')
    }
  }
}

export default function ScalePage() {
  const [file, setFile] = useState<File | null>(null)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [generateImages, setGenerateImages] = useState(true)

  const [analyzing, setAnalyzing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [analysisResp, setAnalysisResp] = useState<AnalyzeWinningResponse | null>(null)
  const [selectedAngles, setSelectedAngles] = useState<string[]>([])
  const [angleQuantities, setAngleQuantities] = useState<Record<string, number>>({})
  const [result, setResult] = useState<GenerateVariationsResponse | null>(null)
  const [productVisualDescription, setProductVisualDescription] = useState<string | null>(null)
  const [winningAdBase64, setWinningAdBase64] = useState<string | null>(null)
  const [winningAdMime, setWinningAdMime] = useState<string>('image/jpeg')
  const [masterImagePrompt, setMasterImagePrompt] = useState<string | null>(null)

  // Live generation progress
  const [genStatus, setGenStatus] = useState<string>('')
  const [genProgress, setGenProgress] = useState<{ completed: number; total: number; angle: string } | null>(null)

  // Carousel state — now lives in settings panel
  const [carouselOpen, setCarouselOpen] = useState(false)
  const [carouselSlideCount, setCarouselSlideCount] = useState(5)
  const [generatingCarousel, setGeneratingCarousel] = useState(false)
  const [carousel, setCarousel] = useState<ScaleCarouselResponse | null>(null)

  // Product state
  const [products, setProducts] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)

  useEffect(() => {
    getProducts()
      .then((list) => {
        setProducts(list)
        if (list.length > 0) setSelectedProduct(list[0])
      })
      .catch(() => {})
  }, [])

  // ── Angle selection — keeps quantities in sync ──────────────────────────────
  const handleAngleChange = (newSelected: string[]) => {
    setSelectedAngles(newSelected)
    setAngleQuantities((prev) => {
      const next: Record<string, number> = {}
      newSelected.forEach((key) => { next[key] = prev[key] ?? 1 })
      return next
    })
  }

  const handleQtyChange = (key: string, qty: number) => {
    setAngleQuantities((prev) => ({ ...prev, [key]: qty }))
  }

  // Total images to be generated
  const totalImages = selectedAngles.reduce((sum, key) => sum + (angleQuantities[key] ?? 1), 0)

  const handleAnalyze = async () => {
    if (!file) return
    setError(null)
    setAnalyzing(true)
    setResult(null)
    setAnalysisResp(null)
    setCarousel(null)
    setMasterImagePrompt(null)
    try {
      const compressed = await compressImage(file)
      const resp = await analyzeWinningAd(compressed)
      setAnalysisResp(resp)
      handleAngleChange((resp.availableAngles ?? []).map((a) => a.key))
      if (resp.winningAdBase64) {
        setWinningAdBase64(resp.winningAdBase64)
        setWinningAdMime(resp.winningAdMime || 'image/jpeg')
      }
      if (resp.masterImagePrompt) {
        setMasterImagePrompt(resp.masterImagePrompt)
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || 'Gagal menganalisis file')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleGenerate = async () => {
    if (!analysisResp || !selectedProduct || selectedAngles.length === 0) return
    setError(null)
    setGenerating(true)
    setResult(null)
    setCarousel(null)
    setGenStatus('')
    setGenProgress(null)
    try {
      const photoDataUrl = selectedProduct.photos?.[0]
      const photoMatch = photoDataUrl?.match(/^data:([^;]+);base64,(.+)$/)
      const productPhotoMime = photoMatch?.[1] ?? undefined
      const productPhotoBase64 = photoMatch?.[2] ?? undefined

      const payload = {
        analysis: analysisResp.analysis,
        productName: selectedProduct.name,
        productDescription: selectedProduct.description,
        selectedAngles,
        aspectRatio,
        generateImages,
        productPhotoBase64,
        productPhotoMime,
        winningAdBase64: winningAdBase64 ?? undefined,
        winningAdMime,
        productPrice: selectedProduct.price ?? undefined,
        productPromoPrice: selectedProduct.promoPrice ?? undefined,
        masterImagePrompt: masterImagePrompt ?? undefined,
        angleQuantities,
      }

      const handleStreamEvent = (evt: StreamEvent) => {
        if (evt.type === 'status') setGenStatus(evt.message)
        if (evt.type === 'start') setGenProgress({ completed: 0, total: evt.totalImages, angle: '' })
        if (evt.type === 'progress') setGenProgress({ completed: evt.completed, total: evt.total, angle: evt.angle })
      }

      // Use streaming endpoint when generating images (shows live progress bar);
      // fall back to plain axios call when generateImages is false (copy-only, instant)
      const resp = generateImages
        ? await generateScalingVariationsStream(payload, handleStreamEvent)
        : await generateScalingVariations(payload)

      setResult(resp)
      setProductVisualDescription(resp.productVisualDescription ?? null)

      const firstImg = resp.variations.find((v: any) => v.imageUrl)?.imageUrl
      saveHistoryEntry({
        kind: 'scale',
        productName: selectedProduct.name,
        thumbnailUrl: firstImg || null,
        payload: { ...resp, aspectRatio },
      })
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || 'Gagal generate variasi')
    } finally {
      setGenerating(false)
      setGenProgress(null)
      setGenStatus('')
    }
  }

  const handleGenerateCarousel = async () => {
    if (!analysisResp || !selectedProduct) return
    setGeneratingCarousel(true)
    setCarousel(null)
    try {
      const photoDataUrl = selectedProduct.photos?.[0]
      const photoMatch = photoDataUrl?.match(/^data:([^;]+);base64,(.+)$/)
      const productPhotoMime = photoMatch?.[1] ?? undefined
      const productPhotoBase64 = photoMatch?.[2] ?? undefined

      const resp = await generateScaleCarousel({
        analysis: analysisResp.analysis,
        productName: selectedProduct.name,
        productDescription: selectedProduct.description,
        productVisualDescription: productVisualDescription ?? undefined,
        slideCount: carouselSlideCount,
        aspectRatio: '1:1',
        generateImages,
        productPhotoBase64,
        productPhotoMime,
        winningAdBase64: winningAdBase64 ?? undefined,
        winningAdMime,
      })
      setCarousel(resp)
      saveHistoryEntry({
        kind: 'carousel',
        productName: selectedProduct.name,
        thumbnailUrl: resp.slides.find((s) => s.imageUrl)?.imageUrl || null,
        payload: resp,
      })
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || 'Gagal generate carousel')
    } finally {
      setGeneratingCarousel(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-2 inline-flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Scale Winning Image</h1>
        </div>
        <p className="text-muted-foreground">
          Upload iklan winning, AI analisis pola-nya, lalu generate variasi baru dengan angle berbeda.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        {/* ── Left panel ── */}
        <div className="space-y-6">
          {/* Step 1 — Upload */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">1. Upload iklan winning</CardTitle>
              <CardDescription>Image atau video. Maks 50MB.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Dropzone file={file} onChange={setFile} accept="both" />
              <Button className="w-full" onClick={handleAnalyze} disabled={!file || analyzing}>
                {analyzing ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Menganalisis…</>
                ) : (
                  <><Sparkles className="h-4 w-4" /> Analyze</>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Step 2 — Settings + Angles + Carousel */}
          {analysisResp && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">2. Setting & angle</CardTitle>
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
                        Foto produk tersedia — akan digunakan untuk visual injection
                      </p>
                    )}
                  </div>
                )}

                {/* Aspect ratio */}
                <div className="space-y-2">
                  <Label>Aspect ratio</Label>
                  <Select value={aspectRatio} onValueChange={(v) => setAspectRatio(v as AspectRatio)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ASPECT_RATIOS.map((ar) => (
                        <SelectItem key={ar.value} value={ar.value}>
                          {ar.label} <span className="ml-2 text-xs text-muted-foreground">{ar.size}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Generate images toggle */}
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <Label htmlFor="genImg">Generate gambar AI</Label>
                    <p className="text-xs text-muted-foreground">Kalau OFF, hanya copy + prompt.</p>
                  </div>
                  <Switch id="genImg" checked={generateImages} onCheckedChange={setGenerateImages} />
                </div>

                {/* Angle selector — with per-angle qty when generateImages is on */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <Label>Pilih angle</Label>
                    {generateImages && selectedAngles.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {totalImages} gambar total
                        {totalImages !== selectedAngles.length && (
                          <span className="ml-1 text-amber-600">({selectedAngles.length} angle)</span>
                        )}
                      </span>
                    )}
                  </div>
                  {generateImages && (
                    <p className="mb-2 text-xs text-muted-foreground">
                      Atur jumlah gambar per angle di kotak angka kanan tiap pilihan.
                    </p>
                  )}
                  <AngleSelector
                    angles={(analysisResp.availableAngles ?? []) as ScalingAngle[]}
                    selected={selectedAngles}
                    onChange={handleAngleChange}
                    quantities={angleQuantities}
                    onQtyChange={handleQtyChange}
                    showQty={generateImages}
                  />
                </div>

                {/* Generate variations button */}
                <Button
                  className="w-full"
                  onClick={handleGenerate}
                  disabled={generating || !selectedProduct || selectedAngles.length === 0}
                >
                  {generating ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
                  ) : (
                    <>
                      Generate {selectedAngles.length} variasi
                      {generateImages && totalImages !== selectedAngles.length && (
                        <span className="ml-1 opacity-70">· {totalImages} gambar</span>
                      )}
                    </>
                  )}
                </Button>

                {/* ── Carousel section ── */}
                <div className="rounded-lg border border-dashed">
                  <button
                    type="button"
                    onClick={() => setCarouselOpen((v) => !v)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-lg"
                  >
                    <div className="flex items-center gap-2">
                      <Presentation className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">Generate Carousel</span>
                      {carousel && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          ✓ {carousel.totalSlides} slide
                        </Badge>
                      )}
                    </div>
                    {carouselOpen
                      ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    }
                  </button>

                  {carouselOpen && (
                    <div className="border-t px-4 pb-4 pt-3 space-y-3">
                      <p className="text-xs text-muted-foreground">
                        AI buat struktur hook → benefit → CTA otomatis berdasarkan analisis winning ad.
                      </p>
                      <div className="space-y-2">
                        <Label className="text-xs">Berapa slide?</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {[3, 4, 5, 6, 7, 8].map((n) => (
                            <Button
                              key={n}
                              type="button"
                              size="sm"
                              variant={carouselSlideCount === n ? 'default' : 'outline'}
                              onClick={() => setCarouselSlideCount(n)}
                              className="h-8 w-8 p-0 text-xs"
                            >
                              {n}
                            </Button>
                          ))}
                        </div>
                      </div>
                      <Button
                        className="w-full"
                        size="sm"
                        onClick={handleGenerateCarousel}
                        disabled={generatingCarousel || !selectedProduct}
                      >
                        {generatingCarousel ? (
                          <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating carousel…</>
                        ) : (
                          <>Generate {carouselSlideCount} slide</>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
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

          {analyzing && (
            <Card>
              <CardContent className="space-y-3 p-6">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="h-3 w-2/3" />
              </CardContent>
            </Card>
          )}

          {analysisResp && <AnalysisCard analysis={analysisResp.analysis} />}

          {generating && (
            <div className="space-y-4">
              {/* ── Progress block ── */}
              <div className="rounded-xl border bg-card p-5 space-y-4">
                {genProgress ? (
                  <>
                    {/* Status text — shows what's happening right now */}
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                      <span className="truncate">{genStatus || 'Generating gambar…'}</span>
                    </div>
                    {/* Progress bar */}
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                        style={{ width: `${genProgress.total > 0 ? Math.round(genProgress.completed / genProgress.total * 100) : 0}%` }}
                      />
                    </div>
                    {/* Count + percentage */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{genProgress.completed} / {genProgress.total} gambar selesai</span>
                      <span className="font-semibold tabular-nums">{genProgress.total > 0 ? Math.round(genProgress.completed / genProgress.total * 100) : 0}%</span>
                    </div>
                  </>
                ) : (
                  /* Pre-image phase — indeterminate bar + status text */
                  <>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                      <span>{genStatus || `Generating ${selectedAngles.length} angle…`}</span>
                    </div>
                    {/* Indeterminate animated bar */}
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full w-1/3 rounded-full bg-primary/70 animate-indeterminate" />
                    </div>
                    <p className="text-xs text-muted-foreground">Menyiapkan copy & prompt untuk semua angle…</p>
                  </>
                )}
              </div>

              {/* Skeleton cards */}
              <div className="grid gap-4 sm:grid-cols-2">
                {Array.from({ length: Math.min(selectedAngles.length || 4, 8) }).map((_, i) => (
                  <Card key={i}>
                    <Skeleton className="aspect-square w-full" />
                    <CardContent className="space-y-2 p-4">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-5/6" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-lg font-semibold">
                    {result.totalVariations} variasi siap
                    {(() => {
                      const totalImgs = result.variations.reduce((sum, v) => sum + (v.imageUrls?.length ?? (v.imageUrl ? 1 : 0)), 0)
                      return totalImgs > result.totalVariations ? (
                        <span className="ml-2 text-sm font-normal text-muted-foreground">· {totalImgs} gambar total</span>
                      ) : null
                    })()}
                  </h2>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {productVisualDescription && (
                    <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300">
                      ✓ Visual injected
                    </Badge>
                  )}
                  {(() => {
                    const allUrls = result.variations.flatMap((v) =>
                      v.imageUrls?.length ? v.imageUrls : (v.imageUrl ? [v.imageUrl] : [])
                    )
                    return allUrls.length > 0 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => downloadAllImages(result.variations, result.productName)}
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download All ({allUrls.length})
                      </Button>
                    ) : null
                  })()}
                  <p className="text-sm text-muted-foreground">{result.productName} · {result.aspectRatio}</p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {result.variations.map((v, i) => (
                  <AdCard
                    key={i}
                    index={i}
                    data={{
                      badge: v.angle,
                      headline: v.headline,
                      subheadline: v.subheadline,
                      bodyText: v.bodyText,
                      cta: v.cta,
                      imageUrl: v.imageUrl ?? null,
                      imageUrls: v.imageUrls ?? null,
                      imagePrompt: v.imagePrompt,
                      translatedConcept: v.translatedConcept ?? null,
                      error: v.imageError || v.promptError,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Carousel generating skeleton */}
          {generatingCarousel && (
            <Card>
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Generating carousel {carouselSlideCount} slide…</span>
                </div>
                <div className="flex gap-2">
                  {Array.from({ length: carouselSlideCount }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-16 rounded-md" />
                  ))}
                </div>
                <Skeleton className="h-48 w-full rounded-lg" />
              </CardContent>
            </Card>
          )}

          {/* Carousel result */}
          {carousel && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  <Presentation className="mr-1 inline h-5 w-5 text-primary" />
                  Carousel Preview ({carousel.totalSlides} slide)
                </h2>
                <p className="text-sm text-muted-foreground">{carousel.productName}</p>
              </div>
              <CarouselPreview slides={carousel.slides} productName={carousel.productName} />
            </div>
          )}

          {!analyzing && !analysisResp && !result && !error && (
            <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
              <Sparkles className="mx-auto mb-3 h-10 w-10 opacity-40" />
              <p>Upload iklan winning untuk mulai.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
