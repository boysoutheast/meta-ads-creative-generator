import { cn } from '@/lib/utils'

export function Progress({
  value = 0,
  className,
}: {
  value?: number
  className?: string
}) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-secondary', className)}>
      <div
        className="h-full bg-primary transition-all duration-300 ease-out"
        style={{ width: `${v}%` }}
      />
    </div>
  )
}
