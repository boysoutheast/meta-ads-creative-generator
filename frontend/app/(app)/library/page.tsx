'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Library as LibraryIcon, Trash2, Download, Image as ImageIcon, RefreshCw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { listLibrary, deleteLibraryItem, type LibraryItem } from '@/lib/api-auth'

const TYPES = ['all', 'single_image', 'carousel', 'video'] as const

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

export default function LibraryPage() {
  const [items, setItems] = useState<LibraryItem[]>([])
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState<(typeof TYPES)[number]>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listLibrary(filter !== 'all' ? { type: filter } : undefined)
      setItems(data.items)
      setTotal(data.total)
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Gagal memuat library')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [filter])

  const handleDelete = async (item: LibraryItem) => {
    if (!confirm(`Hapus "${item.title}"? Tindakan ini bisa di-restore admin.`)) return
    setDeletingId(item.id)
    try {
      await deleteLibraryItem(item.id)
      toast.success('Item dihapus')
      setItems((prev) => prev.filter((i) => i.id !== item.id))
      setTotal((t) => t - 1)
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Gagal menghapus')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-1 inline-flex items-center gap-2">
            <LibraryIcon className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Library</h1>
          </div>
          <p className="text-muted-foreground">{total} item tersimpan</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => <SelectItem key={t} value={t}>{t === 'all' ? 'Semua tipe' : t.replace('_', ' ')}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={load} disabled={loading} aria-label="Reload">
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error} <button onClick={load} className="ml-2 font-medium underline">Coba lagi</button>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <Skeleton className="aspect-square w-full" />
              <CardContent className="space-y-2 p-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <ImageIcon className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="mb-4 text-muted-foreground">Library masih kosong.</p>
          <Button asChild>
            <Link href="/generate/single-image">Mulai generate</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const isVideo = item.type === 'video' || !!item.videoUrl
            const downloadUrl = item.videoUrl || item.imageUrl
            const downloadExt = isVideo ? 'mp4' : 'png'
            return (
              <Card key={item.id} className="overflow-hidden">
                <div className="relative aspect-square bg-muted">
                  {isVideo && item.videoUrl ? (
                    <video
                      src={item.videoUrl}
                      controls
                      playsInline
                      className="h-full w-full object-cover"
                    />
                  ) : item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <ImageIcon className="h-8 w-8" />
                    </div>
                  )}
                  {item.angle && (
                    <div className="absolute left-2 top-2"><Badge>{item.angle}</Badge></div>
                  )}
                  {isVideo && (
                    <div className="absolute right-2 top-2">
                      <Badge variant="secondary" className="bg-black/60 text-white border-none text-xs">
                        Video
                      </Badge>
                    </div>
                  )}
                </div>
                <CardContent className="space-y-2 p-3">
                  <p className="truncate text-sm font-semibold" title={item.title}>{item.title}</p>
                  <p className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString('id-ID')}</p>
                  <div className="flex gap-2 pt-1">
                    {downloadUrl && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => downloadFromUrl(downloadUrl, `${item.title.replace(/\s+/g, '-')}.${downloadExt}`)}
                      >
                        <Download className="h-4 w-4" /> Download
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(item)}
                      disabled={deletingId === item.id}
                      aria-label="Delete"
                    >
                      {deletingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
