'use client'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ScalingAngle } from '@/lib/types'

interface Props {
  angles: ScalingAngle[]
  selected: string[]
  onChange: (selected: string[]) => void
  /** Per-angle image quantities — keyed by angle.key */
  quantities?: Record<string, number>
  /** Called when qty for a specific angle changes */
  onQtyChange?: (key: string, qty: number) => void
  /** Show qty inputs (only relevant when generateImages is true) */
  showQty?: boolean
}

// Gradient preview per angle key — visual cue rather than plain text
const ANGLE_VISUAL: Record<string, { gradient: string; emoji: string }> = {
  fomo:              { gradient: 'from-red-500 via-orange-500 to-amber-500',     emoji: '⏰' },
  price_anchor:      { gradient: 'from-emerald-500 via-green-500 to-lime-500',   emoji: '💰' },
  social_proof:      { gradient: 'from-blue-500 via-cyan-500 to-teal-500',       emoji: '⭐' },
  problem_agitation: { gradient: 'from-rose-600 via-red-500 to-orange-500',      emoji: '😤' },
  transformation:    { gradient: 'from-purple-500 via-fuchsia-500 to-pink-500',  emoji: '✨' },
  authority:         { gradient: 'from-slate-700 via-zinc-600 to-stone-600',     emoji: '🎓' },
  curiosity_gap:     { gradient: 'from-violet-500 via-purple-500 to-indigo-500', emoji: '🔍' },
  risk_reversal:     { gradient: 'from-teal-500 via-cyan-500 to-sky-500',        emoji: '🛡️' },
  benefit:           { gradient: 'from-amber-500 via-yellow-500 to-orange-500',  emoji: '🎁' },
  before_after:      { gradient: 'from-pink-500 via-rose-500 to-red-500',        emoji: '🔄' },
  testimonial:       { gradient: 'from-indigo-500 via-blue-500 to-cyan-500',     emoji: '💬' },
  scarcity:          { gradient: 'from-orange-600 via-red-600 to-rose-600',      emoji: '🔥' },
}
const DEFAULT_VISUAL = { gradient: 'from-slate-500 to-zinc-500', emoji: '🎯' }

export function AngleSelector({ angles = [], selected, onChange, quantities = {}, onQtyChange, showQty = false }: Props) {
  const toggle = (key: string) => {
    onChange(selected.includes(key) ? selected.filter((s) => s !== key) : [...selected, key])
  }
  const allSelected = angles.length > 0 && selected.length === angles.length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{selected.length} dari {angles.length} angle dipilih</p>
        <button
          type="button"
          onClick={() => onChange(allSelected ? [] : angles.map((a) => a.key))}
          className="text-xs font-medium text-primary hover:underline"
        >
          {allSelected ? 'Deselect semua' : 'Pilih semua'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {angles.map((angle) => {
          const isSelected = selected.includes(angle.key)
          const qty = quantities[angle.key] ?? 1
          const visual = ANGLE_VISUAL[angle.key] || DEFAULT_VISUAL

          return (
            <div key={angle.key} className="relative">
              <button
                type="button"
                onClick={() => toggle(angle.key)}
                className={cn(
                  'group flex w-full items-stretch gap-0 overflow-hidden rounded-lg border text-left transition-all',
                  isSelected ? 'border-primary ring-2 ring-primary/30' : 'border-input hover:border-primary/50',
                  isSelected && showQty && onQtyChange ? 'pr-16' : ''
                )}
              >
                {/* Gradient preview strip — left side */}
                <div className={cn(
                  'flex w-12 shrink-0 items-center justify-center bg-gradient-to-br',
                  visual.gradient
                )}>
                  <span className="text-2xl drop-shadow-md">{visual.emoji}</span>
                </div>

                {/* Content */}
                <div className="flex flex-1 items-start gap-2.5 px-3 py-2.5 bg-background">
                  <div
                    className={cn(
                      'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors',
                      isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
                    )}
                  >
                    {isSelected && <Check className="h-3 w-3" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm leading-tight">{angle.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{angle.hook}</p>
                  </div>
                </div>
              </button>

              {/* Qty input — overlaid at top-right, only when selected + showQty */}
              {isSelected && showQty && onQtyChange && (
                <div
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={qty}
                    onChange={(e) => {
                      const v = Math.min(5, Math.max(1, parseInt(e.target.value) || 1))
                      onQtyChange(angle.key, v)
                    }}
                    className="w-10 rounded border bg-background px-1 py-1 text-center text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="text-[9px] font-medium text-muted-foreground leading-none">img</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
