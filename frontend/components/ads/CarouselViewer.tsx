'use client'
import { useState } from 'react'
import { ChevronLeft, ChevronRight, Download, ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { CarouselSlide } from '@/lib/types'

async function downloadImage(url: string, filename: string) {
  try {
    const res = await fetch(url, { mode: 'cors' })
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(blobUrl)
  } catch {
    window.open(url, '_blank')
  }
}

export function CarouselViewer({ slides, productName }: { slides: CarouselSlide[]; productName: string }) {
  const [active, setActive] = useState(0)
  if (!slides.length) return null
  const slide = slides[active]
  const headline = slide.copy?.headline || slide.headline
  const subtext = slide.copy?.subtext || slide.subtext
  const cta = slide.copy?.cta || slide.cta

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-xl border bg-muted">
        <div className="relative aspect-square w-full">
          {slide.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={slide.imageUrl} alt={`Slide ${slide.slideIndex}`} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <ImageIcon className="h-10 w-10" />
              <p className="text-xs">Belum ada gambar untuk slide ini</p>
            </div>
          )}

          <button
            type="button"
            onClick={() => setActive((p) => (p === 0 ? slides.length - 1 : p - 1))}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white transition hover:bg-black/70"
            aria-label="Previous"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setActive((p) => (p === slides.length - 1 ? 0 : p + 1))}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white transition hover:bg-black/70"
            aria-label="Next"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          <div className="absolute left-2 top-2">
            <Badge>
              Slide {active + 1} / {slides.length}
              {slide.slideRole && <span className="ml-1 opacity-80">· {slide.slideRole}</span>}
            </Badge>
          </div>
        </div>

        <div className="flex justify-center gap-1.5 py-3">
          {slides.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setActive(idx)}
              className={cn(
                'h-2 rounded-full transition-all',
                idx === active ? 'w-6 bg-primary' : 'w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50'
              )}
              aria-label={`Go to slide ${idx + 1}`}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2 rounded-xl border bg-card p-4">
        {headline && <h3 className="font-semibold">{headline}</h3>}
        {subtext && <p className="text-sm text-muted-foreground">{subtext}</p>}
        {cta && <Badge variant="outline">CTA: {cta}</Badge>}

        <details className="pt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">Image prompt</summary>
          <p className="mt-1 max-h-32 overflow-auto rounded bg-muted p-2 text-xs leading-relaxed">{slide.imagePrompt}</p>
        </details>

        {slide.imageUrl && (
          <Button
            size="sm"
            onClick={() => downloadImage(slide.imageUrl!, `${productName}-slide-${slide.slideIndex}.png`)}
            className="w-full"
          >
            <Download className="h-4 w-4" />
            Download slide ini
          </Button>
        )}
      </div>
    </div>
  )
}
