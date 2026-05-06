'use client'
import { useEffect, useState } from 'react'
import { History, Trash2, Layers, Wand2, ImageIcon, Download, Clock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CarouselViewer } from '@/components/ads/CarouselViewer'
import { AdCard } from '@/components/ads/AdCard'
import { loadHistory, deleteHistoryEntry, clearHistory, filterByKind } from '@/lib/history'
import type { HistoryEntry, HistoryKind } from '@/lib/types'

async function downloadUrl(url: string, filename: string) {
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

function getImageUrls(entry: HistoryEntry): string[] {
  const p = entry.payload
  if (entry.kind === 'scale') {
    return (p.variations || []).map((v: any) => v.imageUrl).filter(Boolean)
  }
  if (entry.kind === 'carousel') {
    return (p.slides || []).map((s: any) => s.imageUrl).filter(Boolean)
  }
  if (entry.kind === 'create') {
    return (p.results || []).map((r: any) => r.imageUrl).filter(Boolean)
  }
  return []
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  if (h > 0) return `${h} jam lalu`
  if (m > 0) return `${m} menit lalu`
  return 'baru saja'
}

function expiresIn(ts: number): string {
  const remaining = ts + 72 * 3600 * 1000 - Date.now()
  if (remaining <= 0) return 'kedaluwarsa'
  const h = Math.floor(remaining / 3600000)
  return `kedaluwarsa dalam ${h}j`
}

export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [filter, setFilter] = useState<HistoryKind | 'all'>('all')
  const [active, setActive] = useState<HistoryEntry | null>(null)

  useEffect(() => {
    setEntries(loadHistory())
  }, [])

  const refresh = () => setEntries(loadHistory())
  const remove = (id: string) => {
    deleteHistoryEntry(id)
    if (active?.id === id) setActive(null)
    refresh()
  }

  const filtered = filterByKind(entries, filter)

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">History</h1>
          </div>
          <p className="text-muted-foreground">Disimpan di browser kamu · auto-hapus setelah 72 jam.</p>
        </div>
        {entries.length > 0 && (
          <Button
            variant="outline"
            onClick={() => {
              if (confirm('Hapus semua history?')) {
                clearHistory()
                setActive(null)
                refresh()
              }
            }}
          >
            <Trash2 className="h-4 w-4" /> Clear all
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          ['all', 'Semua'],
          ['scale', 'Scale'],
          ['create', 'Create'],
          ['carousel', 'Carousel'],
        ] as const).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? 'default' : 'outline'}
            onClick={() => setFilter(key as any)}
          >
            {label}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          <History className="mx-auto mb-3 h-10 w-10 opacity-40" />
          <p>Belum ada history.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((e) => {
            const imgUrls = getImageUrls(e)
            const imgCount = imgUrls.length
            return (
              <Card
                key={e.id}
                className="cursor-pointer overflow-hidden transition-all hover:border-primary"
                onClick={() => setActive(e)}
              >
                <div className="relative aspect-video bg-muted">
                  {e.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.thumbnailUrl} alt={e.productName} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                      <ImageIcon className="h-8 w-8" />
                      {imgCount > 0 && <p className="text-xs">{imgCount} gambar</p>}
                    </div>
                  )}
                  <div className="absolute left-2 top-2">
                    <Badge variant={e.kind === 'scale' ? 'default' : 'secondary'}>
                      {e.kind === 'scale' && <Layers className="mr-1 h-3 w-3" />}
                      {(e.kind === 'create' || e.kind === 'carousel') && <Wand2 className="mr-1 h-3 w-3" />}
                      {e.kind}
                    </Badge>
                  </div>
                  {imgCount > 1 && (
                    <div className="absolute right-2 top-2">
                      <Badge variant="outline" className="bg-black/50 text-white border-none text-xs">
                        {imgCount} img
                      </Badge>
                    </div>
                  )}
                </div>
                <CardContent className="p-3">
                  <p className="truncate text-sm font-medium">{e.productName}</p>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{timeAgo(e.createdAt)}</span>
                    <span>·</span>
                    <span className="text-amber-600">{expiresIn(e.createdAt)}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-1">
                    {imgCount === 1 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          const slug = (e.productName || 'ad').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 30)
                          downloadUrl(imgUrls[0], `${slug}-${e.kind}.jpg`)
                        }}
                      >
                        <Download className="h-3 w-3" /> Download
                      </Button>
                    )}
                    {imgCount > 1 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          setActive(e)
                        }}
                      >
                        <Download className="h-3 w-3" /> {imgCount} gambar
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={(ev) => {
                        ev.stopPropagation()
                        if (confirm('Hapus item ini?')) remove(e.id)
                      }}
                    >
                      <Trash2 className="h-3 w-3" /> Hapus
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setActive(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-background p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">{active.productName}</h2>
                <p className="text-xs text-muted-foreground">
                  {active.kind} · {new Date(active.createdAt).toLocaleString('id-ID')}
                </p>
              </div>
              <Button variant="ghost" onClick={() => setActive(null)}>Tutup</Button>
            </div>
            <HistoryDetail entry={active} />
          </div>
        </div>
      )}
    </div>
  )
}

function HistoryDetail({ entry }: { entry: HistoryEntry }) {
  if (entry.kind === 'carousel') {
    const p = entry.payload
    return (
      <div className="mx-auto max-w-md">
        <CarouselViewer slides={p.slides || []} productName={p.productName || entry.productName} />
      </div>
    )
  }
  if (entry.kind === 'scale') {
    const p = entry.payload
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {(p.variations || []).map((v: any, i: number) => (
          <AdCard
            key={i}
            index={i}
            data={{
              badge: v.angle,
              headline: v.headline,
              subheadline: v.subheadline,
              bodyText: v.bodyText,
              cta: v.cta,
              imageUrl: v.imageUrl,
              videoJobId: v.videoJobId,
              imagePrompt: v.imagePrompt,
            }}
          />
        ))}
      </div>
    )
  }
  // create
  const p = entry.payload
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(p.results || []).map((r: any, i: number) => {
        const c = typeof r.copy === 'string' ? null : r.copy
        return (
          <AdCard
            key={i}
            index={i}
            data={{
              badge: `Variasi ${r.variationIndex}`,
              headline: c?.headline,
              subheadline: c?.subtext,
              cta: c?.cta || null,
              imageUrl: r.imageUrl,
              videoJobId: r.videoJobId,
              imagePrompt: r.imagePrompt,
            }}
          />
        )
      })}
    </div>
  )
}
