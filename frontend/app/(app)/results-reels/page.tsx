'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Film, Download, CheckCircle2, AlertCircle, Loader2,
  Clock, RefreshCw, Trash2, Plus, ChevronDown, ChevronRight,
  Clapperboard, Play,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getReelSession, startReelGeneration, type ReelsSSEEvent } from '@/lib/api'
import {
  type StoredSession,
  loadStoredSessions,
  pushStoredSession,
  removeStoredSession,
} from '@/lib/reels-sessions'

// ─── types ────────────────────────────────────────────────────────────────────

type ClipGenState = {
  index: number
  status: 'waiting' | 'generating' | 'retrying' | 'done' | 'error'
  pct: number
  videoUrl?: string | null
}

type MergePhase = 'idle' | 'downloading' | 'merging' | 'done'

// ─── localStorage key migration ───────────────────────────────────────────────

const OLD_SESSION_KEY = 'reels_session_id'

// ─── helpers ──────────────────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

const MODE_LABELS: Record<string, string> = {
  'normal': 'Normal',
  'extremely-crazy': 'Extremely Crazy',
  'extremely-spicy-or-crazy': 'Extremely Spicy',
  'custom': 'Custom',
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function getStatusConfig(status: string, downloadReady: boolean) {
  if (downloadReady || status === 'done') return {
    label: 'Done', variant: 'outline' as const,
    bg: 'bg-green-100 dark:bg-green-900/30',
    icon: <CheckCircle2 className="h-4 w-4 text-green-600" />,
    textColor: 'text-green-700 dark:text-green-400',
  }
  switch (status) {
    case 'loading': return { label: 'Loading…', variant: 'secondary' as const, bg: 'bg-muted', icon: <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />, textColor: 'text-muted-foreground' }
    case 'reviewing': return { label: 'Ready to start', variant: 'secondary' as const, bg: 'bg-blue-100 dark:bg-blue-900/30', icon: <Play className="h-4 w-4 text-blue-600" />, textColor: 'text-blue-700 dark:text-blue-400' }
    case 'generating': return { label: 'Generating', variant: 'default' as const, bg: 'bg-primary/10', icon: <Loader2 className="h-4 w-4 animate-spin text-primary" />, textColor: 'text-primary' }
    case 'merging': return { label: 'Merging', variant: 'default' as const, bg: 'bg-primary/10', icon: <Loader2 className="h-4 w-4 animate-spin text-primary" />, textColor: 'text-primary' }
    case 'partial': return { label: 'Partial', variant: 'secondary' as const, bg: 'bg-amber-100 dark:bg-amber-900/30', icon: <RefreshCw className="h-4 w-4 text-amber-600" />, textColor: 'text-amber-700' }
    case 'error': return { label: 'Error', variant: 'destructive' as const, bg: 'bg-destructive/10', icon: <AlertCircle className="h-4 w-4 text-destructive" />, textColor: 'text-destructive' }
    case 'not_found': return { label: 'Expired', variant: 'outline' as const, bg: 'bg-muted', icon: <Clock className="h-4 w-4 text-muted-foreground" />, textColor: 'text-muted-foreground' }
    default: return { label: status || '…', variant: 'outline' as const, bg: 'bg-muted', icon: <Film className="h-4 w-4 text-muted-foreground" />, textColor: 'text-muted-foreground' }
  }
}

// ─── root page ────────────────────────────────────────────────────────────────

export default function ResultsReelsPage() {
  const router = useRouter()
  const [sessions, setSessions] = useState<StoredSession[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    // Migrate old single-session key → new array format
    try {
      const oldId = localStorage.getItem(OLD_SESSION_KEY)
      if (oldId) {
        const existing = loadStoredSessions()
        if (!existing.find(s => s.sessionId === oldId)) {
          pushStoredSession({ sessionId: oldId, prompt: 'Session resumed', mode: 'normal', duration: 30, totalClips: 3 })
        }
        localStorage.removeItem(OLD_SESSION_KEY)
      }
    } catch {}

    setSessions(loadStoredSessions())
    setLoaded(true)
  }, [])

  function handleRemove(sessionId: string) {
    removeStoredSession(sessionId)
    setSessions(prev => prev.filter(s => s.sessionId !== sessionId))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Clapperboard className="h-6 w-6 text-primary" />
            Results Reels
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track AI reel generations — live progress, download, history.
          </p>
        </div>
        <Button onClick={() => router.push('/reels')}>
          <Plus className="mr-2 h-4 w-4" />
          New Reel
        </Button>
      </div>

      {/* Empty state */}
      {loaded && sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-muted py-20 text-center">
          <Film className="mb-4 h-12 w-12 text-muted-foreground/30" />
          <p className="text-base font-semibold text-muted-foreground">No reels yet</p>
          <p className="mt-1 text-sm text-muted-foreground/60">Your generated reels will appear here.</p>
          <Button className="mt-5" onClick={() => router.push('/reels')}>
            <Plus className="mr-2 h-4 w-4" />
            Create AI Reel
          </Button>
        </div>
      )}

      {/* Session cards */}
      <div className="space-y-4">
        {sessions.map(stored => (
          <SessionCard
            key={stored.sessionId}
            stored={stored}
            onRemove={() => handleRemove(stored.sessionId)}
          />
        ))}
      </div>
    </div>
  )
}

