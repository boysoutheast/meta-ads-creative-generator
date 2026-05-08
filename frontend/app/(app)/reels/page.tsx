'use client'

import React, { useState, useEffect } from 'react'
import {
  Film, Sparkles, AlertCircle, Loader2,
  RefreshCw, ChevronRight, Wand2, Eye, EyeOff, Camera,
  Lightbulb, Clapperboard, MapPin,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  buildStoryboard, refreshClips,
  type PublicClip, type TechnicalConfig,
} from '@/lib/api'
import { pushStoredSession } from '@/lib/reels-sessions'

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

// ─── types ───────────────────────────────────────────────────────────────────

type Step = 'input' | 'storyboard'

// ─── helpers ─────────────────────────────────────────────────────────────────

// ─── root component ───────────────────────────────────────────────────────────

export default function ReelsPage() {
  const router = useRouter()
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

  // error
  const [error, setError] = useState<string | null>(null)

  // ── Step 1: build storyboard ───────────────────────────────────────────────

  async function handleBuildStoryboard() {
    if (!prompt.trim()) return
    setBuilding(true)
    setError(null)
    try {
      const data = await buildStoryboard({ prompt: prompt.trim(), mode, duration })
      setSessionId(data.sessionId)
      setStoryboard(data.storyboard)
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
                isRefreshing={refreshingFrom === idx}
                isStale={refreshingFrom !== null && idx > refreshingFrom}
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

// ─── StoryboardClipCard ───────────────────────────────────────────────────────

const TECH_BADGES: { key: keyof TechnicalConfig; icon: React.ReactNode; label: string }[] = [
  { key: 'cameraShot',  icon: <Camera className="h-3 w-3" />,      label: 'Shot'     },
  { key: 'lighting',    icon: <Lightbulb className="h-3 w-3" />,   label: 'Light'    },
  { key: 'visualStyle', icon: <Clapperboard className="h-3 w-3" />,label: 'Style'    },
  { key: 'setting',     icon: <MapPin className="h-3 w-3" />,       label: 'Setting'  },
]

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
  const [showPrompt, setShowPrompt] = useState(false)
  const clipsAffected = totalClips - idx
  const tc = clip.technicalConfig

  return (
    <Card className={`transition-opacity ${isStale && !isRefreshing ? 'opacity-50' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Clip number */}
          <div className="mt-0.5 shrink-0">
            {isRefreshing ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : (
              <Badge variant="secondary" className="text-xs tabular-nums">
                {String(idx + 1).padStart(2, '0')}
              </Badge>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 space-y-2.5">
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

            {/* Technical config badges */}
            {tc && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {TECH_BADGES.map(({ key, icon, label }) => tc[key] ? (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {icon}
                    <span className="font-medium text-foreground/70">{label}:</span>
                    {tc[key]}
                  </span>
                ) : null)}
                {tc.mainSubject && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] text-primary/80">
                    ● {tc.mainSubject}
                    {tc.action ? ` — ${tc.action}` : ''}
                  </span>
                )}
              </div>
            )}

            {/* AI Prompt toggle */}
            {clip.grokPrompt && (
              <div>
                <button
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowPrompt(p => !p)}
                >
                  {showPrompt ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {showPrompt ? 'Hide AI prompt' : 'View AI generation prompt'}
                </button>
                {showPrompt && (
                  <div className="mt-1.5 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                      Grok Prompt (sent to AI)
                    </p>
                    <p className="font-mono text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap break-words">
                      {clip.grokPrompt}
                    </p>
                    {tc?.additionalDetails && (
                      <p className="mt-1.5 text-[10px] text-muted-foreground border-t border-border/40 pt-1.5">
                        <span className="font-semibold">Details:</span> {tc.additionalDetails}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

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

