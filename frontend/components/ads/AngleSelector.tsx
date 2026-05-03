'use client'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ScalingAngle } from '@/lib/types'

interface Props {
  angles: ScalingAngle[]
  selected: string[]
  onChange: (selected: string[]) => void
}

export function AngleSelector({ angles, selected, onChange }: Props) {
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
          return (
            <button
              key={angle.key}
              type="button"
              onClick={() => toggle(angle.key)}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                isSelected ? 'border-primary bg-primary/5' : 'border-input hover:border-primary/50'
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
                <p className="font-medium">{angle.label}</p>
                <p className="text-xs text-muted-foreground">{angle.hook}</p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
