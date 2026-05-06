import type { HistoryEntry, HistoryKind } from './types'

const KEY = 'acg_history'
const MAX = 50
const TTL_MS = 72 * 60 * 60 * 1000 // 72 hours

export function purgeOldEntries(): void {
  if (typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return
    const cutoff = Date.now() - TTL_MS
    const pruned = parsed.filter((e: HistoryEntry) => e.createdAt > cutoff)
    if (pruned.length !== parsed.length) {
      window.localStorage.setItem(KEY, JSON.stringify(pruned))
    }
  } catch {
    // ignore
  }
}

export function loadHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    purgeOldEntries()
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveHistoryEntry(entry: Omit<HistoryEntry, 'id' | 'createdAt'>): HistoryEntry {
  const full: HistoryEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  }
  const list = [full, ...loadHistory()].slice(0, MAX)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(list))
    } catch {
      // quota exceeded — drop oldest until it fits
      while (list.length > 1) {
        list.pop()
        try {
          window.localStorage.setItem(KEY, JSON.stringify(list))
          break
        } catch {}
      }
    }
  }
  return full
}

export function deleteHistoryEntry(id: string) {
  if (typeof window === 'undefined') return
  const list = loadHistory().filter((e) => e.id !== id)
  window.localStorage.setItem(KEY, JSON.stringify(list))
}

export function clearHistory() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(KEY)
}

export function filterByKind(entries: HistoryEntry[], kind?: HistoryKind | 'all'): HistoryEntry[] {
  if (!kind || kind === 'all') return entries
  return entries.filter((e) => e.kind === kind)
}
