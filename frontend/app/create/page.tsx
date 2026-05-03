'use client'
import { useState } from 'react'
import { Loader2, ChevronLeft, ChevronRight, Sparkles, Wand2, AlertCircle, Check } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
import { WizardSteps } from '@/components/ads/WizardSteps'
import { AnalysisCard } from '@/components/ads/AnalysisCard'
import { AdCard } from '@/components/ads/AdCard'
import { CarouselViewer } from '@/components/ads/CarouselViewer'
import {
  analyzeReference,
  generateCreateAd,
  generateCreateCarousel,
} from '@/lib/api'
import { saveHistoryEntry } from '@/lib/history'
import { ASPECT_RATIOS } from '@/lib/types'
import type {
  AspectRatio,
  Language,
  ProductInfo,
  ReferenceAnalysis,
  CreateGenerateResponse,
  CarouselResponse,
} from '@/lib/types'

const STEPS = [
  { label: 'Referensi' },
  { label: 'Info Produk' },
  { label: 'Format' },
  { label: 'Variasi' },
  { label: 'Generate' },
]

export default function CreatePage() {
  const [step, setStep] = useState(1)

  // Step 1
  const [file, setFile] = useState<File | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [refAnalysis, setRefAnalysis] = useState<ReferenceAnalysis | null>(null)

  // Step 2
  const [product, setProduct] = useState<ProductInfo>({
    productName: '',
    description: '',
    usp: '',
    targetAudience: '',
    adGoal: '',
    brandColors: '',
  })

  // Step 3
  const [outputType, setOutputType] = useState<'image' | 'video' | 'carousel'>('image')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [language, setLanguage] = useState<Language>('id')

  // Step 4
  const [variations, setVariations] = useState(3)
  const [slideCount, setSlideCount] = useState(5)
  const [generateImages, setGenerateImages] = useState(true)

  // Step 5
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CreateGenerateResponse | null>(null)
  const [carousel, setCarousel] = useState<CarouselResponse | null>(null)

  const canGoNext = (() => {
    if (step === 1) return !!refAnalysis
    if (step === 2) return product.productName.trim().length > 0
    return true
  })()

  const handleAnalyze = async () => {
    if (!file) return
    setError(null)
    setAnalyzing(true)
    try {
      const resp = await analyzeReference(file)
      setRefAnalysis(resp.analysis)
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || 'Gagal menganalisis referensi')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleGenerate = async () => {
    if (!refAnalysis) return
    setError(null)
    setGenerating(true)
    setResult(null)
    setCarousel(null)
    try {
      if (outputType === 'carousel') {
        const resp = await generateCreateCarousel({
          referenceAnalysis: refAnalysis,
          productInfo: product,
          slideCount,
          language,
          generateImages,
        })
        setCarousel(resp)
        const thumb = resp.slides.find((s) => s.imageUrl)?.imageUrl
        saveHistoryEntry({
          kind: 'carousel',
          productName: product.productName,
          thumbnailUrl: thumb || null,
          payload: resp,
        })
      } else {
        const resp = await generateCreateAd({
          referenceAnalysis: refAnalysis,
          productInfo: product,
          format: aspectRatio,
          outputType,
          language,
          variations,
          generateImages: outputType === 'image' && generateImages,
        })
        setResult(resp)
        const thumb = resp.results.find((r) => r.imageUrl)?.imageUrl
        saveHistoryEntry({
          kind: 'create',
          productName: product.productName,
          thumbnailUrl: thumb || null,
          payload: resp,
        })
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || 'Gagal generate')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-2 inline-flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Create with Reference</h1>
        </div>
        <p className="text-muted-foreground">
          Upload referensi iklan + isi info produk. AI akan blend style referensi dengan produkmu.
        </p>
      </div>

      <Card>
        <CardContent className="p-6">
          <WizardSteps steps={STEPS} current={step} />
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {step === 1 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Upload referensi iklan</CardTitle>
              <CardDescription>Image atau video, jadiin acuan style.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Dropzone file={file} onChange={(f) => { setFile(f); setRefAnalysis(null) }} accept="both" />
              <Button className="w-full" onClick={handleAnalyze} disabled={!file || analyzing}>
                {analyzing ? <><Loader2 className="h-4 w-4 animate-spin" />Menganalisis…</> : <><Sparkles className="h-4 w-4" />Analyze referensi</>}
              </Button>
            </CardContent>
          </Card>
          <div>
            {analyzing && (
              <Card><CardContent className="space-y-2 p-6">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </CardContent></Card>
            )}
            {refAnalysis && <AnalysisCard analysis={refAnalysis as any} />}
          </div>
        </div>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Info produk</CardTitle>
            <CardDescription>Semakin lengkap, hasil makin relevan.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field label="Nama produk *" required>
              <Input
                value={product.productName}
                onChange={(e) => setProduct({ ...product, productName: e.target.value })}
                placeholder="Contoh: Glow Serum Vitamin C"
              />
            </Field>
            <Field label="Tujuan iklan">
              <Input
                value={product.adGoal || ''}
                onChange={(e) => setProduct({ ...product, adGoal: e.target.value })}
                placeholder="Contoh: Conversion / brand awareness"
              />
            </Field>
            <Field label="Deskripsi produk" className="md:col-span-2">
              <Textarea
                rows={3}
                value={product.description || ''}
                onChange={(e) => setProduct({ ...product, description: e.target.value })}
                placeholder="Apa produknya & manfaat utamanya?"
              />
            </Field>
            <Field label="USP / keunggulan" className="md:col-span-2">
              <Textarea
                rows={2}
                value={product.usp || ''}
                onChange={(e) => setProduct({ ...product, usp: e.target.value })}
                placeholder="3 keunggulan utama dibanding kompetitor"
              />
            </Field>
            <Field label="Target audience">
              <Input
                value={product.targetAudience || ''}
                onChange={(e) => setProduct({ ...product, targetAudience: e.target.value })}
                placeholder="Contoh: Wanita 25-35, urban, suka skincare"
              />
            </Field>
            <Field label="Brand colors">
              <Input
                value={product.brandColors || ''}
                onChange={(e) => setProduct({ ...product, brandColors: e.target.value })}
                placeholder="Contoh: pink pastel, cream, gold"
              />
            </Field>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Format output</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>Tipe</Label>
              <div className="grid grid-cols-3 gap-2">
                {(['image', 'video', 'carousel'] as const).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    variant={outputType === t ? 'default' : 'outline'}
                    onClick={() => setOutputType(t)}
                  >
                    {t === 'image' && 'Single Image'}
                    {t === 'video' && 'Video'}
                    {t === 'carousel' && 'Carousel'}
                  </Button>
                ))}
              </div>
            </div>

            {outputType !== 'carousel' && (
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
            )}

            <div className="space-y-2">
              <Label>Bahasa copy</Label>
              <Select value={language} onValueChange={(v) => setLanguage(v as Language)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="id">Indonesia</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="bilingual">Bilingual (ID + EN)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Variasi & generate</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {outputType === 'carousel' ? (
              <div className="space-y-2">
                <Label>Jumlah slide ({slideCount})</Label>
                <input
                  type="range"
                  min={3}
                  max={10}
                  value={slideCount}
                  onChange={(e) => setSlideCount(parseInt(e.target.value))}
                  className="w-full accent-primary"
                />
                <p className="text-xs text-muted-foreground">3–10 slide. Default 5.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Jumlah variasi</Label>
                <div className="flex gap-2">
                  {[1, 3, 5].map((n) => (
                    <Button
                      key={n}
                      type="button"
                      variant={variations === n ? 'default' : 'outline'}
                      onClick={() => setVariations(n)}
                      className="flex-1"
                    >
                      {n}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {(outputType === 'image' || outputType === 'carousel') && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label>Generate gambar AI</Label>
                  <p className="text-xs text-muted-foreground">Kalau OFF, hanya copy + prompt.</p>
                </div>
                <Switch checked={generateImages} onCheckedChange={setGenerateImages} />
              </div>
            )}

            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Ringkasan</p>
              <ul className="space-y-1 text-sm">
                <li><Check className="mr-1 inline h-3.5 w-3.5 text-primary" />Produk: <b>{product.productName}</b></li>
                <li><Check className="mr-1 inline h-3.5 w-3.5 text-primary" />Output: <b>{outputType}</b></li>
                {outputType !== 'carousel' && <li><Check className="mr-1 inline h-3.5 w-3.5 text-primary" />Aspect: <b>{aspectRatio}</b></li>}
                <li><Check className="mr-1 inline h-3.5 w-3.5 text-primary" />Bahasa: <b>{language}</b></li>
                <li><Check className="mr-1 inline h-3.5 w-3.5 text-primary" />{outputType === 'carousel' ? `${slideCount} slide` : `${variations} variasi`}</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 5 && (
        <div className="space-y-6">
          {!result && !carousel && !generating && (
            <Card>
              <CardContent className="space-y-4 p-6 text-center">
                <Sparkles className="mx-auto h-10 w-10 text-primary" />
                <h2 className="text-lg font-semibold">Siap generate!</h2>
                <p className="text-sm text-muted-foreground">
                  Klik tombol di bawah. Proses bisa memakan waktu 30-90 detik.
                </p>
                <Button size="lg" onClick={handleGenerate}>
                  <Wand2 className="h-4 w-4" /> Generate sekarang
                </Button>
              </CardContent>
            </Card>
          )}

          {generating && (
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i}>
                  <Skeleton className="aspect-square w-full" />
                  <CardContent className="space-y-2 p-4">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {result && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{result.totalVariations} variasi siap</h2>
                <Badge variant="outline">{result.format} · {result.outputType}</Badge>
              </div>
              <details className="rounded-lg border bg-muted/30 p-3 text-sm">
                <summary className="cursor-pointer font-medium">Blended context</summary>
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{result.blendedContext}</p>
              </details>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {result.results.map((r, i) => {
                  const c = typeof r.copy === 'string' ? null : r.copy
                  return (
                    <AdCard
                      key={i}
                      index={i}
                      data={{
                        badge: `Variasi ${r.variationIndex}`,
                        headline: c?.headline,
                        subheadline: c?.subtext,
                        cta: c?.cta || null,
                        imageUrl: r.imageUrl,
                        videoJobId: r.videoJobId,
                        imagePrompt: r.imagePrompt,
                        error: r.error,
                      }}
                    />
                  )
                })}
              </div>
            </div>
          )}

          {carousel && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{carousel.totalSlides}-slide carousel siap</h2>
                <Badge variant="outline">{carousel.productName}</Badge>
              </div>
              <div className="mx-auto max-w-md">
                <CarouselViewer slides={carousel.slides} productName={carousel.productName} />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1 || generating}
        >
          <ChevronLeft className="h-4 w-4" /> Kembali
        </Button>
        <p className="text-sm text-muted-foreground">Step {step} / {STEPS.length}</p>
        {step < STEPS.length ? (
          <Button onClick={() => setStep((s) => Math.min(STEPS.length, s + 1))} disabled={!canGoNext}>
            Lanjut <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={() => { setResult(null); setCarousel(null); setStep(1); setFile(null); setRefAnalysis(null) }} variant="outline">
            Mulai baru
          </Button>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`space-y-2 ${className || ''}`}>
      <Label>{label}{required && <span className="text-destructive"> *</span>}</Label>
      {children}
    </div>
  )
}
