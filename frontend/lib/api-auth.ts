import api from './api'
import type { AuthUser } from './auth'

export async function register(payload: { name: string; email: string; password: string }) {
  const res = await api.post('/api/auth/register', payload)
  return res.data as { token: string; user: AuthUser }
}

export async function login(payload: { email: string; password: string }) {
  const res = await api.post('/api/auth/login', payload)
  return res.data as { token: string; user: AuthUser }
}

export async function getMe() {
  const res = await api.get('/api/auth/me')
  return res.data.user as AuthUser
}

export async function updateProfile(payload: { name?: string }) {
  const res = await api.patch('/api/auth/me', payload)
  return res.data.user as AuthUser
}

export async function changePassword(payload: { currentPassword: string; newPassword: string }) {
  const res = await api.post('/api/auth/change-password', payload)
  return res.data
}

// ─── Single Image Generator ────────────────────────────────────────

export interface SingleImageJob {
  id: string
  type: 'single_image'
  angle: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  resultUrl: string | null
  resultPrompt: string | null
  errorMessage: string | null
  durationMs: number | null
  costUsd: number | null
  inputPayload: any
  createdAt: string
  completedAt: string | null
}

export async function getSingleImageMeta() {
  const res = await api.get('/api/scale/single-image/angles')
  return res.data as { angles: string[]; formats: string[] }
}

export async function createSingleImageJob(payload: {
  angle: string
  productName: string
  copy: string
  cta: string
  format: string
}) {
  const res = await api.post('/api/scale/single-image', payload)
  return res.data as { jobId: string; status: string }
}

export async function getSingleImageJob(jobId: string) {
  const res = await api.get(`/api/scale/single-image/jobs/${jobId}`)
  return res.data as SingleImageJob
}

// ─── Library ────────────────────────────────────────────────────────

export interface LibraryItem {
  id: string
  type: 'single_image' | 'carousel' | 'video'
  angle: string | null
  title: string
  imageUrl: string | null
  videoUrl: string | null
  prompt: string | null
  copyHeadline: string | null
  copySubtext: string | null
  copyCta: string | null
  metadata: any
  createdAt: string
}

export async function listLibrary(filters?: { type?: string; angle?: string }) {
  const res = await api.get('/api/library', { params: filters })
  return res.data as { items: LibraryItem[]; total: number }
}

export async function saveToLibrary(payload: Partial<LibraryItem> & { type: string; title: string; jobId?: string }) {
  const res = await api.post('/api/library', payload)
  return res.data as { item: LibraryItem }
}

export async function deleteLibraryItem(id: string) {
  await api.delete(`/api/library/${id}`)
}

export async function getLibraryStats() {
  const res = await api.get('/api/library/stats/summary')
  return res.data as {
    totalItems: number
    totalJobs: number
    completedJobs: number
    totalCostUsd: number
    recentJobs: Array<{
      id: string
      type: string
      angle: string
      status: string
      resultUrl: string | null
      createdAt: string
    }>
  }
}