// ─── SessionCard ──────────────────────────────────────────────────────────────

function SessionCard({ stored, onRemove }: { stored: StoredSession; onRemove: () => void }) {
  const n = stored.totalClips

  const [status, setStatus] = useState<string>('loading')
  const [genClips, setGenClips] = useState<ClipGenState[]>([])
  const [mergePhase, setMergePhase] = useState<MergePhase>('idle')
  const [mergeProgress, setMergeProgress] = useState(0)
  const [downloadReady, setDownloadReady] = useState(false)
  const [mergedHash, setMergedHash] = useState<string | null>(null)
  const [sizeBytes, setSizeBytes] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)
  const sseStarted = useRef(false)

  const handleSSE = useCallback((evt: ReelsSSEEvent) => {
    switch (evt.type) {
      case 'start':
        setStatus('generating')
        setGenClips(prev =>
          prev.length > 0 ? prev :
          Array.from({ length: evt.totalClips || n }, (_, i) => ({
            index: i, status: i === 0 ? 'generating' : 'waiting', pct: 0,
          } as ClipGenState))
        )
        break
      case 'clip_skip':
        setGenClips(prev => prev.map(c =>
          c.index === evt.clipIndex ? { ...c, status: 'done', pct: 100 } : c
        ))
        break
      case 'clip_start':
        setStatus('generating')
        setGenClips(prev => prev.map(c =>
          c.index === evt.clipIndex ? { ...c, status: 'generating', pct: 0 } : c
        ))
        break
      case 'clip_progress':
        setGenClips(prev => prev.map(c =>
          c.index === evt.clipIndex ? { ...c, pct: evt.pct, status: 'generating' } : c
        ))
        break
      case 'clip_retry':
        setGenClips(prev => prev.map(c =>
          c.index === evt.clipIndex ? { ...c, status: 'retrying', pct: 0 } : c
        ))
        break
      case 'clip_done':
        setGenClips(prev => prev.map(c => {
          if (c.index === evt.clipIndex) return { ...c, status: 'done', pct: 100, videoUrl: evt.clip?.videoUrl }
          if (c.index === evt.clipIndex + 1) return { ...c, status: 'generating' }
          return c
        }))
        break
      case 'merge_start':
        setStatus('merging')
        setMergePhase('downloading')
        break
      case 'merge_progress':
        if (evt.phase === 'downloading') setMergePhase('downloading')
        if (evt.phase === 'merging') { setMergePhase('merging'); setMergeProgress(evt.progress || 0) }
        break
      case 'ready':
        setStatus('done')
        setMergePhase('done')
        setDownloadReady(true)
        setMergedHash(evt.mergedHash || null)
        setSizeBytes(evt.sizeBytes || null)
        break
      case 'error':
        setStatus('error')
        setError(evt.message)
        break
    }
  }, [n])

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const s = await getReelSession(stored.sessionId)
        if (cancelled) return

        if (!s) { setStatus('not_found'); return }

        setStatus(s.status)

        // Hydrate clips from saved session state
        const clips: ClipGenState[] = Array.from({ length: n }, (_, i) => {
          const saved = (s.clips || []).find((c: any) => c.index === i)
          return {
            index: i,
            status: saved?.status === 'done' ? 'done' : 'waiting',
            pct: saved?.status === 'done' ? 100 : 0,
            videoUrl: saved?.videoUrl ?? null,
          }
        })
        setGenClips(clips)

        if (s.downloadReady) {
          setDownloadReady(true)
          setMergePhase('done')
          setSizeBytes(s.sizeBytes ?? null)
          setMergedHash(s.mergedHash ?? null)
          return
        }

        // Auto-start / reconnect SSE only for sessions already in generation — NOT reviewing/storyboard_built
        const active = ['generating', 'partial']
        if (active.includes(s.status) && !sseStarted.current) {
          sseStarted.current = true
          setStatus('generating')
          startReelGeneration(stored.sessionId, handleSSE).catch(err => {
            if (!cancelled) { setStatus('error'); setError(err.message) }
          })
        }
      } catch (err: any) {
        if (!cancelled) { setStatus('error'); setError(err.message) }
      }
    }

    init()
    return () => { cancelled = true }
  }, [stored.sessionId, n, handleSSE])

  const doneClips = genClips.filter(c => c.status === 'done').length
  const cfg = getStatusConfig(status, downloadReady)
  const isActive = ['generating', 'merging', 'loading'].includes(status) && !downloadReady

  function handleStart() {
    if (sseStarted.current) return
    sseStarted.current = true
    setStatus('generating')
    setError(null)
    startReelGeneration(stored.sessionId, handleSSE).catch(err => {
      setStatus('error')
      setError(err.message)
    })
  }

  return (
    <Card className={`transition-all ${downloadReady ? 'border-green-200 dark:border-green-800' : ''}`}>
      <CardHeader className="pb-0 pt-4">
        <div className="flex items-start gap-3">
          {/* Status icon bubble */}
          <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${cfg.bg}`}>
            {cfg.icon}
          </div>

          {/* Session info */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              <Badge variant={cfg.variant} className={`text-[11px] ${cfg.textColor}`}>
                {cfg.label}
                {isActive && doneClips > 0 && ` · ${doneClips}/${n} clips`}
              </Badge>
              <span className="text-xs text-muted-foreground">{MODE_LABELS[stored.mode] || stored.mode}</span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">{stored.duration}s · {stored.totalClips} clips</span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">{formatRelativeTime(stored.createdAt)}</span>
            </div>
            <p className="text-sm font-medium leading-snug line-clamp-2 text-foreground/90">
              {stored.prompt}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex shrink-0 items-center gap-1">
            {status === 'reviewing' && !downloadReady && (
              <Button
                size="sm"
                className="h-8 bg-blue-600 hover:bg-blue-700 text-white text-xs"
                onClick={handleStart}
              >
                <Play className="mr-1.5 h-3.5 w-3.5" />
                Start Generation
              </Button>
            )}
            {status === 'partial' && !downloadReady && (
              <Button
                size="sm"
                className="h-8 bg-amber-600 hover:bg-amber-700 text-white text-xs"
                onClick={handleStart}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Resume
              </Button>
            )}
            {downloadReady && (
              <Button
                size="sm"
                className="h-8 bg-green-600 hover:bg-green-700 text-xs"
                onClick={() => window.open(`${API_URL}/api/reels/download/${stored.sessionId}`, '_blank')}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download
              </Button>
            )}
            <Button
              variant="ghost" size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={onRemove}
              title="Remove from list"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost" size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={() => setExpanded(p => !p)}
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-3 pb-4">
          {/* Error */}
          {error && (
            <div className="mb-3 flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Clip progress rows */}
          {genClips.length > 0 && (
            <div className="space-y-1.5">
              {genClips.map(c => (
                <ProgressRow
                  key={c.index}
                  label={`Clip ${c.index + 1}/${n}`}
                  status={c.status}
                  pct={c.pct}
                />
              ))}

              {mergePhase !== 'idle' && (
                <>
                  <div className="my-2 border-t" />
                  <ProgressRow
                    label="Downloading clips"
                    status={mergePhase === 'downloading' ? 'generating' : 'done'}
                    pct={mergePhase === 'merging' || mergePhase === 'done' ? 100 : 40}
                  />
                  <ProgressRow
                    label="Merging video"
                    status={mergePhase === 'merging' ? 'generating' : mergePhase === 'done' ? 'done' : 'waiting'}
                    pct={mergePhase === 'merging' ? mergeProgress : mergePhase === 'done' ? 100 : 0}
                  />
                  <ProgressRow
                    label="Download ready"
                    status={downloadReady ? 'done' : 'waiting'}
                    pct={downloadReady ? 100 : 0}
                  />
                </>
              )}
            </div>
          )}

          {/* Done info */}
          {downloadReady && (
            <div className="mt-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-500">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>
                  {sizeBytes ? `${(sizeBytes / 1_048_576).toFixed(1)} MB` : 'Ready'}
                  {mergedHash && <> · SHA256: {mergedHash.slice(0, 16)}…</>}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Re-downloadable for 48h · Clips deleted after merge</p>
            </div>
          )}

          {/* Loading / reviewing / not found */}
          {status === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
              <Loader2 className="h-4 w-4 animate-spin" />Checking session…
            </div>
          )}
          {status === 'reviewing' && (
            <div className="flex items-start gap-2 rounded-md bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-xs text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
              <Play className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Storyboard is ready. Click <span className="font-semibold">Start Generation</span> above to begin video clip generation. This may take 5-10 minutes.</span>
            </div>
          )}
          {status === 'partial' && !downloadReady && (
            <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
              <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Some clips failed. Click <span className="font-semibold">Resume</span> to retry the failed clips.</span>
            </div>
          )}
          {status === 'not_found' && (
            <p className="text-sm text-muted-foreground py-1">Session expired or not found on server (24h TTL).</p>
          )}
        </CardContent>
      )}
    </Card>
  )
}

// ─── ProgressRow ──────────────────────────────────────────────────────────────

function ProgressRow({ label, status, pct }: {
  label: string
  status: 'waiting' | 'generating' | 'retrying' | 'done' | 'error'
  pct: number
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-4 shrink-0">
        {status === 'done'      && <CheckCircle2 className="h-4 w-4 text-green-500" />}
        {status === 'generating' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
        {status === 'retrying'  && <RefreshCw className="h-4 w-4 animate-spin text-amber-500" />}
        {status === 'waiting'   && <Clock className="h-4 w-4 text-muted-foreground/40" />}
        {status === 'error'     && <AlertCircle className="h-4 w-4 text-destructive" />}
      </div>
      <span className="w-36 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            status === 'done'       ? 'bg-green-500' :
            status === 'generating' ? 'bg-primary' :
            status === 'retrying'   ? 'bg-amber-500' :
            status === 'error'      ? 'bg-destructive' : 'bg-transparent'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {status === 'done' ? '100%' : status === 'waiting' ? '' : `${Math.round(pct)}%`}
      </span>
    </div>
  )
}
