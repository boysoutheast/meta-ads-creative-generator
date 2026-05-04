'use client'
import { useRef, useState } from 'react'
import { Download, Copy, Check, ImageIcon, Eye, EyeOff } from 'lucide-react'
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

async function downloadFromUrl(url: string, filename: string) {
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

// Badge colours keyed by angle type
const BADGE_COLORS: Record<string, string> = {
  fomo: 'bg-orange-500',
  price_anchor: 'bg-blue-600',
  social_proof: 'bg-purple-600',
  tutorial: 'bg-teal-600',
  curiosity_gap: 'bg-pink-600',
  before_after: 'bg-emerald-600',
  problem_agitate: 'bg-red-600',
  authority: 'bg-amber-600',
}
const badgeColor = (badge?: string) => (badge ? (BADGE_COLORS[badge] ?? 'bg-gray-700') : 'bg-gray-700')

export function AdCard({ data, index }: { data: AdCardData; index: number }) {
  const [copied, setCopied] = useState(false)
  const [adPreview, setAdPreview] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)

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
        // Composited download (image + text overlay) via html2canvas
        const html2canvas = (await import('html2canvas')).default
        const canvas = await html2canvas(previewRef.current, {
          useCORS: true,
          allowTaint: true,
          scale: 2,
          logging: false,
        })
        const link = document.createElement('a')
        link.download = `ad-${data.badge || index + 1}-preview-${Date.now()}.jpg`
        link.href = canvas.toDataURL('image/jpeg', 0.95)
        link.click()
      } else {
        await downloadFromUrl(data.imageUrl, `ad-${data.badge || index + 1}-${Date.now()}.jpg`)
      }
    } catch (e) {
      console.warn('Download failed, falling back:', e)
      window.open(data.imageUrl, '_blank')
    } finally {
      setDownloading(false)
    }
  }

  const hasImage = !!data.imageUrl

  return (
    <Card className="overflow-hidden">
      {/* Image area — raw or preview */}
      {adPreview && hasImage ? (
        /* ── Ad preview with text overlay ── */
        <div
          ref={previewRef}
          className="relative aspect-square w-full overflow-hidden select-none"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.imageUrl!}
            alt={data.headline || `ad-${index}`}
            className="h-full w-full object-cover"
            crossOrigin="anonymous"
          />
          {/* Gradient vignette */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/70 pointer-events-none" />
          {/* Angle badge */}
          {data.badge && (
            <div className={`absolute left-3 top-3 rounded-full ${badgeColor(data.badge)} px-3 py-1 text-xs font-bold text-white uppercase tracking-wide shadow-md`}>
              {data.badge.replace(/_/g, ' ')}
            </div>
          )}
          {/* Headline + subheadline overlay */}
          <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none">
            {data.headline && (
              <p className="text-lg font-extrabold leading-tight text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
                {data.headline}
              </p>
            )}
            {data.subheadline && (
              <p className="mt-1 text-sm font-medium text-white/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
                {data.subheadline}
              </p>
            )}
            {data.cta && (
              <div className="mt-2">
                <span className="inline-block rounded-md bg-white/90 px-3 py-1 text-xs font-bold text-gray-900 shadow">
                  {data.cta}
                </span>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── Normal image view ── */
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
          {data.badge && (
            <div className="absolute left-2 top-2">
              <Badge>{data.badge}</Badge>
            </div>
          )}
        </div>
      )}

      <CardContent className="space-y-2 p-4">
        {/* Preview toggle — only shown when there's an image */}
        {hasImage && (
          <button
            onClick={() => setAdPreview((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {adPreview ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {adPreview ? 'Lihat biasa' : '👁 Preview sebagai iklan'}
          </button>
        )}

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
            <p className="mt-1 rounded bg-emerald-50 p-2 text-xs leading-relaxed text-emerald-800 border border-emerald-100">
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
