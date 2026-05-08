'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Film, Sparkles, Download, AlertCircle, Loader2, CheckCircle2,
  Clock, Play, RefreshCw, ChevronDown, ChevronRight, Info,
  RotateCcw, Wand2, Merge, FileVideo,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  buildStoryboard, refreshClips, startReelGeneration,
  getReelSession, type PublicClip, type ReelsSSEEvent,
} from '@/lib/api'

// ─── constants ───────────────────────────────────────────────────────────────

const DURATION_OPTIONS = [
  10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
].map(v => ({ value: v, label: `${v}s (${v / 10} clip${v / 10 > 1 ? 's' : ''})` }))

const MODE_OPTIONS = [
  { value: 'normal', label: 'Normal', desc: 'Cinematic, clean, premium' },
  { value: 'extremely-crazy', label: 'Extremely Crazy', desc: 'Wild camera moves, surreal elements' },
  { value: 'extremely-spicy-or-crazy', label: 'Extremely Spicy or Crazy', desc: 'Maximum chaos, bold creativity' },
  { value: 'custom', label: 'Custom', desc: 'Balanced creative freedom' },
]

const SESSION_KEY = 'reels_session_id'

// ─── types ───────────────────────────────────────────────────────────────────

type Step = 'input' | 'storyboard' | 'result'

type ClipGenState = {
  index: number
  status: 'waiting' | 'generating' | 'retrying' | 'done' | 'error'
  pct: number
  videoUrl?: string | null
  thumbnailUrl?: string | null
  uuid?: string
}

type MergePhase = 'idle' | 'downloading' | 'merging' | 'done'

