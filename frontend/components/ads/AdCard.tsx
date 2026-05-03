'use client'
import { useState } from 'react'
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

export function AdCard({ data, index }: { data: AdCardData; index: number }) {
  const [copied, setCopied] = useState(false)
  const copyText = () => {
    const txt = [data.headline, data.subheadline, data.bodyText, data.cta && `CTA: ${data.cta}`]
      .filter(Boolean)
      .join('\n\n')
    navigator.clipboard.writeText(txt)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-square w-full bg-muted">
        {data.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.imageUrl} alt={data.headline || `variation-${index}`} className="h-full w-full object-cover" />
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

      <CardContent className="space-y-2 p-4">
        {data.headline && <p className="font-semibold leading-snug">{data.headline}</p>}
        {data.subheadline && <p className="text-sm text-muted-foreground">{data.subheadline}</p>}
        {data.bodyText && <p className="text-sm">{data.bodyText}</p>}
        {data.cta && (
          <div className="pt-1">
            <Badge variant="outline">CTA: {data.cta}</Badge>
          </div>
        )}
        {data.error && <p className="text-xs text-destructive">{data.error}</p>}

        {data.imagePrompt && (
          <details className="pt-2">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Lihat image prompt
            </summary>
            <p className="mt-1 max-h-32 overflow-auto rounded bg-muted p-2 text-xs leading-relaxed">{data.imagePrompt}</p>
          </details>
        )}

        <div className="flex gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={copyText} className="flex-1">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            <span>{copied ? 'Tersalin' : 'Copy text'}</span>
          </Button>
          {data.imageUrl && (
            <Button
              size="sm"
              onClick={() => downloadFromUrl(data.imageUrl!, `ad-${index + 1}.png`)}
              className="flex-1"
            >
              <Download className="h-4 w-4" />
              Download
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
