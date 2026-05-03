'use client'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  steps: { label: string }[]
  current: number // 1-based
}

export function WizardSteps({ steps, current }: Props) {
  return (
    <ol className="flex w-full items-center">
      {steps.map((step, idx) => {
        const i = idx + 1
        const isDone = i < current
        const isActive = i === current
        return (
          <li
            key={step.label}
            className={cn(
              'flex flex-1 items-center',
              idx < steps.length - 1 && "after:mx-2 after:h-0.5 after:flex-1 after:bg-muted after:content-['']"
            )}
          >
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors',
                  isDone && 'bg-primary text-primary-foreground',
                  isActive && 'bg-primary text-primary-foreground ring-4 ring-primary/20',
                  !isDone && !isActive && 'bg-muted text-muted-foreground'
                )}
              >
                {isDone ? <Check className="h-4 w-4" /> : i}
              </div>
              <span
                className={cn(
                  'hidden text-sm font-medium sm:inline',
                  isActive ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {step.label}
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
