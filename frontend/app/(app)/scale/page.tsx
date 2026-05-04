'use client'
import { useEffect, useState } from 'react'
import { Loader2, Sparkles, AlertCircle, Layers } from 'lucide-react'
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
import { Dropzone } from '@/components/ads/Dropzone'
import { AngleSelector } from '@/components/ads/AngleSelector'
import { AnalysisCard } from '@/components/ads/AnalysisCard'
import { AdCard } from '@/components/ads/AdCard'
import {
  analyzeWinningAd,
  generateScalingVariations,
  generateScaleVideo,
  getProducts,
  type Product,
} from '@/lib/api'
import { saveHistoryEntry } from '@/lib/history'
import { ASPECT_RATIOS } from '@/lib/types'
import type {
  AnalyzeWinningResponse,
  GenerateVariationsResponse,
  AspectRatio,
  ScalingAngle,
  AngleVariation,
} from '@/lib/types'

const fmt = (n?: number) =>
  n !== undefined ? 'Rp ' + n.toLocaleString('id-ID') : ''

export default function ScalePage() {
  const [file, setFile] = useState<File | null>(null)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [generateImages, setGenerateImages] = useState(true)
  const [outputType, setOutputType] = useState<'image' | 'video'>('image')

  const [analyzing, setAnalyzing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [analysisResp, setAnalysisResp] = useState<AnalyzeWinningResponse | null>(null)
  const [selectedAngles, setSelectedAngles] = useState<string[]>([])
  const [result, setResult] = useState<GenerateVariationsResponse | null>(null)

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

  const isVideo = file?.type.startsWith('video/') ?? false

  const handleAnalyze = async () => {
    if (!file) return
    setError(null)
    setAnalyzing(true)
    setResult(null)
    setAnalysisResp(null)
    try {
      const resp = await analyzeWinningAd(file)
      setAnalysisResp(resp)
      setSelectedAngles(resp.availableAngles.map((a) => a.key))
      if (isVideo) setOutputType('video')
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
    try {
      const resp = await generateScalingVariations({
        analysis: analysisResp.analysis,
        productName: selectedProduct.name,
        selectedAngles,
        aspectRatio,
        generateImages: outputType === 'image' && generateImages,
      })

      if (outputType === 'video') {
        const videoResults = await Promise.allSettled(
          resp.variations.map(async (v) => {
            if (!v.imagePrompt) return v
            try {
              const job = await generateScaleVideo(v.imagePrompt, aspectRatio, 5)
              return { ...v, videoJobId: job.id || job.taskId || null }
            } catch (err: any) {
              return { ...v, videoError: err.message } as AngleVariation & { videoError?: string }
            }
          })
        )
        resp.variations = videoResults.map((r, i) =>
          r.status === 'fulfilled' ? (r.value as AngleVariation) : resp.variations[i]
        )
      }

      setResult(resp)

      const firstImg = resp.variations.find((v) => v.imageUrl)?.imageUrl
      saveHistoryEntry({
        kind: 'scale',
        productName: selectedProduct.name,
        thumbnailUrl: firstImg || null,
        payload: { ...resp, outputType, aspectRatio },
      })
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || 'Gagal generate variasi')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-2 inline-flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Scale Konten Winning</h1>
        </div>
        <p className="text-muted-foreground">
          Upload iklan winning, AI analisis pola-nya, lalu generate variasi baru dengan angle berbeda.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <div className="space-y-6">
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

          {analysisResp && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">2. Setting & angle</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
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
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Output type</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={outputType === 'image' ? 'default' : 'outline'}
                      onClick={() => setOutputType('image')}
                      className="flex-1"
                    >Image</Button>
                    <Button
                      type="button"
                      variant={outputType === 'video' ? 'default' : 'outline'}
                      onClick={() => setOutputType('video')}
                      className="flex-1"
                    >Video</Button>
                  </div>
                </div>

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

                {outputType === 'image' && (
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <Label htmlFor="genImg">Generate gambar AI</Label>
                      <p className="text-xs text-muted-foreground">Kalau OFF, hanya menghasilkan copy + prompt.</p>
                    </div>
                    <Switch id="genImg" checked={generateImages} onCheckedChange={setGenerateImages} />
                  </div>
                )}

                <div>
                  <Label className="mb-2 block">Pilih angle</Label>
                  <AngleSelector
                    angles={analysisResp.availableAngles as ScalingAngle[]}
                    selected={selectedAngles}
                    onChange={setSelectedAngles}
                  />
                </div>

                <Button
                  className="w-full"
                  onClick={handleGenerate}
                  disabled={generating || !selectedProduct || selectedAngles.length === 0}
                >
                  {generating ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
                  ) : (
                    <>Generate {selectedAngles.length} variasi</>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

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
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
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
          )}

          {result && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{result.totalVariations} variasi siap</h2>
                <p className="text-sm text-muted-foreground">{result.productName} · {result.aspectRatio}</p>
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
                      videoJobId: (v as any).videoJobId ?? null,
                      imagePrompt: v.imagePrompt,
                      error: v.imageError || v.promptError,
                    }}
                  />
                ))}
              </div>
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
