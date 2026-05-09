'use client'

import React, { useState, useRef } from 'react'
import {
  Film, Sparkles, AlertCircle, Loader2,
  ChevronRight, Wand2, ImagePlus, X, Info,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  buildStoryboard, refreshClips, generateSceneImages,
  type PublicClip, type ReferenceImageInput,
  type ReelsAspectRatio, type ReelsResolution, type ReelsClipDuration,
} from '@/lib/api'
import { pushStoredSession } from '@/lib/reels-sessions'
import { StoryboardClipCard } from '@/components/reels/StoryboardClipCard'

// Max reference images — matches backend MAX_REFERENCE_IMAGES constant (GeminiGen supports up to 6)
const MAX_REF_IMAGES = 6

// ─── constants ───────────────────────────────────────────────────────────────

const CLIP_DURATION_OPTIONS: { value: ReelsClipDuration; label: string }[] = [
  { value: 6,  label: '6s (Snappy)' },
  { value: 10, label: '10s (Standard)' },
  { value: 15, label: '15s (Extended)' },
]

function getDurationOptions(clipDur: number) {
  // Show multiples of clipDuration up to 120s
  const vals: number[] = []
  for (let v = clipDur; v <= 120; v += clipDur) vals.push(v)
  return vals.map(v => ({
    value: v,
    label: `${v}s (${v / clipDur} clip${v / clipDur > 1 ? 's' : ''})`,
  }))
}

const ASPECT_RATIO_OPTIONS: { value: ReelsAspectRatio; label: string; icon: string }[] = [
  { value: 'portrait',   label: 'Portrait 9:16',    icon: '▌' },
  { value: 'landscape',  label: 'Landscape 16:9',   icon: '▬' },
  { value: 'square',     label: 'Square 1:1',       icon: '■' },
  { value: 'vertical',   label: 'Vertical 2:3',     icon: '▍' },
  { value: 'horizontal', label: 'Horizontal 3:2',   icon: '▬' },
]

const RESOLUTION_OPTIONS: { value: ReelsResolution; label: string }[] = [
  { value: '480p', label: '480p (Fast)' },
  { value: '720p', label: '720p (HD)' },
]

const MODE_OPTIONS = [
  { value: 'normal', label: 'Normal', desc: 'Cinematic, clean, premium' },
  { value: 'extremely-crazy', label: 'Extremely Crazy', desc: 'Wild camera moves, surreal elements' },
  { value: 'extremely-spicy-or-crazy', label: 'Extremely Spicy or Crazy', desc: 'Maximum chaos, bold creativity' },
  { value: 'custom', label: 'Custom', desc: 'Balanced creative freedom' },
]

// ─── types ───────────────────────────────────────────────────────────────────

type Step = 'input' | 'storyboard'