type ResumeInfo = {
  sessionId: string
  status: string
  prompt: string
  storyboard: PublicClip[]
  clips: any[]
  downloadReady: boolean
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function saveSessionId(id: string) {
  try { localStorage.setItem(SESSION_KEY, id) } catch (e) {}
}
function loadSessionId(): string | null {
  try { return localStorage.getItem(SESSION_KEY) } catch (e) { return null }
}
function clearSessionId() {
  try { localStorage.removeItem(SESSION_KEY) } catch (e) {}
}

// ─── root component ───────────────────────────────────────────────────────────

export default function ReelsPage() {
  const [step, setStep] = useState<Step>('input')

  // input
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState(30)
  const [mode, setMode] = useState('normal')
  const [building, setBuilding] = useState(false)

  // storyboard
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [storyboard, setStoryboard] = useState<PublicClip[]>([])
  const [refreshingFrom, setRefreshingFrom] = useState<number | null>(null)
  const [hints, setHints] = useState<Record<number, string>>({})

  // result / generation
  const [genClips, setGenClips] = useState<ClipGenState[]>([])
  const [totalClips, setTotalClips] = useState(0)
  const [mergePhase, setMergePhase] = useState<MergePhase>('idle')
  const [mergeProgress, setMergeProgress] = useState(0)
  const [downloadReady, setDownloadReady] = useState(false)
  const [mergedHash, setMergedHash] = useState<string | null>(null)
  const [sizeBytes, setSizeBytes] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)

  // resume
  const [resumeInfo, setResumeInfo] = useState<ResumeInfo | null>(null)

  // error
  const [error, setError] = useState<string | null>(null)
  const [resumable, setResumable] = useState(false)

  // check for existing session on mount
  useEffect(() => {
    const id = loadSessionId()
    if (!id) return
    getReelSession(id)
      .then((s) => {
        if (s && s.status !== 'error' && !s.downloadedAt) {
          setResumeInfo(s as ResumeInfo)
        } else {
          clearSessionId()
        }
      })
      .catch(() => clearSessionId())
  }, [])

  // ── Step 1: build storyboard ───────────────────────────────────────────────

  async function handleBuildStoryboard() {
    if (!prompt.trim()) return
    setBuilding(true)
    setError(null)
    try {
      const data = await buildStoryboard({ prompt: prompt.trim(), mode, duration })
      setSessionId(data.sessionId)
      setStoryboard(data.storyboard)
      saveSessionId(data.sessionId)
      setHints({})
      setStep('storyboard')
    } catch (err: any) {
      setError(err.message || 'Failed to build storyboard')
    } finally {
      setBuilding(false)
    }
  }

  // ── Step 2: refresh clips ──────────────────────────────────────────────────

  async function handleRefresh(fromIndex: number) {
    if (!sessionId) return
    setRefreshingFrom(fromIndex)
    setError(null)
    try {
      const data = await refreshClips({
        sessionId,
        fromIndex,
        hint: hints[fromIndex] || undefined,
      })
      setStoryboard(data.storyboard)
      setHints(prev => {
        const next = { ...prev }
        data.storyboard.forEach((_, i) => { if (i >= fromIndex) delete next[i] })
        return next
      })
    } catch (err: any) {
      setError(err.message || 'Refresh failed')
    } finally {
      setRefreshingFrom(null)
    }
  }

  // ── Step 2 → 3: start generation ──────────────────────────────────────────

  async function handleGenerate() {
    if (!sessionId) return
    setError(null)
    setResumable(false)
    setMergePhase('idle')
    setDownloadReady(false)
    setMergedHash(null)
    setSizeBytes(null)
    setGenerating(true)
    setStep('result')

    const n = storyboard.length
    setTotalClips(n)
    setGenClips(Array.from({ length: n }, (_, i) => ({
      index: i, status: i === 0 ? 'generating' : 'waiting', pct: 0,
    })))

    try {
      await startReelGeneration(sessionId, (evt: ReelsSSEEvent) => {
        handleSSE(evt, n)
      })
    } catch (err: any) {
      setError(err.message || 'Generation failed')
      setGenerating(false)
    }
  }

  const handleSSE = useCallback((evt: ReelsSSEEvent, n: number) => {
    switch (evt.type) {
      case 'start':
        setTotalClips(evt.totalClips)
        break

      case 'clip_skip':
        setGenClips(prev => prev.map(c =>
          c.index === evt.clipIndex ? { ...c, status: 'done', pct: 100 } : c
        ))
        break

      case 'clip_start':
        setGenClips(prev => prev.map(c =>
          c.index === evt.clipIndex ? { ...c, status: 'generating', pct: 0 } : c
        ))
        break

      case 'clip_progress':
        setGenClips(prev => prev.map(c =>
          c.index === evt.clipIndex ? { ...c, status: 'generating', pct: evt.pct } : c
        ))
        break

      case 'clip_retry':
        setGenClips(prev => prev.map(c =>
          c.index === evt.clipIndex ? { ...c, status: 'retrying', pct: 0 } : c
        ))
        break

      case 'clip_done':
        setGenClips(prev => prev.map(c => {
          if (c.index === evt.clipIndex)
            return { ...c, status: 'done', pct: 100, videoUrl: evt.clip.videoUrl, thumbnailUrl: evt.clip.thumbnailUrl, uuid: evt.clip.uuid }
          if (c.index === evt.clipIndex + 1)
            return { ...c, status: 'generating' }
          return c
        }))
        break

      case 'merge_start':
        setMergePhase('downloading')
        break

      case 'merge_progress':
        if (evt.phase === 'downloading') setMergePhase('downloading')
        if (evt.phase === 'merging') {
          setMergePhase('merging')
          setMergeProgress(evt.progress || 0)
        }
        break

      case 'ready':
        setMergePhase('done')
        setDownloadReady(true)
        setMergedHash(evt.mergedHash || null)
        setSizeBytes(evt.sizeBytes || null)
        setGenerating(false)
        clearSessionId() // session complete — clear resume hint
        break

      case 'error':
        setError(evt.message)
        setResumable(evt.resumable || false)
        setGenerating(false)
        break
    }
  }, [])

  // ── resume ────────────────────────────────────────────────────────────────

  function handleResumeAccept() {
    if (!resumeInfo) return
    setSessionId(resumeInfo.sessionId)
    setPrompt(resumeInfo.prompt)
    setStoryboard(resumeInfo.storyboard)
    setResumeInfo(null)

    if (resumeInfo.status === 'done' || resumeInfo.downloadReady) {
      setTotalClips(resumeInfo.storyboard.length)
      setDownloadReady(true)
      setStep('result')
    } else if (resumeInfo.status === 'generating' || resumeInfo.status === 'partial') {
      // Re-trigger generation from where it stopped
      const n = resumeInfo.storyboard.length
      setTotalClips(n)
      setGenClips(resumeInfo.clips.map((c: any) => ({
        index: c.index,
        status: c.status === 'done' ? 'done' : 'waiting',
        pct: c.status === 'done' ? 100 : 0,
        videoUrl: c.videoUrl,
        thumbnailUrl: c.thumbnailUrl,
        uuid: c.uuid,
      })).concat(
        Array.from({ length: n - resumeInfo.clips.length }, (_, i) => ({
          index: resumeInfo.clips.length + i, status: 'waiting' as const, pct: 0,
        }))
      ))
      setStep('result')
      // Auto-resume generation
      setTimeout(() => handleResumeGeneration(resumeInfo.sessionId, n), 500)
    } else {
      setStep('storyboard')
    }
  }

  async function handleResumeGeneration(sid: string, n: number) {
    setError(null)
    setResumable(false)
    setGenerating(true)
    try {
      await startReelGeneration(sid, (evt) => handleSSE(evt, n))
    } catch (err: any) {
      setError(err.message || 'Resume failed')
      setGenerating(false)
    }
  }

  // ── download ──────────────────────────────────────────────────────────────

  function handleDownload() {
    if (!sessionId) return
    window.open(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/reels/download/${sessionId}`, '_blank')
  }

  const doneClips = genClips.filter(c => c.status === 'done' && c.videoUrl)

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Film className="h-6 w-6 text-primary" />
          Create AI Reels
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Simple prompt → AI storyboard → Grok video generation → merged final reel
        </p>
      </div>

      {/* Step indicator */}
      <StepIndicator step={step} />

      {/* Resume banner */}
      {resumeInfo && step === 'input' && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-amber-800 dark:text-amber-300">Unfinished session found</p>
            <p className="mt-0.5 text-amber-700 dark:text-amber-400">
              "{resumeInfo.prompt.slice(0, 80)}{resumeInfo.prompt.length > 80 ? '…' : ''}"
              {' '}— Status: <span className="font-medium">{resumeInfo.status}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { setResumeInfo(null); clearSessionId() }}>
              Discard
            </Button>
            <Button size="sm" onClick={handleResumeAccept}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Resume
            </Button>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p>{error}</p>
            {resumable && (
              <p className="mt-1 text-xs opacity-80">
                Session saved — click <strong>Resume</strong> on next page load to continue from where it stopped.
              </p>
            )}
          </div>
          <button onClick={() => setError(null)} className="shrink-0 text-destructive/60 hover:text-destructive">✕</button>
        </div>
      )}

      {/* ── STEP 1: Input ─────────────────────────────────────────────────── */}
      {step === 'input' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Video Brief</CardTitle>
            <CardDescription>
              Describe your ad in plain language — AI will build the full storyboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="prompt">What's this reel about?</Label>
              <textarea
                id="prompt"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="Luxury skincare serum for women 25-35. Golden hour aesthetic. Show texture, application, glowing result. Premium brand feel."
                rows={4}
                disabled={building}
                className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Generation Mode</Label>
                <Select value={mode} onValueChange={setMode} disabled={building}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODE_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>
                        <div>
                          <div className="font-medium">{o.label}</div>
                          <div className="text-xs text-muted-foreground">{o.desc}</div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Total Duration</Label>
                <Select value={String(duration)} onValueChange={v => setDuration(Number(v))} disabled={building}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DURATION_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              AI will generate {Math.ceil(duration / 10)} clips × 10s · Grok 720p Portrait · Mode: {mode}
            </div>

            <Button
              onClick={handleBuildStoryboard}
              disabled={building || !prompt.trim()}
              className="w-full"
              size="lg"
            >
              {building ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Building storyboard…</>
              ) : (
                <><Wand2 className="mr-2 h-4 w-4" />Build Storyboard</>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 2: Storyboard Review ──────────────────────────────────────── */}
      {step === 'storyboard' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Storyboard Review</h2>
              <p className="text-sm text-muted-foreground">
                Review each clip. Refresh from any clip to regenerate it and everything below.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setStep('input'); setError(null) }}>
              ← Edit Brief
            </Button>
          </div>

          {/* Prompt summary */}
          <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Brief:</span> {prompt.slice(0, 120)}{prompt.length > 120 ? '…' : ''}
            {' · '}<span className="font-medium text-foreground">Mode:</span> {mode}
            {' · '}<span className="font-medium text-foreground">{storyboard.length} clips · {storyboard.length * 10}s</span>
          </div>

          {/* Clip cards */}
          <div className="space-y-3">
            {storyboard.map((clip, idx) => (
              <StoryboardClipCard
                key={clip.clipNumber}
                clip={clip}
                idx={idx}
                totalClips={storyboard.length}
                hint={hints[idx] || ''}
                onHintChange={v => setHints(prev => ({ ...prev, [idx]: v }))}
                onRefresh={() => handleRefresh(idx)}
                isRefreshing={refreshingFrom !== null && refreshingFrom <= idx}
                isStale={refreshingFrom !== null && refreshingFrom <= idx}
              />
            ))}
          </div>

          <Button
            onClick={handleGenerate}
            disabled={storyboard.length === 0 || refreshingFrom !== null}
            className="w-full"
            size="lg"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Generate Reel ({storyboard.length} clips · {storyboard.length * 10}s)
          </Button>
        </div>
      )}

      {/* ── STEP 3: Video Result ───────────────────────────────────────────── */}
      {step === 'result' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Video Result</h2>
              <p className="text-sm text-muted-foreground">
                {generating ? 'Generating your reel — this runs in the background.' : downloadReady ? 'Your reel is ready!' : 'Processing…'}
              </p>
            </div>
            {!generating && (
              <Button variant="ghost" size="sm" onClick={() => setStep('storyboard')}>
                ← Storyboard
              </Button>
            )}
          </div>

          {/* Generation progress */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Progress</CardTitle>
                {downloadReady && (
                  <Badge variant="outline" className="border-green-500 text-green-600">
                    <CheckCircle2 className="mr-1 h-3 w-3" />Complete
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* Clip rows */}
              {genClips.map(c => (
                <ProgressRow
                  key={c.index}
                  label={`Clip ${c.index + 1}/${totalClips}`}
                  status={c.status}
                  pct={c.pct}
                />
              ))}

              {/* Merge rows */}
              {mergePhase !== 'idle' && (
                <>
                  <div className="mt-1 border-t pt-2" />
                  <ProgressRow
                    label="Downloading clips"
                    status={mergePhase === 'downloading' ? 'generating' : mergePhase === 'idle' ? 'waiting' : 'done'}
                    pct={mergePhase === 'merging' || mergePhase === 'done' ? 100 : 50}
                  />
                  <ProgressRow
                    label="Merging to final video"
                    status={mergePhase === 'merging' ? 'generating' : mergePhase === 'done' ? 'done' : 'waiting'}
                    pct={mergePhase === 'merging' ? mergeProgress : mergePhase === 'done' ? 100 : 0}
                  />
                  <ProgressRow
                    label="Download ready"
                    status={downloadReady ? 'done' : 'waiting'}
                    pct={downloadReady ? 100 : 0}
                  />
                </>
              )}
            </CardContent>
          </Card>

          {/* Download section */}
          {downloadReady && (
            <Card className="border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20">
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div>
                  <p className="font-semibold text-green-800 dark:text-green-300">Final reel ready</p>
                  {sizeBytes && (
                    <p className="text-xs text-green-600 dark:text-green-500">
                      {(sizeBytes / (1024 * 1024)).toFixed(1)} MB
                      {mergedHash && <> · SHA256: {mergedHash.slice(0, 16)}…</>}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-green-600 dark:text-green-500">
                    Individual clip files will be deleted after download.
                  </p>
                </div>
                <Button onClick={handleDownload} size="lg" className="bg-green-600 hover:bg-green-700">
                  <Download className="mr-2 h-4 w-4" />
                  Download Reel
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Individual clip previews */}
          {doneClips.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                Individual Clips ({doneClips.length}/{totalClips})
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {doneClips.map(c => (
                  <ClipPreviewCard key={c.index} clip={c} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── StepIndicator ────────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'input', label: 'Brief' },
    { key: 'storyboard', label: 'Storyboard' },
    { key: 'result', label: 'Generate & Download' },
  ]
  const activeIdx = steps.findIndex(s => s.key === step)

  return (
    <div className="flex items-center gap-0">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center">
          <div className={`flex items-center gap-1.5 text-sm ${i <= activeIdx ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
            <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
              i < activeIdx ? 'bg-primary text-primary-foreground' :
              i === activeIdx ? 'border-2 border-primary text-primary' :
              'border border-muted-foreground/40 text-muted-foreground'
            }`}>
              {i < activeIdx ? '✓' : i + 1}
            </div>
            <span className="hidden sm:inline">{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <ChevronRight className={`mx-2 h-4 w-4 ${i < activeIdx ? 'text-primary' : 'text-muted-foreground/40'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ─── StoryboardClipCard ───────────────────────────────────────────────────────

function StoryboardClipCard({
  clip, idx, totalClips, hint, onHintChange, onRefresh, isRefreshing, isStale,
}: {
  clip: PublicClip
  idx: number
  totalClips: number
  hint: string
  onHintChange: (v: string) => void
  onRefresh: () => void
  isRefreshing: boolean
  isStale: boolean
}) {
  const [showHint, setShowHint] = useState(false)
  const clipsAffected = totalClips - idx

  return (
    <Card className={`transition-opacity ${isStale && !isRefreshing ? 'opacity-50' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Clip number */}
          <div className="mt-0.5 shrink-0">
            {isRefreshing && idx >= (isRefreshing ? 0 : idx) ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : (
              <Badge variant="secondary" className="text-xs tabular-nums">
                {String(idx + 1).padStart(2, '0')}
              </Badge>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 space-y-2">
            {/* Time range */}
            <p className="text-xs font-medium text-muted-foreground">
              {idx * 10}s – {(idx + 1) * 10}s
            </p>

            {/* Visual summary */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Visual</p>
              <p className="text-sm leading-relaxed">{clip.visualSummary}</p>
            </div>

            {/* VO script */}
            <div className="rounded-md bg-muted/50 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Voiceover</p>
              <p className="text-sm italic leading-relaxed">"{clip.voScript}"</p>
            </div>

            {/* Refresh controls */}
            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={isRefreshing}
                className="h-7 text-xs"
              >
                {isRefreshing ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-3 w-3" />
                )}
                Refresh from here
              </Button>

              {clipsAffected > 1 && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  ⚠ Will regenerate clips {idx + 1}–{totalClips}
                </span>
              )}

              <button
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowHint(p => !p)}
              >
                {showHint ? '▲ hide hint' : '+ add hint'}
              </button>
            </div>

            {/* Optional hint */}
            {showHint && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={hint}
                  onChange={e => onHintChange(e.target.value)}
                  placeholder="e.g. more dramatic, zoom in on product…"
                  className="flex-1 rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── ProgressRow ─────────────────────────────────────────────────────────────

function ProgressRow({
  label, status, pct,
}: {
  label: string
  status: 'waiting' | 'generating' | 'retrying' | 'done' | 'error'
  pct: number
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-4 shrink-0">
        {status === 'done' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
        {(status === 'generating') && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
        {status === 'retrying' && <RefreshCw className="h-4 w-4 animate-spin text-amber-500" />}
        {status === 'waiting' && <Clock className="h-4 w-4 text-muted-foreground/40" />}
        {status === 'error' && <AlertCircle className="h-4 w-4 text-destructive" />}
      </div>
      <span className="w-40 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            status === 'done' ? 'bg-green-500' :
            status === 'generating' ? 'bg-primary' :
            status === 'retrying' ? 'bg-amber-500' :
            status === 'error' ? 'bg-destructive' : 'bg-transparent'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {status === 'done' ? '100%' : status === 'waiting' ? '' : `${Math.round(pct)}%`}
      </span>
    </div>
  )
}

// ─── ClipPreviewCard ──────────────────────────────────────────────────────────

function ClipPreviewCard({ clip }: { clip: ClipGenState }) {
  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-[9/16] bg-black">
        {clip.videoUrl ? (
          <video
            src={clip.videoUrl}
            poster={clip.thumbnailUrl || undefined}
            controls
            playsInline
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Play className="h-8 w-8 text-white/20" />
          </div>
        )}
        <div className="absolute left-2 top-2">
          <Badge className="text-xs">Clip {clip.index + 1}</Badge>
        </div>
      </div>
    </Card>
  )
}
