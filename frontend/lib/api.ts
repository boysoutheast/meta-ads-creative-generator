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
  const res = await api.get<{ products: Product[] }>('/api/products')
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
  const res = await api.post<{ product: Product }>('/api/products', fd, {
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
  const res = await api.put<{ product: Product }>(`/api/products/${id}`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data.product
}

export async function deleteProduct(id: string): Promise<void> {
  await api.delete(`/api/products/${id}`)
}
