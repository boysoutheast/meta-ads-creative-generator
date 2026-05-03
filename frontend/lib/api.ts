import axios from 'axios'
import type {
  AspectRatio,
  AnalyzeWinningResponse,
  GenerateVariationsResponse,
  ReferenceAnalysis,
  ProductInfo,
  CreateGenerateResponse,
  CarouselResponse,
  Language,
  ScalingAngle,
} from './types'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

const api = axios.create({
  baseURL: API_URL,
  timeout: 180000,
})

// ─── Health ─────────────────────────────────────────────────────────────────

export async function healthCheck() {
  const res = await api.get('/health')
  return res.data
}

// ─── Scale ──────────────────────────────────────────────────────────────────

export async function getScalingAngles(): Promise<{ angles: Record<string, { label: string; hook: string }> }> {
  const res = await api.get('/api/scale/angles')
  return res.data
}

export async function analyzeWinningAd(file: File): Promise<AnalyzeWinningResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await api.post('/api/scale/analyze-winning', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export async function generateScalingVariations(payload: {
  analysis: any
  productName: string
  selectedAngles: string[]
  aspectRatio: AspectRatio
  generateImages: boolean
}): Promise<GenerateVariationsResponse> {
  const res = await api.post('/api/scale/generate-variations', payload)
  return res.data
}

export async function generateScaleImage(prompt: string, aspectRatio: AspectRatio = '1:1') {
  const res = await api.post('/api/scale/generate-image', { prompt, aspectRatio })
  return res.data as { images: { url: string }[]; prompt: string }
}

export async function generateScaleVideo(
  prompt: string,
  aspectRatio: AspectRatio = '9:16',
  duration = 5
) {
  const res = await api.post('/api/scale/generate-video', { prompt, aspectRatio, duration })
  return res.data
}

// ─── Create with reference ──────────────────────────────────────────────────

export async function analyzeReference(file: File): Promise<{
  analysis: ReferenceAnalysis
  filename: string
}> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await api.post('/api/create/analyze-reference', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export async function generateCreateAd(payload: {
  referenceAnalysis: ReferenceAnalysis
  productInfo: ProductInfo
  format: AspectRatio
  outputType: 'image' | 'video'
  language: Language
  variations: number
  generateImages: boolean
}): Promise<CreateGenerateResponse> {
  const res = await api.post('/api/create/generate', payload)
  return res.data
}

export async function generateCreateCarousel(payload: {
  referenceAnalysis: ReferenceAnalysis
  productInfo: ProductInfo
  slideCount: number
  language: Language
  generateImages: boolean
}): Promise<CarouselResponse> {
  const res = await api.post('/api/create/carousel', payload)
  return res.data
}

export default api
