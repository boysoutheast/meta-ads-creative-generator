'use client'

import React, { useState } from 'react'
import {
  Camera, Lightbulb, Clapperboard,
  RefreshCw, Eye, EyeOff, Loader2, Sparkles, Palette, Globe, Package, Music2, Mic2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { PublicClip } from '@/lib/api'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface StoryboardClipCardProps {
  clip: PublicClip
  idx: number
  totalClips: number
  clipDuration?: number          // seconds per clip (default 10)
  hint: string
  onHintChange: (v: string) => void
  onRefresh: () => void
  isRefreshing: boolean
  isStale: boolean
  refLabels?: { tag: string; label: string }[]
}

// VO type labels for display
const VO_TYPE_ICONS: Record<string, string> = {
  narration: '📢',
  dialogue:  '🎭',
  asmr:      '🎧',
  demo:      '📚',
  story:     '✨',
}
const VO_TYPE_LABELS: Record<string, string> = {
  narration: 'CTA Narration',
  dialogue:  'Dialogue',
  asmr:      'ASMR',
  demo:      'Demo',
  story:     'Story',
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StoryboardClipCard({
  clip, idx, totalClips, clipDuration = 10, hint, onHintChange, onRefresh, isRefreshing, isStale, refLabels = [],
}: StoryboardClipCardProps) {
  const [showHint, setShowHint] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const clipsAffected = totalClips - idx
  const tc = clip.technicalConfig
  const startSec = idx * clipDuration
  const endSec = startSec + clipDuration
  const voType = tc?.voType || 'narration'
  const isAsmr = voType === 'asmr'

  // Build power-template section previews from the grokPrompt
  function extractSection(tag: string): string {
    if (!clip.grokPrompt) return ''
    const m = clip.grokPrompt.match(new RegExp(`\\[${tag}\\]\\s*([^\\[]+)`, 'i'))
    return m ? m[1].replace(/\n/g, ' ').trim().slice(0, 200) : ''
  }

  const worldSection   = tc?.worldBuilding  || extractSection('WORLD')
  const productSection = tc?.productDesign  || extractSection('PRODUCT')
  const effectsSection = tc?.effects        || extractSection('EFFECTS')
  const paletteSection = tc?.colorPalette   || extractSection('COLOR_PALETTE')
  const sceneFlow      = tc?.sceneFlow      || extractSection('SCENE_FLOW')

  return (
    <Card className={`transition-opacity ${isStale && !isRefreshing ? 'opacity-50' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">

          {/* Scene preview image — portrait thumbnail */}
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

            {/* Time range + subject pill */}
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs font-medium text-muted-foreground">
                {startSec}s – {endSec}s
              </p>
              {tc?.mainSubject && (
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] text-primary/80">
                  ● {tc.mainSubject}
                </span>
              )}
              {tc?.visualStyle && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                  <Clapperboard className="h-3 w-3" />{tc.visualStyle}
                </span>
              )}
            </div>

            {/* Visual summary */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Scene</p>
              <p className="text-sm leading-relaxed">{clip.visualSummary}</p>
            </div>

            {/* Audio Dimension — varies by voType */}
            <div className="rounded-md bg-muted/50 px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">{VO_TYPE_ICONS[voType] || '🔊'}</span>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {VO_TYPE_LABELS[voType] || 'Audio'}{tc?.voiceType ? ` — ${tc.voiceType}` : ''}
                </p>
              </div>

              {/* ASMR: show sound design */}
              {isAsmr && tc?.soundDesign ? (
                <p className="text-sm leading-relaxed text-foreground/80 italic">{tc.soundDesign}</p>
              ) : !isAsmr && clip.voScript ? (
                <p className="text-sm italic leading-relaxed">"{clip.voScript.replace(/^\[ASMR\]\s*/, '')}"</p>
              ) : null}

              {/* Ambient sounds — shown for all types if present */}
              {tc?.ambientSounds && (
                <div className="flex items-center gap-1 pt-0.5">
                  <Music2 className="h-3 w-3 text-muted-foreground shrink-0" />
                  <p className="text-[11px] text-muted-foreground italic">{tc.ambientSounds}</p>
                </div>
              )}
            </div>

            {/* Scene Flow — 3-beat breakdown */}
            {sceneFlow && (
              <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Scene Flow</p>
                <p className="text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap">{sceneFlow}</p>
              </div>
            )}

            {/* Camera + Lighting + Voice badges */}
            <div className="flex flex-wrap gap-1.5">
              {tc?.cameraShot && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                  <Camera className="h-3 w-3" />
                  <span className="font-medium text-foreground/70">Camera:</span> {tc.cameraShot}
                </span>
              )}
              {tc?.lighting && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                  <Lightbulb className="h-3 w-3" />
                  <span className="font-medium text-foreground/70">Light:</span> {tc.lighting}
                </span>
              )}
              {tc?.action && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/60 bg-amber-50/50 dark:bg-amber-900/10 dark:border-amber-700/30 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                  ▶ {tc.action}
                </span>
              )}
              {isAsmr && tc?.soundDesign && (
                <span className="inline-flex items-center gap-1 rounded-full border border-teal-200/60 bg-teal-50/40 dark:bg-teal-900/10 dark:border-teal-700/30 px-2 py-0.5 text-[11px] text-teal-700 dark:text-teal-400">
                  🎧 ASMR sound design
                </span>
              )}
            </div>

            {/* Expandable: World / Product / Effects / Colors */}
            {(worldSection || productSection || effectsSection || paletteSection) && (
              <div>
                <button
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowDetails(p => !p)}
                >
                  <Sparkles className="h-3 w-3" />
                  {showDetails ? 'Hide scene details' : 'Show scene details'}
                </button>
                {showDetails && (
                  <div className="mt-2 space-y-1.5">
                    {worldSection && (
                      <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Globe className="h-3 w-3 text-muted-foreground" />
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">World</p>
                        </div>
                        <p className="text-[11px] leading-relaxed text-foreground/80">{worldSection}</p>
                      </div>
                    )}
                    {productSection && (
                      <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Package className="h-3 w-3 text-muted-foreground" />
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Product</p>
                        </div>
                        <p className="text-[11px] leading-relaxed text-foreground/80">{productSection}</p>
                      </div>
                    )}
                    {effectsSection && (
                      <div className="rounded-md border border-purple-200/50 bg-purple-50/30 dark:bg-purple-900/10 dark:border-purple-700/30 px-3 py-2">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Sparkles className="h-3 w-3 text-purple-500" />
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-purple-600 dark:text-purple-400">Effects</p>
                        </div>
                        <p className="text-[11px] leading-relaxed text-foreground/80">{effectsSection}</p>
                      </div>
                    )}
                    {paletteSection && (
                      <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Palette className="h-3 w-3 text-muted-foreground" />
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Color Palette</p>
                        </div>
                        <p className="text-[11px] leading-relaxed text-foreground/80">{paletteSection}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Full Grok Prompt toggle */}
            {clip.grokPrompt && (
              <div>
                <button
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowPrompt(p => !p)}
                >
                  {showPrompt ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {showPrompt ? 'Hide AI prompt' : 'View full AI generation prompt'}
                  <span className="text-muted-foreground/60">({clip.grokPrompt.length} chars)</span>
                </button>
                {showPrompt && (
                  <div className="mt-1.5 rounded-md border border-border/60 bg-muted/30 px-3 py-2 max-h-64 overflow-y-auto">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 sticky top-0 bg-muted/80 pb-1">
                      Grok Prompt (13 sections)
                    </p>
                    <p className="font-mono text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap break-words">
                      {clip.grokPrompt}
                    </p>
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
                  ⚠ clips {idx + 1}–{totalClips}
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
                  placeholder="e.g. more dramatic entrance, zoom in on product glow…"
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
