'use client'
import { useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { Download, Copy, Check, ImageIcon, ChevronLeft, ChevronRight, ClipboardCopy } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export interface AdCardData {
  title?: string
  badge?: string
  imageUrl?: string | null
  imageUrls?: string[] | null
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
  const [copied, setCopied]         = useState(false)
  const [promptCopied, setPromptCopied] = useState(false)
  const [adPreview, setAdPreview]   = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadingAll, setDownloadingAll] = useState(false)
  const [imgIndex, setImgIndex]     = useState(0)
  const previewRef = useRef<HTMLDivElement>(null)

  // Merge imageUrls array with legacy single imageUrl
  const allImages: string[] = data.imageUrls && data.imageUrls.length > 0
    ? data.imageUrls
    : data.imageUrl ? [data.imageUrl] : []
  const hasImage    = allImages.length > 0
  const activeImageUrl = allImages[imgIndex] || null
  const hasMultiple = allImages.length > 1

  // ── Copy copy-text ──────────────────────────────────────────────────────────
  const copyText = () => {
    const txt = [data.headline, data.subheadline, data.bodyText, data.cta && `CTA: ${data.cta}`]
      .filter(Boolean).join('\n\n')
    navigator.clipboard.writeText(txt)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // ── Copy image prompt ───────────────────────────────────────────────────────
  const copyPrompt = () => {
    if (!data.imagePrompt) return
    navigator.clipboard.writeText(data.imagePrompt)
    setPromptCopied(true)
    setTimeout(() => setPromptCopied(false), 1500)
  }

  // ── Download single image ───────────────────────────────────────────────────
  const downloadSingle = async (url: string, suffix = '') => {
    try {
      const res = await fetch(url, { mode: 'cors' })
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = `ad-${data.badge || 'variation'}${suffix}-${Date.now()}.jpg`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(blobUrl)
    } catch {
      window.open(url, '_blank')
    }
  }

  // ── Download active image (or preview canvas) ───────────────────────────────
  const handleDownload = async () => {
    if (!activeImageUrl) return
    setDownloading(true)
    try {
      if (adPreview && previewRef.current) {
        const canvas = await html2canvas(previewRef.current, {
          useCORS: true, allowTaint: true, scale: 2, backgroundColor: null,
        })
        const link = document.createElement('a')
        link.download = `ad-preview-${data.badge || 'variation'}-${imgIndex + 1}-${Date.now()}.jpg`
        link.href = canvas.toDataURL('image/jpeg', 0.95)
        link.click()
      } else {
        await downloadSingle(activeImageUrl, `-${imgIndex + 1}`)
      }
    } finally {
      setDownloading(false)
    }
  }

  // ── Download all images for this angle ─────────────────────────────────────
  const handleDownloadAll = async () => {
    if (allImages.length < 2) return
    setDownloadingAll(true)
    try {
      for (let i = 0; i < allImages.length; i++) {
        await downloadSingle(allImages[i], `-${i + 1}of${allImages.length}`)
        // Small delay between downloads to avoid browser tab overwhelm
        if (i < allImages.length - 1) await new Promise((r) => setTimeout(r, 300))
      }
    } finally {
      setDownloadingAll(false)
    }
  }

  // ── Badge label ─────────────────────────────────────────────────────────────
  const badgeLabel = (data.badge || '').replace(/_/g, ' ')

  return (
    <Card className="overflow-hidden">

      {/* ── Top bar: angle badge + preview toggle ── */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <div className="flex items-center gap-1.5">
          {data.badge && (
            <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-orange-700">
              {badgeLabel}
            </span>
          )}
          {hasMultiple && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {allImages.length} gambar
            </span>
          )}
        </div>
        {hasImage && (
          <button
            onClick={() => setAdPreview((v) => !v)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              adPreview
                ? 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100'
                : 'border-muted bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {adPreview ? '✕ Tutup' : '👁 Preview'}
          </button>
        )}
      </div>

      {/* ── Image area ── */}
      {adPreview && hasImage ? (
        /* Preview mode */
        <div
          ref={previewRef}
          className="relative aspect-square w-full overflow-hidden rounded-xl mx-2"
          style={{ width: 'calc(100% - 16px)' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={activeImageUrl!} alt="" className="h-full w-full object-cover" crossOrigin="anonymous" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/75 pointer-events-none" />
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
        /* Normal image mode */
        <div className="relative aspect-square w-full bg-muted">
          {hasImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={activeImageUrl!}
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
        </div>
      )}

      {/* ── Thumbnail strip (multi-image only) ── */}
      {hasMultiple && (
        <div className="flex items-center gap-1.5 px-3 py-2 border-t bg-muted/20">
          <button
            onClick={() => setImgIndex((i) => Math.max(0, i - 1))}
            disabled={imgIndex === 0}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded border bg-background text-muted-foreground disabled:opacity-30 hover:bg-muted"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>

          <div className="flex flex-1 gap-1.5 overflow-x-auto">
            {allImages.map((url, i) => (
              <button
                key={i}
                onClick={() => setImgIndex(i)}
                className={`relative h-12 w-12 shrink-0 overflow-hidden rounded transition-all ${
                  i === imgIndex
                    ? 'ring-2 ring-primary ring-offset-1'
                    : 'opacity-60 hover:opacity-90'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`var ${i + 1}`} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>

          <button
            onClick={() => setImgIndex((i) => Math.min(allImages.length - 1, i + 1))}
            disabled={imgIndex === allImages.length - 1}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded border bg-background text-muted-foreground disabled:opacity-30 hover:bg-muted"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Card content ── */}
      <CardContent className="space-y-2 p-4">
        {/* Text copy — hidden when preview ON */}
        {!adPreview && (
          <>
            {data.headline    && <p className="font-semibold leading-snug">{data.headline}</p>}
            {data.subheadline && <p className="text-sm text-muted-foreground">{data.subheadline}</p>}
            {data.bodyText    && <p className="text-sm">{data.bodyText}</p>}
            {data.cta         && (
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
            <div className="mt-1 rounded bg-muted p-2 text-xs leading-relaxed">
              <div className="flex items-start justify-between gap-2">
                <p className="max-h-28 overflow-auto flex-1">{data.imagePrompt}</p>
                <button
                  onClick={copyPrompt}
                  title="Copy prompt"
                  className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                >
                  {promptCopied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </details>
        )}

        {/* ── Action buttons ── */}
        <div className="flex flex-wrap gap-2 pt-2">
          {/* Copy text */}
          <Button size="sm" variant="outline" onClick={copyText} className="flex-1 min-w-[100px]">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            <span>{copied ? 'Tersalin' : 'Copy teks'}</span>
          </Button>

          {/* Download active */}
          {activeImageUrl && (
            <Button
              size="sm"
              onClick={handleDownload}
              disabled={downloading || downloadingAll}
              className="flex-1 min-w-[100px]"
              title={adPreview ? 'Download dengan overlay teks' : 'Download gambar ini'}
            >
              <Download className="h-4 w-4" />
              {downloading
                ? 'Saving…'
                : adPreview
                  ? 'Download Ad'
                  : hasMultiple
                    ? `↓ Gambar ${imgIndex + 1}`
                    : 'Download'}
            </Button>
          )}

          {/* Download all — only shown when multiple images */}
          {hasMultiple && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownloadAll}
              disabled={downloadingAll || downloading}
              className="w-full"
              title="Download semua gambar untuk angle ini"
            >
              <Download className="h-4 w-4" />
              {downloadingAll ? 'Downloading…' : `↓ Download semua (${allImages.length} gambar)`}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
