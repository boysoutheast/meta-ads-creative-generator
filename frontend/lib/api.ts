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
  ScaleCarouselResponse,
  ScaleVideoJobResponse,
  ScaleVideoStatus,
} from './types'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
const API_URL = BASE_URL + '/api'

const api = axios.create({
  baseURL: API_URL,
  timeout: 180000,
})

// Auto-retry on 5xx / network errors (max 2 retries, exponential backoff)
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error.response?.status
    const cfg = error.config
    if (!cfg || (cfg._retry ?? 0) >= 2) return Promise.reject(error)
    if (status && status < 500 && status !== 429) return Promise.reject(error)
    cfg._retry = (cfg._retry ?? 0) + 1
    await new Promise((r) => setTimeout(r, 1000 * cfg._retry))
    return api(cfg)
  }
)

// ─── Health ─────────────────────────────────────────────────────────────────

export async function healthCheck() {
  // /health is NOT under /api — call it directly
  const res = await axios.get(`${BASE_URL}/health`, { timeout: 10000 })
  return res.data
}

// ─── Scale ──────────────────────────────────────────────────────────────────

export async function getScalingAngles(): Promise<{ angles: Record<string, { label: string; hook: string }> }> {
  const res = await api.get('/scale/angles')
  return res.data
}

export async function analyzeWinningAd(file: File): Promise<AnalyzeWinningResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await api.post('/scale/analyze-winning', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export async function generateScalingVariations(payload: {
  analysis: any
  productName: string
  productDescription?: string
  selectedAngles: string[]
  aspectRatio: AspectRatio
  generateImages: boolean
  productPhotoBase64?: string
  productPhotoMime?: string
}): Promise<GenerateVariationsResponse> {
  const res = await api.post('/scale/generate-variations', payload)
  return res.data
}

export async function generateScaleCarousel(payload: {
  analysis: any
  productName: string
  productDescription?: string
  productVisualDescription?: string
  slideCount: number
  aspectRatio?: string
  generateImages?: boolean
  productPhotoBase64?: string
  productPhotoMime?: string
}): Promise<ScaleCarouselResponse> {
  const res = await api.post('/scale/generate-carousel', payload)
  return res.data
}

export async function analyzeWinningVideo(file: File) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await api.post('/scale-video/analyze', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data as { analysis: any; framesAnalyzed: number; filename: string }
}

export async function generateScaleVideoJob(payload: {
  videoAnalysis: any
  productName: string
  productDescription?: string
  productPhotoBase64?: string
  aspectRatio?: string
  duration?: number
}): Promise<ScaleVideoJobResponse> {
  const res = await api.post('/scale-video/generate', payload)
  return res.data
}

export async function getScaleVideoStatus(taskId: string): Promise<ScaleVideoStatus> {
  const res = await api.get(`/scale-video/status/${taskId}`)
  return res.data
}

export async function generateScaleImage(prompt: string, aspectRatio: AspectRatio = '1:1') {
  const res = await api.post('/scale/generate-image', { prompt, aspectRatio })
  return res.data as { images: { url: string }[]; prompt: string }
}

export async function generateScaleVideo(
  prompt: string,
  aspectRatio: AspectRatio = '9:16',
  duration = 5
) {
  const res = await api.post('/scale/generate-video', { prompt, aspectRatio, duration })
  return res.data
}

// ─── Create with reference ──────────────────────────────────────────────────

export async function analyzeReference(file: File): Promise<{
  analysis: ReferenceAnalysis
  filename: string
}> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await api.post('/create/analyze-reference', formData, {
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
  const res = await api.post('/create/generate', payload)
  return res.data
}

export async function generateCreateCarousel(payload: {
  referenceAnalysis: ReferenceAnalysis
  productInfo: ProductInfo
  slideCount: number
  language: Language
  generateImages: boolean
}): Promise<CarouselResponse> {
  const res = await api.post('/create/carousel', payload)
  return res.data
}

export default api

// ─── Products ───────────────────────────────────────────────────────────────

export interface Product {
  id: string
  name: string
  description?: string
  texture?: string
  photos?: string[]
  price?: number
  promoPrice?: number
  createdAt: string
}

export async function getProducts(): Promise<Product[]> {
  const res = await api.get<{ products: Product[] }>('/products')
  return res.data.products
}

export async function createProduct(data: {
  name: string
  description?: string
  texture?: string
  price?: number
  promoPrice?: number
  photos?: File[]
}): Promise<Product> {
  const fd = new FormData()
  fd.append('name', data.name)
  if (data.description) fd.append('description', data.description)
  if (data.texture) fd.append('texture', data.texture)
  if (data.price !== undefined) fd.append('price', String(data.price))
  if (data.promoPrice !== undefined) fd.append('promoPrice', String(data.promoPrice))
  data.photos?.forEach((f) => fd.append('photos', f))
  const res = await api.post<{ product: Product }>('/products', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data.product
}

export async function updateProduct(
  id: string,
  data: {
    name?: string
    description?: string
    texture?: string
    price?: number
    promoPrice?: number
    photos?: File[]
  }
): Promise<Product> {
  const fd = new FormData()
  if (data.name) fd.append('name', data.name)
  if (data.description !== undefined) fd.append('description', data.description)
  if (data.texture !== undefined) fd.append('texture', data.texture)
  if (data.price !== undefined) fd.append('price', String(data.price))
  if (data.promoPrice !== undefined) fd.append('promoPrice', String(data.promoPrice))
  data.photos?.forEach((f) => fd.append('photos', f))
  const res = await api.put<{ product: Product }>(`/products/${id}`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data.product
}

export async function deleteProduct(id: string): Promise<void> {
  await api.delete(`/products/${id}`)
}
