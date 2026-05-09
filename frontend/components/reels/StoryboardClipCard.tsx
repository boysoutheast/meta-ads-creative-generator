'use client'

import React, { useState } from 'react'
import {
  Camera, Lightbulb, Clapperboard,
  RefreshCw, Loader2, Sparkles, Palette, Globe, Package, Music2,
  Pencil, Check, X, Wand2,
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
  onEdit?: (idx: number, visualSummary: string, voScript: string) => Promise<void>
  // Feature 12 — AI conversational shot edit
  onEditAI?: (idx: number, instruction: string) => Promise<void>
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
  clip, idx, totalClips, clipDuration = 10, hint, onHintChange, onRefresh, onEdit, onEditAI, isRefreshing, isStale, refLabels = [],
}: StoryboardClipCardProps) {
  const [showHint, setShowHint] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  // Edit mode state
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editVisualSummary, setEditVisualSummary] = useState(clip.visualSummary)
  const [editVoScript, setEditVoScript] = useState(clip.voScript)

  // Feature 12 — AI conversational edit
  const [aiInstruction, setAiInstruction] = useState('')
  const [aiEditing, setAiEditing] = useState(false)
  const [showAiEdit, setShowAiEdit] = useState(false)

  async function handleAiEdit() {
    if (!onEditAI || !aiInstruction.trim()) return
    setAiEditing(true)
    try {
      await onEditAI(idx, aiInstruction.trim())
      setAiInstruction('')
      setShowAiEdit(false)
    } finally {
      setAiEditing(false)
    }
  }

  async function handleSaveEdit() {
    if (!onEdit) return
    setSaving(true)
    try {
      await onEdit(idx, editVisualSummary, editVoScript)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  function handleCancelEdit() {
    setEditVisualSummary(clip.visualSummary)
    setEditVoScript(clip.voScript)
    setEditing(false)
  }
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

            {/* Visual summary — editable */}
            <div>
              <div className="flex items-center gap-1.5 mb-0.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Scene</p>
                {onEdit && !editing && (
                  <button
                    className="text-[10px] text-muted-foreground/60 hover:text-primary flex items-center gap-0.5 transition-colors"
                    onClick={() => { setEditVisualSummary(clip.visualSummary); setEditVoScript(clip.voScript); setEditing(true) }}
                  >
                    <Pencil className="h-2.5 w-2.5" />edit
                  </button>
                )}
              </div>
              {editing ? (
                <textarea
                  value={editVisualSummary}
                  onChange={e => setEditVisualSummary(e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              ) : (
                <p className="text-sm leading-relaxed">{clip.visualSummary}</p>
              )}
            </div>

            {/* Audio Dimension — varies by voType, editable when in edit mode */}
            <div className="rounded-md bg-muted/50 px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">{VO_TYPE_ICONS[voType] || '🔊'}</span>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {VO_TYPE_LABELS[voType] || 'Audio'}{tc?.voiceType ? ` — ${tc.voiceType}` : ''}
                </p>
              </div>

              {/* ASMR: show sound design (not editable via voScript field) */}
              {isAsmr && tc?.soundDesign ? (
                <p className="text-sm leading-relaxed text-foreground/80 italic">{tc.soundDesign}</p>
              ) : !isAsmr ? (
                editing ? (
                  <textarea
                    value={editVoScript}
                    onChange={e => setEditVoScript(e.target.value)}
                    rows={4}
                    placeholder="Voiceover script…"
                    className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                ) : clip.voScript ? (
                  <p className="text-sm italic leading-relaxed">"{clip.voScript.replace(/^\[ASMR\]\s*/, '')}"</p>
                ) : null
              ) : null}

              {/* Ambient sounds — shown for all types if present */}
              {tc?.ambientSounds && (
                <div className="flex items-center gap-1 pt-0.5">
                  <Music2 className="h-3 w-3 text-muted-foreground shrink-0" />
                  <p className="text-[11px] text-muted-foreground italic">{tc.ambientSounds}</p>
                </div>
              )}
            </div>

            {/* Edit mode save/cancel buttons */}
            {editing && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleSaveEdit}
                  disabled={saving}
                >
                  {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={handleCancelEdit}
                  disabled={saving}
                >
                  <X className="mr-1 h-3 w-3" />Cancel
                </Button>
              </div>
            )}

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

              {onEditAI && (
                <button
                  className="text-xs text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1"
                  onClick={() => setShowAiEdit(p => !p)}
                >
                  <Wand2 className="h-3 w-3" />
                  {showAiEdit ? '▲ hide AI edit' : 'AI edit'}
                </button>
              )}
              <button
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowHint(p => !p)}
              >
                {showHint ? '▲ hide hint' : '+ add hint'}
              </button>
            </div>

            {/* Feature 12 — AI conversational edit */}
            {showAiEdit && onEditAI && (
              <div className="rounded-md border border-violet-300/40 bg-violet-50/30 dark:bg-violet-900/10 p-2 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">✨ AI Shot Edit</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={aiInstruction}
                    onChange={e => setAiInstruction(e.target.value)}
                    placeholder='e.g. "make it more dramatic" or "change setting to night"'
                    disabled={aiEditing}
                    onKeyDown={e => { if (e.key === 'Enter') handleAiEdit() }}
                    className="flex-1 rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-50"
                  />
                  <Button size="sm" onClick={handleAiEdit} disabled={!aiInstruction.trim() || aiEditing} className="h-7 text-xs">
                    {aiEditing ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Apply'}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">AI rewrites this clip's prompt + regenerates the scene image.</p>
              </div>
            )}

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
