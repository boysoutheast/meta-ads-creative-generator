'use client'

import React, { useState } from 'react'
import {
  Camera, Lightbulb, Clapperboard, MapPin,
  RefreshCw, Eye, EyeOff, Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { PublicClip, TechnicalConfig } from '@/lib/api'

// ─── Tech badge config ────────────────────────────────────────────────────────

const TECH_BADGES: { key: keyof TechnicalConfig; icon: React.ReactNode; label: string }[] = [
  { key: 'cameraShot',  icon: <Camera className="h-3 w-3" />,       label: 'Shot'    },
  { key: 'lighting',    icon: <Lightbulb className="h-3 w-3" />,    label: 'Light'   },
  { key: 'visualStyle', icon: <Clapperboard className="h-3 w-3" />, label: 'Style'   },
  { key: 'setting',     icon: <MapPin className="h-3 w-3" />,        label: 'Setting' },
]

// ─── Props ────────────────────────────────────────────────────────────────────

export interface StoryboardClipCardProps {
  clip: PublicClip
  idx: number
  totalClips: number
  hint: string
  onHintChange: (v: string) => void
  onRefresh: () => void
  isRefreshing: boolean
  isStale: boolean
  refLabels?: { tag: string; label: string }[]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StoryboardClipCard({
  clip, idx, totalClips, hint, onHintChange, onRefresh, isRefreshing, isStale, refLabels = [],
}: StoryboardClipCardProps) {
  const [showHint, setShowHint] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const clipsAffected = totalClips - idx
  const tc = clip.technicalConfig

  return (
    <Card className={`transition-opacity ${isStale && !isRefreshing ? 'opacity-50' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">

          {/* Scene preview image — 9:16 portrait thumbnail */}
          <div className="shrink-0 w-16 self-stretch">
            <div className="relative w-16 rounded-md overflow-hidden border border-border/50 bg-muted/30" style={{ minHeight: '90px' }}>
              {clip.sceneImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={clip.sceneImageUrl}
                  alt={`Scene ${idx + 1}`}
                  className="w-full h-full object-cover"
                  style={{ minHeight: '90px' }}
                />
              ) : (
                <div className="flex flex-col items-center justify-center w-full h-full gap-1 py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/50" />
                  <span className="text-[9px] text-muted-foreground/50 text-center">scene</span>
                </div>
              )}
              {/* Clip number overlay */}
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 text-center">
                <span className="text-[9px] text-white font-mono font-semibold">
                  {isRefreshing ? '…' : `#${String(idx + 1).padStart(2, '0')}`}
                </span>
              </div>
            </div>
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
