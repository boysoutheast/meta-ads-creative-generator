'use client'
import { useEffect, useRef, useState } from 'react'
import { Loader2, AlertCircle, Video, Sparkles, Play, Download, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
import {
  analyzeWinningVideo,
  generateScaleVideoJob,
  getScaleVideoStatus,
  getProducts,
  type Product,
} from '@/lib/api'
import type { VideoScene, ScaleVideoJobResponse } from '@/lib/types'

const fmt = (n?: number) =>
  n !== undefined ? 'Rp ' + n.toLocaleString('id-ID') : ''

const DURATIONS = [15, 30, 60] as const
const FORMATS = [
  { value: '9:16', label: '9:16 Reels / Story', hint: 'Portrait' },
  { value: '1:1', label: '1:1 Feed', hint: 'Square' },
] as const

const POLL_INTERVAL = 5000  // 5s
const POLL_TIMEOUT = 5 * 60 * 1000 // 5 minutes

export default function ScaleVideoPage() {
  // Step 1 — upload + analyze
  const [file, setFile] = useState<File | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [videoAnalysis, setVideoAnalysis] = useState<any>(null)

  // Step 2 — settings
  const [products, setProducts] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [duration, setDuration] = useState<number>(30)
  const [aspectRatio, setAspectRatio] = useState<string>('9:16')

  // Step 3 — generate + poll
  const [generating, setGenerating] = useState(false)
  const [jobResult, setJobResult] = useState<ScaleVideoJobResponse | null>(null)
  const [pollStatus, setPollStatus] = useState<string>('')
  const [pollProgress, setPollProgress] = useState<number | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [pollingDone, setPollingDone] = useState(false)
  const [pollError, setPollError] = useState<string | null>(null)

  const [error, setError] = useState<string | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollStartRef = useRef<number>(0)

  useEffect(() => {
    getProducts()
      .then((list) => {
        setProducts(list)
        if (list.length > 0) setSelectedProduct(list[0])
      })
      .catch(() => {})

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [])

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  const startPolling = (taskId: string) => {
    stopPolling()
    pollStartRef.current = Date.now()
    setPollStatus('processing')
    setPollError(null)
    setPollingDone(false)

    pollTimerRef.current = setInterval(async () => {
      // Timeout check
      if (Date.now() - pollStartRef.current > POLL_TIMEOUT) {
        stopPolling()
        setPollingDone(true)
        setPollError('Timeout: video generation took too long (>5 menit). Coba lagi.')
        return
      }

      try {
        const status = await getScaleVideoStatus(taskId)
        setPollStatus(status.status)
        if (status.progress !== null) setPollProgress(status.progress)

        if (status.status === 'completed' && status.videoUrl) {
          stopPolling()
          setVideoUrl(status.videoUrl)
          setPollingDone(true)
        } else if (status.status === 'failed') {
          stopPolling()
          setPollingDone(true)
          setPollError(status.error || 'Video generation failed')
        }
      } catch (e: any) {
        // Don't stop polling on transient errors
        console.warn('Poll error:', e.message)
      }
    }, POLL_INTERVAL)
  }

  const handleAnalyze = async () => {
    if (!file) return
    setError(null)
    setAnalyzing(true)
    setVideoAnalysis(null)
    try {
      const resp = await analyzeWinningVideo(file)
      setVideoAnalysis(resp.analysis)
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || 'Gagal menganalisis video')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleGenerate = async () => {
    if (!videoAnalysis || !selectedProduct) return
    setError(null)
    setGenerating(true)
    setJobResult(null)
    setVideoUrl(null)
    setPollingDone(false)
    setPollError(null)
    stopPolling()

    try {
      const productPhotoBase64 = selectedProduct.photos?.[0]
        ? selectedProduct.photos[0].split(',')[1] ?? undefined
        : undefined

      const resp = await generateScaleVideoJob({
        videoAnalysis,
        productName: selectedProduct.name,
        productDescription: selectedProduct.description,
        productPhotoBase64,
        aspectRatio,
        duration,
      })

      setJobResult(resp)

      if (resp.taskId) {
        startPolling(resp.taskId)
      } else {
        setPollingDone(true)
        setPollError('Video generation started but no task ID returned. Check apimart.ai dashboard.')
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || 'Gagal generate video')
    } finally {
      setGenerating(false)
    }
  }

  const handleRetryPoll = () => {
    if (jobResult?.taskId) {
      startPolling(jobResult.taskId)
    }
  }

  const progressPercent = pollProgress !== null ? Math.min(100, Math.round(pollProgress)) : null

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-2 inline-flex items-center gap-2">
          <Video className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Scale Winning Video</h1>
        </div>
        <p className="text-muted-foreground">
          Upload video iklan winning → AI analisis konsep → adaptasi ke produkmu → generate video baru.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        {/* Left panel */}
        <div className="space-y-6">
          {/* Step 1 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">1. Upload & Analyze Video</CardTitle>
              <CardDescription>MP4/MOV/WEBM, maks 50MB.</CardDescription>
            </CardHeader>
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
          </Card>

          {/* Step 2 */}
          {videoAnalysis && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">2. Pilih Produk & Setting</CardTitle>
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
                    {selectedProduct?.photos?.[0] && (
                      <p className="flex items-center gap-1 text-xs text-emerald-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                        Foto produk tersedia — visual injection aktif
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Durasi video</Label>
                  <div className="flex gap-2">
                    {DURATIONS.map((d) => (
                      <Button
                        key={d}
                        type="button"
                        size="sm"
                        variant={duration === d ? 'default' : 'outline'}
                        onClick={() => setDuration(d)}
                        className="flex-1"
                      >
                        {d}s
                      </Button>
                    ))}
                  </div>
                </div>

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

                <Button
                  className="w-full"
                  onClick={handleGenerate}
                  disabled={generating || !selectedProduct}
                >
                  {generating ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
                  ) : (
                    <><Video className="h-4 w-4" /> Generate Video</>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right panel */}
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
                  <div>
                    <span className="font-medium text-muted-foreground">Hook: </span>
                    {videoAnalysis.hookType}
                  </div>
                )}
                {videoAnalysis.overallStyle && (
                  <div>
                    <span className="font-medium text-muted-foreground">Style: </span>
                    {videoAnalysis.overallStyle}
                  </div>
                )}
                {videoAnalysis.emotionArc && (
                  <div>
                    <span className="font-medium text-muted-foreground">Emotion: </span>
                    {videoAnalysis.emotionArc}
                  </div>
                )}
                {videoAnalysis.pacing && (
                  <div>
                    <span className="font-medium text-muted-foreground">Pacing: </span>
                    {videoAnalysis.pacing}
                  </div>
                )}
                {videoAnalysis.colorPalette && videoAnalysis.colorPalette.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {videoAnalysis.colorPalette.map((c: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs">{c}</Badge>
                    ))}
                  </div>
                )}
                {videoAnalysis.scenes && videoAnalysis.scenes.length > 0 && (
                  <details className="rounded-md bg-muted/40 p-2">
                    <summary className="cursor-pointer font-medium text-muted-foreground text-xs">
                      {videoAnalysis.scenes.length} scene terdeteksi
                    </summary>
                    <ul className="mt-2 space-y-1.5">
                      {videoAnalysis.scenes.map((s: VideoScene, i: number) => (
                        <li key={i} className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">[{s.duration}]</span> {s.description}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </CardContent>
            </Card>
          )}

          {/* Generating state */}
          {generating && (
            <Card>
              <CardContent className="space-y-3 p-6">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  Membangun video script & prompt…
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
              </CardContent>
            </Card>
          )}

          {/* Job result + polling */}
          {jobResult && !generating && (
            <div className="space-y-4">
              {/* Polling status */}
              {!pollingDone && (
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        Generating video… ({pollStatus})
                      </div>
                      <p className="text-xs text-muted-foreground">Biasanya 2-5 menit</p>
                    </div>
                    {/* Progress bar */}
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: progressPercent !== null ? `${progressPercent}%` : '10%' }}
                      />
                    </div>
                    {progressPercent !== null && (
                      <p className="text-xs text-muted-foreground text-right">{progressPercent}%</p>
                    )}
                    {jobResult.taskId && (
                      <p className="text-xs text-muted-foreground">Task ID: {jobResult.taskId}</p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Poll error */}
              {pollError && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p>{pollError}</p>
                    {jobResult.taskId && (
                      <Button variant="outline" size="sm" className="mt-2" onClick={handleRetryPoll}>
                        <RefreshCw className="h-3.5 w-3.5" /> Retry polling
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Video player */}
              {videoUrl && (
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                        <Play className="h-4 w-4" /> Video siap!
                      </div>
                      <a href={videoUrl} download target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="outline">
                          <Download className="h-3.5 w-3.5" /> Download
                        </Button>
                      </a>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <video
                      src={videoUrl}
                      controls
                      className="w-full rounded-lg"
                      style={{ maxHeight: '480px' }}
                    />
                  </CardContent>
                </Card>
              )}

              {/* Video script */}
              {jobResult.videoScript && jobResult.videoScript.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Script yang Digunakan</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {jobResult.videoScript.map((scene, i) => (
                      <div key={i} className="rounded-md bg-muted/40 p-3 text-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs">Scene {scene.scene}</Badge>
                          <span className="text-xs text-muted-foreground">{scene.duration}</span>
                        </div>
                        <p className="text-muted-foreground">{scene.description}</p>
                        {scene.visualStyle && (
                          <p className="mt-0.5 text-xs text-muted-foreground/60">Style: {scene.visualStyle}</p>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Full video prompt */}
              {jobResult.videoPrompt && (
                <details className="rounded-lg border bg-muted/20 p-3 text-xs">
                  <summary className="cursor-pointer font-medium text-muted-foreground">Video generation prompt</summary>
                  <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{jobResult.videoPrompt}</p>
                </details>
              )}

              {/* Product visual description */}
              {jobResult.productVisualDescription && (
                <details className="rounded-lg border bg-emerald-50/50 p-3 text-xs border-emerald-200">
                  <summary className="cursor-pointer font-medium text-emerald-700">✓ Product visual description</summary>
                  <p className="mt-2 text-muted-foreground">{jobResult.productVisualDescription}</p>
                </details>
              )}
            </div>
          )}

          {/* Empty state */}
          {!analyzing && !videoAnalysis && !error && (
            <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
              <Video className="mx-auto mb-3 h-10 w-10 opacity-40" />
              <p className="font-medium">Upload video iklan winning untuk mulai.</p>
              <p className="mt-1 text-sm">AI akan analisis konsep, hook, dan style-nya.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
