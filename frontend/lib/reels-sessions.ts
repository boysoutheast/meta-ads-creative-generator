// Shared localStorage helpers for Reels session history

export type StoredSession = {
  sessionId: string
  prompt: string
  mode: string
  duration: number
  totalClips: number
  createdAt: string
}

const SESSIONS_KEY = 'reels_sessions'

export function loadStoredSessions(): StoredSession[] {
  try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]') } catch { return [] }
}

export function pushStoredSession(s: Omit<StoredSession, 'createdAt'>) {
  try {
    const existing = loadStoredSessions().filter(x => x.sessionId !== s.sessionId)
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(
      [{ ...s, createdAt: new Date().toISOString() }, ...existing].slice(0, 30)
    ))
  } catch {}
}

export function removeStoredSession(sessionId: string) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(
      loadStoredSessions().filter(s => s.sessionId !== sessionId)
    ))
  } catch {}
}
