'use client'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2, Wand2, Sparkles, Download, Save, RotateCcw, AlertCircle, Image as ImageIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  createSingleImageJob,
  getSingleImageJob,
  saveToLibrary,
  type SingleImageJob,
} from '@/lib/api-auth'

const ANGLES = [
  { value: 'fomo',              label: 'FOMO / Urgency',     desc: 'Stok terbatas, scarcity',           emoji: '⏰', gradient: 'from-red-500 via-orange-500 to-amber-500' },
  { value: 'price_anchor',      label: 'Price Anchor',       desc: 'Bandingkan harga, ROI',              emoji: '💰', gradient: 'from-emerald-500 via-green-500 to-lime-500' },
  { value: 'social_proof',      label: 'Social Proof',       desc: 'Testimoni, review',                  emoji: '⭐', gradient: 'from-blue-500 via-cyan-500 to-teal-500' },
  { value: 'problem_agitation', label: 'Problem Agitation',  desc: 'Pain point dulu, solusi setelah',    emoji: '😤', gradient: 'from-rose-600 via-red-500 to-orange-500' },
  { value: 'transformation',    label: 'Transformation',     desc: 'Before / after',                     emoji: '✨', gradient: 'from-purple-500 via-fuchsia-500 to-pink-500' },
  { value: 'authority',         label: 'Authority',          desc: 'Endorsement ahli',                   emoji: '🎓', gradient: 'from-slate-700 via-zinc-600 to-stone-600' },
  { value: 'curiosity_gap',     label: 'Curiosity Gap',      desc: 'Hook bikin penasaran',               emoji: '🔍', gradient: 'from-violet-500 via-purple-500 to-indigo-500' },
  { value: 'risk_reversal',     label: 'Risk Reversal',      desc: 'Garansi, free trial',                emoji: '🛡️', gradient: 'from-teal-500 via-cyan-500 to-sky-500' },
]

const FORMATS = [
  { value: '1:1', label: 'Square 1:1', size: '1080×1080' },
  { value: '9:16', label: 'Story / Reels', size: '1080×1920' },
  { value: '4:5', label: 'Portrait 4:5', size: '1080×1350' },
  { value: '16:9', label: 'Landscape 16:9', size: '1920×1080' },
]

const Schema = z.object({
  angle: z.string().min(1, 'Pilih angle'),
  productName: z.string().min(1, 'Nama produk wajib').max(120),
  copy: z.string().min(1, 'Copy wajib').max(500),
  cta: z.string().min(1, 'CTA wajib').max(40),
  format: z.string(),
})
type FormValues = z.infer<typeof Schema>

const ETA_SECONDS = 45

