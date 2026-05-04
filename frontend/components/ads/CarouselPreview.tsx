'use client'
import { useState } from 'react'
import { Download, ChevronLeft, ChevronRight, Image as ImageIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { ScaleCarouselSlide } from '@/lib/types'

interface CarouselPreviewProps {
  slides: ScaleCarouselSlide[]
  productName: string
}

const TYPE_LABELS: Record<string, string> = {
  hook: 'Hook',
  benefit: 'Manfaat',
  cta: 'CTA',
}

const TYPE_COLORS: Record<string, string> = {
  hook: 'bg-orange-100 text-orange-700',
  benefit: 'bg-blue-100 text-blue-700',
  cta: 'bg-green-100 text-green-700',
}

function downloadImage(url: string, filename: string) {
  fetch(url)
    .then((r) => r.blob())
    .then((blob) => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = filename
      a.click()
      URL.revokeObjectURL(a.href)
    })
    .catch(() => {
      window.open(url, '_blank')
    })
}

export function CarouselPreview({ slides, productName }: CarouselPreviewProps) {
  const [active, setActive] = useState(0)

  const activeSlide = slides[active]

  const prev = () => setActive((i) => Math.max(0, i - 1))
  const next = () => setActive((i) => Math.min(slides.length - 1, i + 1))

  return (
    <div className="space-y-4">
      {/* Main preview */}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Large preview */}
        <Card className="overflow-hidden">
          <div className="relative aspect-square w-full bg-muted">
            {activeSlide?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={activeSlide.imageUrl}
                alt={activeSlide.headline}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <ImageIcon className="h-12 w-12 opacity-30" />
                <p className="text-sm">Prompt only</p>
              </div>
            )}
            {/* Nav arrows */}
            {slides.length > 1 && (
              <>
                <button
                  onClick={prev}
                  disabled={active === 0}
                  className="absolute left-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white disabled:opacity-30 hover:bg-black/60"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={next}
                  disabled={active === slides.length - 1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white disabled:opacity-30 hover:bg-black/60"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            )}
            {/* Slide counter */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
              {slides.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActive(i)}
                  className={`h-1.5 rounded-full transition-all ${i === active ? 'w-4 bg-white' : 'w-1.5 bg-white/50'}`}
                />
              ))}
            </div>
          </div>
        </Card>

        {/* Copy panel */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <Badge className={TYPE_COLORS[activeSlide?.type] || ''}>
                {TYPE_LABELS[activeSlide?.type] || activeSlide?.type}
              </Badge>
              <span className="text-xs text-muted-foreground">Slide {active + 1} / {slides.length}</span>
            </div>

            {activeSlide?.headline && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Headline</p>
                <p className="mt-0.5 font-semibold leading-snug">{activeSlide.headline}</p>
              </div>
            )}

            {activeSlide?.subtext && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subtext</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{activeSlide.subtext}</p>
              </div>
            )}

            {activeSlide?.imagePrompt && (
              <details className="rounded-md bg-muted/40 p-2 text-xs">
                <summary className="cursor-pointer font-medium text-muted-foreground">Image prompt</summary>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{activeSlide.imagePrompt}</p>
              </details>
            )}

            {activeSlide?.imageUrl && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => downloadImage(activeSlide.imageUrl!, `${productName}-slide-${active + 1}.jpg`)}
              >
                <Download className="h-3.5 w-3.5" /> Download Slide {active + 1}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Thumbnail strip */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {slides.map((slide, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            className={`relative shrink-0 h-16 w-16 overflow-hidden rounded-md border-2 transition-all ${
              i === active ? 'border-primary shadow-md' : 'border-transparent opacity-70 hover:opacity-100'
            }`}
          >
            {slide.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={slide.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-muted text-xs text-muted-foreground">
                {i + 1}
              </div>
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-black/40 py-0.5 text-center text-[9px] text-white">
              {TYPE_LABELS[slide.type] || slide.type}
            </div>
          </button>
        ))}

        {slides.some((s) => s.imageUrl) && (
          <Button
            variant="outline"
            size="sm"
            className="ml-2 shrink-0 self-center"
            onClick={() => {
              slides.forEach((slide, i) => {
                if (slide.imageUrl) {
                  setTimeout(() => downloadImage(slide.imageUrl!, `${productName}-slide-${i + 1}.jpg`), i * 300)
                }
              })
            }}
          >
            <Download className="h-3.5 w-3.5" /> Semua
          </Button>
        )}
      </div>
    </div>
  )
}
