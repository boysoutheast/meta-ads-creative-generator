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

export function AngleSelector({ angles, selected, onChange, quantities = {}, onQtyChange, showQty = false }: Props) {
  const toggle = (key: string) => {
    onChange(selected.includes(key) ? selected.filter((s) => s !== key) : [...selected, key])
  }
  const allSelected = selected.length === angles.length

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

          return (
            <div key={angle.key} className="relative">
              <button
                type="button"
                onClick={() => toggle(angle.key)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                  isSelected ? 'border-primary bg-primary/5' : 'border-input hover:border-primary/50',
                  // Reserve right space for qty input when active
                  isSelected && showQty && onQtyChange ? 'pr-16' : ''
                )}
              >
                <div
                  className={cn(
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors',
                    isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
                  )}
                >
                  {isSelected && <Check className="h-3 w-3" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm">{angle.label}</p>
                  <p className="text-xs text-muted-foreground">{angle.hook}</p>
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
