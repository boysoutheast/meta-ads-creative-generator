'use client'

import { useState, useRef } from 'react'
import {
  Film,
  Sparkles,
  Download,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Clock,
  Play,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { generateReelsStream, type ReelsClip, type ReelsSSEEvent } from '@/lib/api'

// ─── constants ───────────────────────────────────────────────────────────────

const DURATION_OPTIONS = [
  { value: 30, label: '30 seconds (3 clips)' },
  { value: 60, label: '60 seconds (6 clips)' },
  { value: 90, label: '90 seconds (9 clips)' },
  { value: 120, label: '120 seconds (12 clips)' },
]

const MODE_OPTIONS = [
  { value: 'standard', label: 'Standard (default)' },
  { value: 'custom', label: 'Custom' },
]

// ─── types ───────────────────────────────────────────────────────────────────

type ClipState = {
  index: number
  status: 'waiting' | 'generating' | 'done' | 'error'
  pct: number
  clip?: ReelsClip
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function downloadVideo(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.target = '_blank'
  a.click()
}

// ─── component ───────────────────────────────────────────────────────────────

export default function ReelsPage() {
  const [prompt, setPrompt] = useState('')
  const [targetDuration, setTargetDuration] = useState(30)
  const [mode, setMode] = useState('standard')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clips, setClips] = useState<ClipState[]>([])
  const [totalClips, setTotalClips] = useState(0)
  const [isDone, setIsDone] = useState(false)

  const abortRef = useRef<AbortController | null>(null)

  function initClips(n: number) {
    setClips(
      Array.from({ length: n }, (_, i) => ({
        index: i,
        status: i === 0 ? 'generating' : 'waiting',
        pct: 0,
      }))
    )
  }

  function handleSSEEvent(evt: ReelsSSEEvent) {
    if (evt.type === 'start') {
      setTotalClips(evt.totalClips)
      initClips(evt.totalClips)
    }

    if (evt.type === 'clip_progress') {
      setClips((prev) =>
        prev.map((c) =>
          c.index === evt.clipIndex
            ? { ...c, status: 'generating', pct: evt.pct }
            : c
        )
      )
    }

    if (evt.type === 'clip_done') {
      setClips((prev) =>
        prev.map((c) => {
          if (c.index === evt.clipIndex) return { ...c, status: 'done', pct: 100, clip: evt.clip }
          if (c.index === evt.clipIndex + 1) return { ...c, status: 'generating' }
          return c
        })
      )
    }

    if (evt.type === 'done') {
      setIsDone(true)
    }

    if (evt.type === 'error') {
      setError(evt.message)
    }
  }

  async function handleGenerate() {
    if (!prompt.trim()) return

    setError(null)
    setIsDone(false)
    setClips([])
    setIsGenerating(true)

    try {
      await generateReelsStream(
        { prompt: prompt.trim(), targetDuration, mode: mode === 'standard' ? undefined : mode },
        handleSSEEvent
      )
    } catch (err: any) {
      setError(err.message || 'Generation failed')
    } finally {
      setIsGenerating(false)
    }
  }

  const doneClips = clips.filter((c) => c.status === 'done' && c.clip?.videoUrl)
  const currentClip = clips.find((c) => c.status === 'generating')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Film className="h-6 w-6 text-primary" />
          Create AI Reels
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate portrait video reels using Grok AI — clips are chained via Extend for visual consistency.
        </p>
      </div>

      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Video Settings</CardTitle>
          <CardDescription>
            Each reel is built from 10-second Grok clips extended together.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Prompt */}
          <div className="space-y-1.5">
            <Label htmlFor="prompt">Video Prompt</Label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A cinematic ad for a skincare serum — golden hour, slow-motion product reveal, luxury aesthetic..."
              rows={4}
              disabled={isGenerating}
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Generation Mode */}
            <div className="space-y-1.5">
              <Label>Generation Mode</Label>
              <Select value={mode} onValueChange={setMode} disabled={isGenerating}>
                <SelectTrigger>
                  <SelectValue placeholder="Select mode" />
                </SelectTrigger>
                <SelectContent>
                  {MODE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Target Duration */}
            <div className="space-y-1.5">
              <Label>Target Duration</Label>
              <Select
                value={String(targetDuration)}
                onValueChange={(v) => setTargetDuration(Number(v))}
                disabled={isGenerating}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Info badge */}
          <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Model:</span> Grok · 720p · Portrait ·{' '}
            {Math.ceil(targetDuration / 10)} clips × 10s = {targetDuration}s total
          </div>

          <Button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
            className="w-full"
            size="lg"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate Reel
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Progress tracker */}
      {clips.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Generation Progress</CardTitle>
              {isDone && (
                <Badge variant="outline" className="border-green-500 text-green-600">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Complete
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {clips.map((c) => (
              <div key={c.index} className="flex items-center gap-3">
                {/* Status icon */}
                <div className="w-5 shrink-0">
                  {c.status === 'done' && (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  )}
                  {c.status === 'generating' && (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  )}
                  {c.status === 'waiting' && (
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>

                {/* Label */}
                <span className="w-20 shrink-0 text-sm text-muted-foreground">
                  Clip {c.index + 1}/{totalClips}
                </span>

                {/* Progress bar */}
                <div className="flex-1 rounded-full bg-muted h-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      c.status === 'done'
                        ? 'bg-green-500'
                        : c.status === 'generating'
                        ? 'bg-primary'
                        : 'bg-muted'
                    }`}
                    style={{ width: `${c.pct}%` }}
                  />
                </div>

                <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">
                  {c.status === 'done' ? '100%' : c.status === 'generating' ? `${c.pct}%` : '—'}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Completed clips */}
      {doneClips.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Clips ({doneClips.length}/{totalClips})
            </h2>
            {isDone && doneClips.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  doneClips.forEach((c) => {
                    if (c.clip?.videoUrl) {
                      downloadVideo(c.clip.videoUrl, `reel-clip-${c.index + 1}.mp4`)
                    }
                  })
                }}
              >
                <Download className="mr-1.5 h-4 w-4" />
                Download All
              </Button>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {doneClips.map((c) => (
              <ClipCard key={c.index} clipState={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── ClipCard ────────────────────────────────────────────────────────────────

function ClipCard({ clipState }: { clipState: ClipState }) {
  const { index, clip } = clipState
  if (!clip) return null

  return (
    <Card className="overflow-hidden">
      {/* Thumbnail / video */}
      <div className="relative aspect-[9/16] bg-black">
        {clip.videoUrl ? (
          <video
            src={clip.videoUrl}
            poster={clip.thumbnailUrl || undefined}
            controls
            playsInline
            className="h-full w-full object-contain"
          />
        ) : clip.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={clip.thumbnailUrl}
            alt={`Clip ${index + 1}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Play className="h-10 w-10 text-white/30" />
          </div>
        )}

        {/* Clip number badge */}
        <div className="absolute left-2 top-2">
          <Badge className="text-xs">Clip {index + 1}</Badge>
        </div>
      </div>

      {/* Actions */}
      <CardContent className="p-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={!clip.videoUrl}
          onClick={() => clip.videoUrl && downloadVideo(clip.videoUrl, `reel-clip-${index + 1}.mp4`)}
        >
          <Download className="mr-1.5 h-4 w-4" />
          Download Clip {index + 1}
        </Button>
      </CardContent>
    </Card>
  )
}