type RefImage = {
  id: string
  label: string
  dataUrl: string
  preview: string   // same as dataUrl for img src
  sizeKB: number
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ─── root component ───────────────────────────────────────────────────────────

export default function ReelsPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('input')

  // input
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState(30)
  const [mode, setMode] = useState('normal')
  const [aspectRatio, setAspectRatio] = useState<ReelsAspectRatio>('portrait')
  const [resolution, setResolution] = useState<ReelsResolution>('720p')
  const [clipDuration, setClipDuration] = useState<ReelsClipDuration>(10)
  const [building, setBuilding] = useState(false)

  // reference images
  const [refImages, setRefImages] = useState<RefImage[]>([])
  const [refImageError, setRefImageError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // storyboard
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [storyboard, setStoryboard] = useState<PublicClip[]>([])
  const [sessionRefLabels, setSessionRefLabels] = useState<{ tag: string; label: string }[]>([])
  const [generatingScenes, setGeneratingScenes] = useState(false)
  const [refreshingFrom, setRefreshingFrom] = useState<number | null>(null)
  const [hints, setHints] = useState<Record<number, string>>({})

  // error
  const [error, setError] = useState<string | null>(null)

  // ── Reference image upload ────────────────────────────────────────────────

  async function handleRefImageFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setRefImageError(null)

    const remaining = MAX_REF_IMAGES - refImages.length
    if (remaining <= 0) {
      setRefImageError(`Maximum ${MAX_REF_IMAGES} reference images allowed`)
      return
    }

    const toProcess = Array.from(files).slice(0, remaining)
    const results: RefImage[] = []

    for (const file of toProcess) {
      // Validate type
      if (!file.type.startsWith('image/')) {
        setRefImageError(`"${file.name}" is not an image file`)
        return
      }
      // Validate size (5 MB)
      if (file.size > 5 * 1024 * 1024) {
        setRefImageError(`"${file.name}" exceeds 5 MB limit`)
        return
      }
      const dataUrl = await readFileAsDataUrl(file)
      results.push({
        id: `${Date.now()}-${Math.random()}`,
        label: file.name.replace(/\.[^.]+$/, '').slice(0, 30),
        dataUrl,
        preview: dataUrl,
        sizeKB: Math.round(file.size / 1024),
      })
    }

    setRefImages(prev => [...prev, ...results].slice(0, MAX_REF_IMAGES))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeRefImage(id: string) {
    setRefImages(prev => prev.filter(r => r.id !== id))
    setRefImageError(null)
  }

  // ── Step 1: build storyboard ───────────────────────────────────────────────

  async function handleBuildStoryboard() {
    if (!prompt.trim()) return
    setBuilding(true)
    setError(null)
    try {
      const referenceImages: ReferenceImageInput[] = refImages.map(r => ({
        label: r.label,
        dataUrl: r.dataUrl,
      }))
      const data = await buildStoryboard({ prompt: prompt.trim(), mode, duration, aspectRatio, resolution, clipDuration, referenceImages })
      setSessionId(data.sessionId)
      setStoryboard(data.storyboard)
      setSessionRefLabels(data.referenceImageUrls || [])
      setHints({})
      setStep('storyboard')

      // Auto-generate scene preview images right after storyboard text is ready
      handleGenerateSceneImages(data.sessionId, data.storyboard)
    } catch (err: any) {
      setError(err.message || 'Failed to build storyboard')
    } finally {
      setBuilding(false)
    }
  }

  // ── Scene image generation ─────────────────────────────────────────────────

  async function handleGenerateSceneImages(sid: string, currentStoryboard: PublicClip[], fromIndex?: number) {
    setGeneratingScenes(true)
    try {
      // Mark all clips from fromIndex as loading (sceneImageUrl = undefined-in-progress)
      const startIdx = fromIndex ?? 0
      setStoryboard(prev => prev.map((c, i) =>
        i >= startIdx ? { ...c, sceneImageUrl: null } : c
      ))

      const data = await generateSceneImages({ sessionId: sid, fromIndex })

      // Merge scene images into storyboard
      setStoryboard(prev => {
        const next = [...prev]
        data.sceneImages.forEach(({ clipNumber, sceneImageUrl }) => {
          const idx = next.findIndex(c => c.clipNumber === clipNumber)
          if (idx !== -1) next[idx] = { ...next[idx], sceneImageUrl: sceneImageUrl ?? null }
        })
        return next
      })
    } catch (err: any) {
      // Non-blocking — don't show error, just leave images as null
      console.warn('Scene image generation failed:', err.message)
    } finally {
      setGeneratingScenes(false)
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
      setRefreshingFrom(null)

      // Regenerate scene images for refreshed clips
      handleGenerateSceneImages(sessionId, data.storyboard, fromIndex)
    } catch (err: any) {
      setError(err.message || 'Refresh failed')
      setRefreshingFrom(null)
    }
  }

  // ── Step 2 → redirect to Results Reels ────────────────────────────────────

  function handleGenerate() {
    if (!sessionId) return
    // Save session metadata so Results Reels page can show it
    pushStoredSession({
      sessionId,
      prompt,
      mode,
      duration,
      totalClips: storyboard.length,
    })
    router.push('/results-reels')
  }

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

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="flex-1">{error}</p>
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

            {/* Row 1: Mode + Clip Duration */}
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
                <Label>Clip Length</Label>
                <Select
                  value={String(clipDuration)}
                  onValueChange={v => {
                    const cd = Number(v) as ReelsClipDuration
                    setClipDuration(cd)
                    // Reset duration to first valid multiple
                    setDuration(cd)
                  }}
                  disabled={building}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CLIP_DURATION_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 2: Aspect Ratio + Resolution + Total Duration */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Aspect Ratio</Label>
                <Select value={aspectRatio} onValueChange={v => setAspectRatio(v as ReelsAspectRatio)} disabled={building}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASPECT_RATIO_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>
                        <span className="font-mono mr-1.5">{o.icon}</span>{o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Resolution</Label>
                <Select value={resolution} onValueChange={v => setResolution(v as ReelsResolution)} disabled={building}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RESOLUTION_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Total Duration</Label>
                <Select value={String(duration)} onValueChange={v => setDuration(Number(v))} disabled={building}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {getDurationOptions(clipDuration).map(o => (
                      <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* ── Reference Images ─────────────────────────────────────── */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>Reference Images</Label>
                <span className="text-xs text-muted-foreground">
                  optional · max {MAX_REF_IMAGES} · 5 MB each
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Upload character designs, product photos, or style references.
                AI uses <span className="font-mono text-foreground/70">@image1</span>…<span className="font-mono text-foreground/70">@image{MAX_REF_IMAGES}</span> tags in each clip's prompt to maintain visual consistency across all scenes.
              </p>

              {/* Uploaded images grid */}
              {refImages.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {refImages.map((img, i) => (
                    <div key={img.id} className="relative group w-24">
                      <div className="relative overflow-hidden rounded-lg border border-border/60 bg-muted/30">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img.preview} alt={img.label} className="h-20 w-24 object-cover" />
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-0.5">
                          <p className="text-[9px] text-white font-mono font-semibold">@image{i + 1}</p>
                        </div>
                        <button
                          onClick={() => removeRefImage(img.id)}
                          className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      <input
                        value={img.label}
                        onChange={e => setRefImages(prev =>
                          prev.map(r => r.id === img.id ? { ...r, label: e.target.value } : r)
                        )}
                        className="mt-1 w-full rounded border bg-background px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder={`Label @image${i + 1}`}
                        maxLength={30}
                      />
                      <p className="text-[10px] text-muted-foreground text-right">{img.sizeKB}KB</p>
                    </div>
                  ))}
                </div>
              )}

              {refImages.length < MAX_REF_IMAGES && (
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={e => handleRefImageFiles(e.target.files)}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={building}
                    className="flex items-center gap-2 rounded-md border border-dashed border-border/60 px-3 py-2 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    <ImagePlus className="h-4 w-4" />
                    Add reference image ({refImages.length}/{MAX_REF_IMAGES})
                  </button>
                </div>
              )}

              {refImageError && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />{refImageError}
                </p>
              )}
            </div>

            <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              AI will generate {Math.ceil(duration / 10)} clips × 10s · Grok 720p Portrait · Mode: {mode}
              {refImages.length > 0 && ` · ${refImages.length} reference image${refImages.length > 1 ? 's' : ''}`}
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
            <Button variant="ghost" size="sm" onClick={() => { setStep('input'); setError(null); setSessionRefLabels([]) }}>
              ← Edit Brief
            </Button>
          </div>

          {/* Prompt summary */}
          <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Brief:</span> {prompt.slice(0, 120)}{prompt.length > 120 ? '…' : ''}
            {' · '}<span className="font-medium text-foreground">Mode:</span> {mode}
            {' · '}<span className="font-medium text-foreground">{storyboard.length} clips · {storyboard.length * 10}s</span>
          </div>

          {/* Reference image legend — only shown if session has refs */}
          {sessionRefLabels.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/30 border border-border/40 px-3 py-2">
              <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Reference images:</span>
              {sessionRefLabels.map(r => (
                <span key={r.tag} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] text-primary/80 font-mono">
                  {r.tag} <span className="font-sans font-normal text-foreground/60">= {r.label}</span>
                </span>
              ))}
            </div>
          )}

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
                isRefreshing={refreshingFrom === idx}
                isStale={refreshingFrom !== null && idx > refreshingFrom}
                refLabels={sessionRefLabels}
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
            Generate Reel ({storyboard.length} clips · {storyboard.length * 10}s) →
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── StepIndicator ────────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const steps: { key: string; label: string }[] = [
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