export default function SingleImagePage() {
  const [job, setJob] = useState<SingleImageJob | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState(0)
  const startedAtRef = useRef<number>(0)
  const pollRef = useRef<any>(null)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: { angle: 'fomo', format: '1:1' },
  })

  const angle = watch('angle')
  const format = watch('format')

  // Polling: when job exists & not terminal, poll every 2s + animate progress
  useEffect(() => {
    if (!job || job.status === 'completed' || job.status === 'failed') {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    pollRef.current = setInterval(async () => {
      try {
        const fresh = await getSingleImageJob(job.id)
        setJob(fresh)
      } catch {}
    }, 2000)
    return () => pollRef.current && clearInterval(pollRef.current)
  }, [job?.id, job?.status])

  // Animate progress bar based on elapsed time vs ETA
  useEffect(() => {
    if (!job || job.status === 'completed' || job.status === 'failed') {
      setProgress(job?.status === 'completed' ? 100 : 0)
      return
    }
    const id = setInterval(() => {
      const elapsed = (Date.now() - startedAtRef.current) / 1000
      const pct = Math.min(95, Math.round((elapsed / ETA_SECONDS) * 100))
      setProgress(pct)
    }, 500)
    return () => clearInterval(id)
  }, [job?.status])

  const onSubmit = async (data: FormValues) => {
    setSubmitting(true)
    setProgress(0)
    setJob(null)
    startedAtRef.current = Date.now()
    try {
      const { jobId } = await createSingleImageJob(data)
      const initial = await getSingleImageJob(jobId)
      setJob(initial)
      toast.success('Generation started')
    } catch (e: any) {
      const msg = e?.response?.data?.error || 'Gagal memulai generation'
      const issues = e?.response?.data?.issues
      if (issues) {
        toast.error(`${msg}: ${Object.values(issues).flat().join(', ')}`)
      } else {
        toast.error(msg)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleSave = async () => {
    if (!job?.resultUrl) return
    setSaving(true)
    try {
      await saveToLibrary({
        jobId: job.id,
        type: 'single_image',
        angle: job.angle,
        title: `${job.inputPayload.productName} — ${job.angle}`,
        imageUrl: job.resultUrl,
        prompt: job.resultPrompt || undefined,
        copyHeadline: job.inputPayload.copy,
        copyCta: job.inputPayload.cta,
        metadata: { format: job.inputPayload.format, costUsd: job.costUsd },
      })
      toast.success('Disimpan ke library')
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Gagal menyimpan')
    } finally {
      setSaving(false)
    }
  }

  const handleDownload = async () => {
    if (!job?.resultUrl) return
    try {
      const res = await fetch(job.resultUrl, { mode: 'cors' })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${job.inputPayload.productName}-${job.angle}.png`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch {
      window.open(job.resultUrl, '_blank')
    }
  }

  const handleReset = () => {
    setJob(null)
    setProgress(0)
    reset({ angle: 'fomo', format: '1:1' })
  }

  const isProcessing = job?.status === 'pending' || job?.status === 'processing'
  const isDone = job?.status === 'completed'
  const isFailed = job?.status === 'failed'

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 inline-flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Single Image Generator</h1>
        </div>
        <p className="text-muted-foreground">Pilih angle, isi info produk, AI generate creative siap upload Meta Ads.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[480px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Setup</CardTitle>
            <CardDescription>Semua field wajib</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label>Angle</Label>
                <div className="grid grid-cols-2 gap-2">
                  {ANGLES.map((a) => (
                    <button
                      key={a.value}
                      type="button"
                      onClick={() => setValue('angle', a.value, { shouldValidate: true })}
                      className={`group flex w-full items-stretch gap-0 overflow-hidden rounded-lg border text-left transition-all ${
                        angle === a.value ? 'border-primary ring-2 ring-primary/30' : 'border-input hover:border-primary/50'
                      }`}
                    >
                      <div className={`flex w-10 shrink-0 items-center justify-center bg-gradient-to-br ${a.gradient}`}>
                        <span className="text-xl drop-shadow-md">{a.emoji}</span>
                      </div>
                      <div className="flex-1 px-2.5 py-2 bg-background">
                        <p className="text-sm font-medium leading-tight">{a.label}</p>
                        <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{a.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
                {errors.angle && <p className="text-xs text-destructive">{errors.angle.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="productName">Nama produk</Label>
                <Input id="productName" placeholder="Contoh: Glow Serum Vit C" {...register('productName')} />
                {errors.productName && <p className="text-xs text-destructive">{errors.productName.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="copy">Copy / headline</Label>
                <Textarea id="copy" rows={3} placeholder="Hook utama yang mau ditampilkan" {...register('copy')} />
                {errors.copy && <p className="text-xs text-destructive">{errors.copy.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="cta">CTA</Label>
                <Input id="cta" placeholder="Beli Sekarang" {...register('cta')} />
                {errors.cta && <p className="text-xs text-destructive">{errors.cta.message}</p>}
              </div>

              <div className="space-y-2">
                <Label>Format</Label>
                <Select value={format} onValueChange={(v) => setValue('format', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FORMATS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label} <span className="ml-2 text-xs text-muted-foreground">{f.size}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button type="submit" className="w-full" disabled={submitting || isProcessing}>
                {(submitting || isProcessing) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {submitting ? 'Memulai…' : isProcessing ? 'Generating…' : 'Generate'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {!job && (
            <div className="flex h-full min-h-[400px] flex-col items-center justify-center rounded-xl border border-dashed text-center">
              <Sparkles className="mb-3 h-10 w-10 text-muted-foreground" />
              <p className="font-medium">Hasil akan muncul di sini</p>
              <p className="text-sm text-muted-foreground">Estimasi 30–60 detik per gambar</p>
            </div>
          )}

          {isProcessing && (
            <Card>
              <CardContent className="space-y-4 p-6">
                <div className="flex items-center justify-between">
                  <Badge>{job.status}</Badge>
                  <p className="text-xs text-muted-foreground">ETA ~{ETA_SECONDS}s</p>
                </div>
                <Progress value={progress} />
                <p className="text-sm text-muted-foreground">
                  AI sedang generate creative untuk angle <b>{job.angle}</b>…
                </p>
                <div className="aspect-square w-full animate-pulse rounded-lg bg-muted" />
              </CardContent>
            </Card>
          )}

          {isFailed && (
            <Card>
              <CardContent className="space-y-3 p-6">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-5 w-5" />
                  <p className="font-medium">Generation failed</p>
                </div>
                <p className="text-sm text-muted-foreground">{job.errorMessage || 'Unknown error'}</p>
                <Button onClick={handleReset} variant="outline">
                  <RotateCcw className="h-4 w-4" /> Coba lagi
                </Button>
              </CardContent>
            </Card>
          )}

          {isDone && job.resultUrl && (
            <Card>
              <CardContent className="space-y-4 p-4">
                <div className="overflow-hidden rounded-lg bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={job.resultUrl} alt="Generated ad" className="w-full" />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="success">Completed</Badge>
                  <span>{(job.durationMs! / 1000).toFixed(1)}s · ${job.costUsd?.toFixed(3)}</span>
                </div>
                <details className="rounded border bg-muted/30 p-2 text-xs">
                  <summary className="cursor-pointer font-medium">Image prompt</summary>
                  <p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{job.resultPrompt}</p>
                </details>
                <div className="flex gap-2">
                  <Button onClick={handleDownload} className="flex-1">
                    <Download className="h-4 w-4" /> Download
                  </Button>
                  <Button onClick={handleSave} disabled={saving} variant="outline" className="flex-1">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save to library
                  </Button>
                </div>
                <Button onClick={handleReset} variant="ghost" size="sm" className="w-full">
                  <RotateCcw className="h-4 w-4" /> Generate baru
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
