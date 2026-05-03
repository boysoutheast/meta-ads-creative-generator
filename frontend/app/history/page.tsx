'use client'
import { useEffect, useState } from 'react'
import { History, Trash2, Layers, Wand2, ImageIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CarouselViewer } from '@/components/ads/CarouselViewer'
import { AdCard } from '@/components/ads/AdCard'
import { loadHistory, deleteHistoryEntry, clearHistory, filterByKind } from '@/lib/history'
import type { HistoryEntry, HistoryKind } from '@/lib/types'

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
          <p className="text-muted-foreground">Disimpan di browser kamu (max 50 item).</p>
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
          {filtered.map((e) => (
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
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <ImageIcon className="h-8 w-8" />
                  </div>
                )}
                <div className="absolute left-2 top-2">
                  <Badge variant={e.kind === 'scale' ? 'default' : 'secondary'}>
                    {e.kind === 'scale' && <Layers className="mr-1 h-3 w-3" />}
                    {(e.kind === 'create' || e.kind === 'carousel') && <Wand2 className="mr-1 h-3 w-3" />}
                    {e.kind}
                  </Badge>
                </div>
              </div>
              <CardContent className="p-3">
                <p className="truncate text-sm font-medium">{e.productName}</p>
                <p className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString('id-ID')}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2 h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={(ev) => {
                    ev.stopPropagation()
                    if (confirm('Hapus item ini?')) remove(e.id)
                  }}
                >
                  <Trash2 className="h-3 w-3" /> Hapus
                </Button>
              </CardContent>
            </Card>
          ))}
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
