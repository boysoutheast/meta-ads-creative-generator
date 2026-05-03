'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Image as ImageIcon, Wand2, Library as LibraryIcon, DollarSign, ChevronRight, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuthStore } from '@/lib/auth'
import { getLibraryStats } from '@/lib/api-auth'

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getLibraryStats>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setStats(await getLibraryStats())
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Gagal memuat statistik')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Halo, {user?.name || 'Creator'} 👋</h1>
          <p className="text-muted-foreground">Mulai generate creative ads kamu hari ini.</p>
        </div>
        <Button asChild size="lg">
          <Link href="/generate/single-image">
            Generate Baru <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error} <button onClick={load} className="ml-2 font-medium underline">Coba lagi</button>
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Library items" value={stats?.totalItems} icon={<LibraryIcon className="h-4 w-4" />} loading={loading} />
        <StatCard label="Total generations" value={stats?.totalJobs} icon={<ImageIcon className="h-4 w-4" />} loading={loading} />
        <StatCard label="Completed" value={stats?.completedJobs} icon={<Wand2 className="h-4 w-4" />} loading={loading} />
        <StatCard
          label="Total cost"
          value={stats ? `$${stats.totalCostUsd.toFixed(2)}` : undefined}
          icon={<DollarSign className="h-4 w-4" />}
          loading={loading}
        />
      </section>

      <section>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Recent activity</CardTitle>
                <CardDescription>5 generation terakhir</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/library">Lihat library <ChevronRight className="h-4 w-4" /></Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : !stats?.recentJobs?.length ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <p className="mb-3 text-sm text-muted-foreground">Belum ada activity. Generate creative pertamamu!</p>
                <Button asChild>
                  <Link href="/generate/single-image">Mulai generate</Link>
                </Button>
              </div>
            ) : (
              <ul className="divide-y">
                {stats.recentJobs.map((j) => (
                  <li key={j.id} className="flex items-center gap-3 py-3">
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted">
                      {j.resultUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={j.resultUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <ImageIcon className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{j.angle || j.type}</p>
                      <p className="text-xs text-muted-foreground">{new Date(j.createdAt).toLocaleString('id-ID')}</p>
                    </div>
                    <Badge variant={
                      j.status === 'completed' ? 'success' :
                      j.status === 'failed' ? 'destructive' :
                      j.status === 'processing' ? 'default' : 'secondary'
                    }>
                      {j.status === 'processing' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                      {j.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

function StatCard({ label, value, icon, loading }: { label: string; value?: number | string; icon: React.ReactNode; loading: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        {loading ? (
          <Skeleton className="mt-2 h-7 w-16" />
        ) : (
          <p className="mt-2 text-2xl font-bold tabular-nums">{value ?? 0}</p>
        )}
      </CardContent>
    </Card>
  )
}
