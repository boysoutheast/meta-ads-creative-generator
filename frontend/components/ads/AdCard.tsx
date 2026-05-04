'use client'
import { useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { Download, Copy, Check, ImageIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export interface AdCardData {
  title?: string
  badge?: string
  imageUrl?: string | null
  videoUrl?: string | null
  videoJobId?: string | null
  headline?: string
  subheadline?: string
  bodyText?: string
  cta?: string | null
  imagePrompt?: string | null
  translatedConcept?: string | null
  error?: string | null
}

export function AdCard({ data, index }: { data: AdCardData; index: number }) {
  const [copied, setCopied]       = useState(false)
  const [adPreview, setAdPreview] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)

  const hasImage = !!data.imageUrl

  const copyText = () => {
    const txt = [data.headline, data.subheadline, data.bodyText, data.cta && `CTA: ${data.cta}`]
      .filter(Boolean)
      .join('\n\n')
    navigator.clipboard.writeText(txt)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleDownload = async () => {
    if (!data.imageUrl) return
    setDownloading(true)
    try {
      if (adPreview && previewRef.current) {
        const canvas = await html2canvas(previewRef.current, {
          useCORS: true,
          allowTaint: true,
          scale: 2,
          backgroundColor: null,
        })
        const link = document.createElement('a')
        link.download = `ad-preview-${data.badge || 'variation'}-${Date.now()}.jpg`
        link.href = canvas.toDataURL('image/jpeg', 0.95)
        link.click()
      } else {
        // Plain image download
        try {
          const res = await fetch(data.imageUrl, { mode: 'cors' })
          const blob = await res.blob()
          const blobUrl = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = blobUrl
          link.download = `ad-${data.badge || 'variation'}-${Date.now()}.jpg`
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          URL.revokeObjectURL(blobUrl)
        } catch {
          window.open(data.imageUrl, '_blank')
        }
      }
    } catch {
      if (data.imageUrl) window.open(data.imageUrl, '_blank')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Card className="overflow-hidden">
      {/* ── Toggle pill — floats at top-right of image ── */}
      {hasImage && (
        <div className="flex items-center justify-end px-3 pt-2 pb-1">
          <button
            onClick={() => setAdPreview((v) => !v)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              adPreview
                ? 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100'
                : 'border-muted bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {adPreview ? '✕ Tutup preview' : '👁 Preview iklan'}
          </button>
        </div>
      )}

      {/* ── Image area ── */}
      {adPreview && hasImage ? (
        /* Preview mode — text composited on image */
        <div
          ref={previewRef}
          className="relative aspect-square w-full overflow-hidden rounded-xl mx-2"
          style={{ width: 'calc(100% - 16px)' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.imageUrl!}
            alt=""
            className="h-full w-full object-cover"
            crossOrigin="anonymous"
          />
          {/* Dark gradient bottom */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/75 pointer-events-none" />
          {/* Angle badge top-left */}
          {data.badge && (
            <div className="absolute left-3 top-3 rounded-full bg-orange-500 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white shadow">
              {data.badge.replace(/_/g, ' ')}
            </div>
          )}
          {/* Headline + subheadline + CTA bottom */}
          <div className="absolute bottom-0 left-0 right-0 p-4">
            {data.headline && (
              <p className="text-[22px] font-extrabold leading-tight text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                {data.headline}
              </p>
            )}
            {data.subheadline && (
              <p className="mt-1 text-sm font-medium text-white/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
                {data.subheadline}
              </p>
            )}
            {data.cta && (
              <div className="mt-3">
                <span className="inline-block rounded-full bg-orange-500 px-4 py-1.5 text-sm font-bold text-white shadow">
                  {data.cta.replace(/^CTA:\s*/i, '')}
                </span>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Normal mode — plain image */
        <div className="relative aspect-square w-full bg-muted">
          {hasImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.imageUrl!}
              alt={data.headline || `variation-${index}`}
              className="h-full w-full object-cover"
            />
          ) : data.videoJobId ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
              <Badge variant="secondary">Video Job</Badge>
              <p className="font-mono break-all">{data.videoJobId}</p>
              <p>Cek status di apimart.ai dashboard</p>
            </div>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <ImageIcon className="h-8 w-8" />
              <p className="text-xs">Prompt only (no image)</p>
            </div>
          )}
          {data.badge && !hasImage && (
            <div className="absolute left-2 top-2">
              <Badge>{data.badge}</Badge>
            </div>
          )}
        </div>
      )}

      {/* ── Card content ── */}
      <CardContent className="space-y-2 p-4">
        {/* Text copy — hidden when preview ON (text already on image) */}
        {!adPreview && (
          <>
            {data.headline && <p className="font-semibold leading-snug">{data.headline}</p>}
            {data.subheadline && <p className="text-sm text-muted-foreground">{data.subheadline}</p>}
            {data.bodyText && <p className="text-sm">{data.bodyText}</p>}
            {data.cta && (
              <div className="pt-1">
                <Badge variant="outline">CTA: {data.cta}</Badge>
              </div>
            )}
          </>
        )}

        {data.error && <p className="text-xs text-destructive">{data.error}</p>}

        {data.translatedConcept && (
          <details className="pt-1">
            <summary className="cursor-pointer text-xs text-emerald-700 hover:text-emerald-900">
              ✦ Concept translation
            </summary>
            <p className="mt-1 rounded border border-emerald-100 bg-emerald-50 p-2 text-xs leading-relaxed text-emerald-800">
              {data.translatedConcept}
            </p>
          </details>
        )}

        {data.imagePrompt && (
          <details className="pt-1">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Lihat image prompt
            </summary>
            <p className="mt-1 max-h-32 overflow-auto rounded bg-muted p-2 text-xs leading-relaxed">
              {data.imagePrompt}
            </p>
          </details>
        )}

        <div className="flex gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={copyText} className="flex-1">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            <span>{copied ? 'Tersalin' : 'Copy text'}</span>
          </Button>
          {hasImage && (
            <Button
              size="sm"
              onClick={handleDownload}
              disabled={downloading}
              className="flex-1"
              title={adPreview ? 'Download dengan overlay teks' : 'Download gambar asli'}
            >
              <Download className="h-4 w-4" />
              {downloading ? 'Saving…' : adPreview ? 'Download Ad' : 'Download'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
