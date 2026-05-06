'use client'
import { useEffect, useRef, useState } from 'react'
import {
  Loader2, AlertCircle, Video, Scissors, Download,
  ChevronDown, ChevronUp, Sparkles, DollarSign,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Dropzone } from '@/components/ads/Dropzone'
import { getProducts, startVideoRemake, getRemakeStatus, type Product } from '@/lib/api'
import type { RemakeJobResponse } from '@/lib/types'

// ─── Status label helpers ─────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  analyzing: 'Menganalisis video sumber…',
  splitting: 'Memotong menjadi klip…',
  generating: 'Doubao sedang generate ulang klip (3-8 menit)…',
  merging: 'Menggabungkan klip final…',
  done: 'Selesai ✓',
  failed: 'Gagal',
}

const FORMATS = [
  { value: '9:16', label: '9:16', hint: 'Reels/Story' },
  { value: '1:1', label: '1:1', hint: 'Feed' },
  { value: '16:9', label: '16:9', hint: 'Landscape' },
] as const

const TARGET_OPTIONS = [
  { value: 15, label: '15 detik' },
  { value: 21, label: '21 detik (~$0.92)' },
  { value: 28, label: '28 detik' },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RemakePage() {
  const [file, setFile] = useState<File | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [aspectRatio, setAspectRatio] = useState('9:16')
  const [targetSeconds, setTargetSeconds] = useState(21)

  const [submitting, setSubmitting] = useState(false)
  const [job, setJob] = useState<RemakeJobResponse | null>(null)
  const [remakeId, setRemakeId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [showLog, setShowLog] = useState(false)
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    getProducts()
      .then((list) => {
        setProducts(list)
        if (list.length > 0) setSelectedProduct(list[0])
      })
      .catch(() => {})
  }, [])

  // Poll job status every 6s while running
  useEffect(() => {
    if (!remakeId || !job) return
    if (job.status === 'done' || job.status === 'failed') {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }

    pollRef.current = setInterval(async () => {
      try {
        const updated = await getRemakeStatus(remakeId)
        setJob(updated)
        if (updated.status === 'done' || updated.status === 'failed') {
          clearInterval(pollRef.current!)
        }
      } catch (e: any) {
        console.warn('Poll error:', e.message)
      }
    }, 6000)

    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [remakeId, job?.status])

  const handleSubmit = async () => {
    if (!file || !selectedProduct) return
    setError(null)
    setJob(null)
    setRemakeId(null)
    setSubmitting(true)

    try {
      const photoDataUrl = selectedProduct.photos?.[0]
      const photoMatch = photoDataUrl?.match(/^data:([^;]+);base64,(.+)$/)
      const productPhotoMime = photoMatch?.[1]
      const productPhotoBase64 = photoMatch?.[2]

      const resp = await startVideoRemake({
        file,
        productName: selectedProduct.name,
        productDescription: selectedProduct.description,
        productPhotoBase64,
        productPhotoMime,
        aspectRatio,
        targetSeconds,
        clipCount: 3,
      })

      setRemakeId(resp.remakeId)
      // Fetch initial state
      const initial = await getRemakeStatus(resp.remakeId)
      setJob(initial)
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || 'Gagal memulai remake')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDownload = async (url: string) => {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = `remake-${selectedProduct?.name || 'video'}-${Date.now()}.mp4`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(href)
    } catch {
      window.open(url, '_blank')
    }
  }

  const isRunning = job && job.status !== 'done' && job.status !== 'failed'
  const isDone = job?.status === 'done'
  const isFailed = job?.status === 'failed'

  const estimatedCost = `$${(targetSeconds * 0.044).toFixed(2)}`

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="mb-2 inline-flex items-center gap-2">
          <Scissors className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Video Remake</h1>
        </div>
        <p className="text-muted-foreground">
          Upload video iklan orang lain → AI potong scene terbaik → doubao-seedance-2.0 remake tiap klip dengan produkmu → gabungkan jadi video {targetSeconds} detik.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
        {/* ── Left: Settings ── */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">1. Upload Video Sumber</CardTitle>
              <CardDescription>Video iklan referensi. MP4/MOV/WEBM, maks 50MB.</CardDescription>
            </CardHeader>
            <CardContent>
              <Dropzone file={file} onChange={setFile} accept="video" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. Produk & Setting</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Product */}
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
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedProduct?.photos?.[0] && (
                    <p className="flex items-center gap-1 text-xs text-emerald-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                      Foto produk tersedia — visual description aktif
                    </p>
                  )}
                </div>
              )}

              {/* Format */}
              <div className="space-y-2">
                <Label>Format Output</Label>
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

              {/* Target duration */}
              <div className="space-y-2">
                <Label>Durasi Output</Label>
                <Select
                  value={String(targetSeconds)}
                  onValueChange={(v) => setTargetSeconds(parseInt(v))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TARGET_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Cost estimate */}
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <DollarSign className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                <div className="text-xs text-amber-800">
                  <span className="font-semibold">Estimasi biaya: {estimatedCost}</span>
                  <span className="ml-1 opacity-70">($0.044/detik · doubao-seedance-2.0 480P)</span>
                </div>
              </div>

              {/* Model info */}
              <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                <Video className="h-3.5 w-3.5 text-primary shrink-0" />
                <p className="text-xs text-primary font-medium">
                  3 klip × ~7s · doubao-seedance-2.0 base mode · FFmpeg concat
                </p>
              </div>

              <Button
                className="w-full"
                onClick={handleSubmit}
                disabled={!file || !selectedProduct || submitting || !!isRunning}
              >
                {submitting ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Mengirim…</>
                ) : isRunning ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Sedang proses…</>
                ) : (
                  <><Scissors className="h-4 w-4" /> Mulai Remake</>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* ── Right: Progress + Result ── */}
        <div className="space-y-6">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Progress card */}
          {job && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    {isRunning && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                    {isDone && <span className="text-emerald-600">✓</span>}
                    {isFailed && <AlertCircle className="h-4 w-4 text-destructive" />}
                    Status Remake
                  </CardTitle>
                  <Badge
                    variant={isDone ? 'default' : isFailed ? 'destructive' : 'secondary'}
                    className={isDone ? 'bg-emerald-100 text-emerald-800' : ''}
                  >
                    {STATUS_LABEL[job.status] || job.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <Progress value={job.progress} className="h-2" />
                  <p className="text-right text-xs text-muted-foreground">{job.progress}%</p>
                </div>

                {isFailed && job.error && (
                  <div className="rounded border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                    {job.error}
                  </div>
                )}

                {/* Log toggle */}
                <button
                  onClick={() => setShowLog((v) => !v)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {showLog ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {showLog ? 'Sembunyikan log' : `Lihat log (${job.log.length} entri)`}
                </button>

                {showLog && job.log.length > 0 && (
                  <div className="max-h-52 overflow-y-auto rounded bg-muted p-3 space-y-1">
                    {job.log.map((line, i) => (
                      <p key={i} className="text-[11px] text-muted-foreground leading-relaxed font-mono">
                        {line}
                      </p>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Final video result */}
          {isDone && job?.videoUrl && (
            <Card className="overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Video Remake Siap!
                </CardTitle>
                <CardDescription>
                  {selectedProduct?.name} · {aspectRatio} · {targetSeconds}s · doubao-seedance-2.0
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <video
                  src={job.videoUrl}
                  controls
                  loop
                  className="w-full rounded-lg"
                  style={{ maxHeight: '480px', display: 'block' }}
                />
                <Button className="w-full" onClick={() => handleDownload(job.videoUrl!)}>
                  <Download className="h-4 w-4" />
                  Download Video
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Empty state */}
          {!job && !error && (
            <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
              <Scissors className="mx-auto mb-3 h-10 w-10 opacity-40" />
              <p className="font-medium">Upload video referensi untuk mulai.</p>
              <p className="mt-1 text-sm">
                AI pilih scene terbaik → doubao remake tiap klip → merge jadi video baru.
              </p>
              <div className="mt-4 rounded-lg border border-muted bg-muted/30 p-3 text-xs text-left max-w-xs mx-auto space-y-1">
                <p className="font-medium text-foreground">Cara kerja:</p>
                <p>1. FFmpeg potong 3 scene kunci dari video sumbermu</p>
                <p>2. doubao-seedance-2.0 <code className="bg-muted rounded px-1">videoReferType: base</code> remake tiap klip dengan produkmu</p>
                <p>3. FFmpeg gabungkan → video final ~{targetSeconds}s</p>
                <p className="text-amber-700 font-medium pt-1">Estimasi: {estimatedCost} · 4-8 menit</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
