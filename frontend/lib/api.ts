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
  StartRemakeResponse,
  RemakeJobResponse,
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

export type StreamEvent =
  | { type: 'status'; message: string }
  | { type: 'start'; totalImages: number; totalAngles: number }
  | { type: 'progress'; completed: number; total: number; angle: string; headline: string }
  | { type: 'done' } & GenerateVariationsResponse
  | { type: 'error'; message: string }

/**
 * Streaming version of generateScalingVariations — uses SSE so the frontend
 * receives live progress events as each image finishes.
 */
export async function generateScalingVariationsStream(
  payload: Parameters<typeof generateScalingVariations>[0],
  onEvent: (event: StreamEvent) => void,
): Promise<GenerateVariationsResponse> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 600000) // 10 min

  try {
    const response = await fetch(`${API_URL}/scale/generate-variations-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${text}`)
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let result: GenerateVariationsResponse | null = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE messages are separated by \n\n
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''

      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6)) as StreamEvent
            onEvent(evt)
            if (evt.type === 'done') result = evt as unknown as GenerateVariationsResponse
            if (evt.type === 'error') throw new Error(evt.message)
          } catch (parseErr) {
            if ((parseErr as Error).message && !(parseErr as Error).message.includes('JSON')) throw parseErr
          }
        }
      }
    }

    if (!result) throw new Error('Stream ended unexpectedly without a result')
    return result
  } finally {
    clearTimeout(timeoutId)
  }
}

// ─── AI Reels v2 — session-based storyboard + generation ─────────────────────

export type ReelsClip = {
  uuid: string
  videoUrl: string | null
  thumbnailUrl: string | null
}

export type TechnicalConfig = {
  mainSubject: string
  // Power template fields (new — rich storyboard detail)
  characterDesign: string    // exact character visual: outfit, accessories, colors
  productDesign: string      // exact product: container color/finish, label, content
  worldBuilding: string      // environment name + atmosphere + bg elements
  sceneFlow: string          // Opening beat | Mid beat | Close beat
  action: string             // primary physical movement
  effects: string            // glow color + particle type + environment reaction
  colorPalette: string       // primary + secondary + accent + bg colors
  // Legacy fields (kept for backward compat)
  setting?: string
  lighting: string
  visualStyle: string
  cameraShot: string
  additionalDetails: string
  // Audio dimension fields
  voType?: ReelsVoType       // narration | dialogue | asmr | demo | story
  voiceType?: string         // voice personality / character name + accent
  soundDesign?: string       // ASMR sound design description
  ambientSounds?: string     // background audio description
}

export type PublicClip = {
  clipNumber: number
  visualSummary: string
  voScript: string
  grokPrompt: string
  sceneImageUrl: string | null   // generated by gpt-image-2, shows what the scene looks like
  technicalConfig: TechnicalConfig
}

export type ReferenceImageInput = {
  label: string
  dataUrl: string  // data:image/...;base64,...
}

export type ReelsSSEEvent =
  | { type: 'start'; totalClips: number; sessionId: string }
  | { type: 'clip_skip'; clipIndex: number; totalClips: number; uuid: string }
  | { type: 'clip_start'; clipIndex: number; totalClips: number }
  | { type: 'clip_progress'; clipIndex: number; pct: number; totalClips: number }
  | { type: 'clip_retry'; clipIndex: number; attempt: number; error: string }
  | { type: 'clip_done'; clipIndex: number; clip: ReelsClip; totalClips: number }
  | { type: 'merge_start'; totalClips: number }
  | { type: 'merge_progress'; phase: string; progress?: number; clipIndex?: number; total?: number }
  | { type: 'ready'; sessionId: string; mergedHash: string; sizeBytes: number | null; downloadUrl: string }
  | { type: 'error'; message: string; resumable?: boolean; failedAtClip?: number; sessionId?: string }

export type ReelsAspectRatio = 'portrait' | 'landscape' | 'square' | 'vertical' | 'horizontal'
export type ReelsResolution = '480p' | '720p'
export type ReelsClipDuration = 6 | 10 | 15
export type ReelsVoType = 'narration' | 'dialogue' | 'asmr' | 'demo' | 'story'
export type ReelsVisualStyle = 'premium_3d' | 'realistic' | 'anime' | 'cinematic' | 'cartoon' | 'ghibli' | 'makoto_shinkai' | 'chibi' | 'pixel_art' | 'chinese_cg'
export type ReelsProjectType = 'default' | 'story' | 'product_promo' | 'digital_human'
export type ReelsOutputLanguage = 'id' | 'en' | 'th' | 'vi' | 'zh' | 'hi' | 'es' | 'pt' | 'ar' | 'ko' | 'ja'
export type ReelsExportResolution = '720p' | '1080p' | '4k'
export type ReelsTTSVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'
export type ReelsTransition = 'cut' | 'fade' | 'dissolve' | 'wipeleft' | 'zoom'

/** Step 1 — GPT-4o builds storyboard, creates session */
export async function buildStoryboard(payload: {
  prompt: string
  mode: string
  duration: number
  aspectRatio?: ReelsAspectRatio
  resolution?: ReelsResolution
  clipDuration?: ReelsClipDuration
  voType?: ReelsVoType
  visualStyle?: ReelsVisualStyle
  projectType?: ReelsProjectType
  outputLanguage?: ReelsOutputLanguage
  scriptText?: string | null
  referenceImages?: ReferenceImageInput[]
  // Feature 4: pin one of the uploaded refs (by index) as main character
  pinnedCharacterIndex?: number | null
  // Feature 7: TTS auto-dub
  enableTTS?: boolean
  ttsVoice?: ReelsTTSVoice
  // Feature 9: export resolution
  exportResolution?: ReelsExportResolution
}): Promise<{
  sessionId: string
  storyboard: PublicClip[]
  referenceImageUrls: { tag: string; label: string }[]
}> {
  const res = await api.post('/reels/build-storyboard', payload)
  return res.data
}

/** Step 1b — generate scene preview images for each storyboard clip (gpt-image-2) */
export async function generateSceneImages(payload: {
  sessionId: string
  fromIndex?: number  // only regenerate from this clip onwards (used after refresh)
}): Promise<{
  sceneImages: { clipNumber: number; sceneImageUrl: string | null; error?: string | null }[]
}> {
  const res = await api.post('/reels/generate-scene-images', payload)
  return res.data
}

/** Step 2 — refresh clips from index onwards (keep 0..fromIndex-1) */
export async function refreshClips(payload: {
  sessionId: string
  fromIndex: number
  hint?: string
}): Promise<{ storyboard: PublicClip[] }> {
  const res = await api.post('/reels/refresh-clips', payload)
  return res.data
}

/** Inline edit a storyboard clip's text fields (no regeneration) */
export async function editClip(payload: {
  sessionId: string
  clipIndex: number
  visualSummary?: string
  voScript?: string
}): Promise<{ clipNumber: number; visualSummary: string; voScript: string }> {
  const res = await api.post('/reels/edit-clip', payload)
  return res.data
}

/** Generate 5 A/B hook variants for clip 1 */
export async function generateHooks(payload: {
  sessionId?: string
  brief?: string
}): Promise<{
  hooks: Array<{
    type: string
    label: string
    voScript: string
    opening: string
    angle: string
  }>
}> {
  const res = await api.post('/reels/generate-hooks', payload)
  return res.data
}

// ─── Feature 3 — Product URL scraper ────────────────────────────────────────
export async function scrapeProductUrl(url: string): Promise<{
  product: {
    productName?: string
    brand?: string
    price?: string
    currency?: string
    features?: string[]
    description?: string
    targetAudience?: string
  }
  brief: string
  imageUrl: string | null
}> {
  const res = await api.post('/reels/scrape-product', { url })
  return res.data
}

// ─── Feature 5 — AI Script Expander ─────────────────────────────────────────
export async function expandScript(payload: {
  brief: string
  projectType?: ReelsProjectType
  clipCount?: number
  outputLanguage?: ReelsOutputLanguage
}): Promise<{ expandedScript: string; clipCount: number }> {
  const res = await api.post('/reels/expand-script', payload)
  return res.data
}

// ─── Feature 6 — Subtitles SRT download URL ─────────────────────────────────
export function getSubtitleDownloadUrl(sessionId: string): string {
  return `${API_URL}/reels/${sessionId}/subtitles`
}

// ─── Feature 8 — Build 3 storyboard variants ────────────────────────────────
export async function buildStoryboardVariants(payload: {
  prompt: string
  mode?: string
  duration?: number
  aspectRatio?: ReelsAspectRatio
  resolution?: ReelsResolution
  clipDuration?: ReelsClipDuration
  voType?: ReelsVoType
  visualStyle?: ReelsVisualStyle
  projectType?: ReelsProjectType
  outputLanguage?: ReelsOutputLanguage
  scriptText?: string | null
  referenceImages?: ReferenceImageInput[]
}): Promise<{
  variants: Array<{ label: string; key: string; sessionId: string; storyboard: PublicClip[] }>
  errors?: Array<{ error: string }>
}> {
  const res = await api.post('/reels/build-storyboard-variants', payload, { timeout: 240000 })
  return res.data
}

// ─── Feature 10 — Per-clip reference override ───────────────────────────────
export async function setClipReferences(sessionId: string, clipIndex: number, imageUrls: string[]) {
  const res = await api.post(`/reels/${sessionId}/clip-references`, { clipIndex, imageUrls })
  return res.data as { ok: boolean; clipReferenceOverrides: Record<string, string[]> }
}

// ─── Feature 11 — Self-review ───────────────────────────────────────────────
export async function reviewSession(sessionId: string): Promise<{
  overallScore: number
  issues: Array<{ clipIndex: number; severity: 'info' | 'warning' | 'error'; message: string }>
  summary: string
  reviewedAt?: string
}> {
  const res = await api.post(`/reels/${sessionId}/review`, {})
  return res.data
}

// ─── Feature 12 — Conversational shot edit (AI) ─────────────────────────────
export async function editClipWithAI(sessionId: string, clipIndex: number, instruction: string) {
  const res = await api.post(`/reels/${sessionId}/edit-clip-ai`, { clipIndex, instruction })
  return res.data as { clip: PublicClip; clipIndex: number }
}

// ─── Feature 13 — Set transitions ───────────────────────────────────────────
export async function setTransitions(sessionId: string, transitions: Record<string, ReelsTransition>) {
  const res = await api.post(`/reels/${sessionId}/transitions`, { transitions })
  return res.data as { ok: boolean; transitions: Record<string, ReelsTransition> }
}

// ─── Sprint 2 / Feature A — Timeline Editor: re-merge in custom order ───────
export type MergeCustomEvent =
  | { type: 'merge_start'; clipCount: number; order: number[] }
  | { type: 'merge_progress'; phase: string; progress: number }
  | { type: 'ready'; sessionId: string; downloadUrl: string; sizeBytes: number; mergedHash: string }
  | { type: 'error'; message: string; resumable?: boolean }

export async function mergeCustomOrder(
  sessionId: string,
  clipOrder: number[],
  onEvent: (evt: MergeCustomEvent) => void,
  exportResolution?: ReelsExportResolution,
): Promise<void> {
  const response = await fetch(`${API_URL}/reels/${sessionId}/merge-custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clipOrder, exportResolution }),
  })
  if (!response.ok) throw new Error(`Merge failed: HTTP ${response.status}`)

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      for (const line of part.split('\n')) {
        if (!line.startsWith('data: ')) continue
        try {
          const evt = JSON.parse(line.slice(6)) as MergeCustomEvent
          onEvent(evt)
          if (evt.type === 'error') throw new Error(evt.message)
        } catch (parseErr) {
          if ((parseErr as Error).message && !(parseErr as Error).message.includes('JSON')) throw parseErr
        }
      }
    }
  }
}

// ─── Feature 9 — Export settings (resolution, TTS) ──────────────────────────
export async function setExportSettings(sessionId: string, payload: {
  exportResolution?: ReelsExportResolution
  enableTTS?: boolean
  ttsVoice?: ReelsTTSVoice
}) {
  const res = await api.post(`/reels/${sessionId}/export-settings`, payload)
  return res.data as {
    exportResolution: ReelsExportResolution
    enableTTS: boolean
    ttsVoice: ReelsTTSVoice
  }
}

/** Step 3 — SSE stream: generate all clips + merge */
export async function startReelGeneration(
  sessionId: string,
  onEvent: (event: ReelsSSEEvent) => void,
): Promise<void> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 40 * 60_000) // 40 min max

  try {
    const response = await fetch(`${API_URL}/reels/generate-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${text}`)
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''

      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6)) as ReelsSSEEvent
            onEvent(evt)
            if (evt.type === 'error' && !evt.resumable) throw new Error(evt.message)
          } catch (parseErr) {
            if ((parseErr as Error).message && !(parseErr as Error).message.includes('JSON'))
              throw parseErr
          }
        }
      }
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/** Get session state (for resume on page load) */
export async function getReelSession(sessionId: string): Promise<any> {
  const res = await api.get(`/reels/session/${sessionId}`)
  return res.data
}

/** Get audit log */
export async function getReelAudit(sessionId: string): Promise<any> {
  const res = await api.get(`/reels/audit/${sessionId}`)
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
  winningAdBase64?: string
  winningAdMime?: string
  productPrice?: number
  productPromoPrice?: number
  masterImagePrompt?: string
  imagesPerAngle?: number
  /** Per-angle image counts — overrides global imagesPerAngle when provided */
  angleQuantities?: Record<string, number>
}): Promise<GenerateVariationsResponse> {
  // 20 angles × image generation can take up to 8 min — override the global 180s default
  const res = await api.post('/scale/generate-variations', payload, { timeout: 600000 })
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
  /** Pass winning ad so carousel uses it as style/layout reference (same as angle variations) */
  winningAdBase64?: string
  winningAdMime?: string
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
  return res.data as { analysis: any; framesAnalyzed: number; filename: string; availableAngles: import('./types').ScalingAngle[] }
}

/** Sprint 3 — Analyze winning video directly from a social media URL (yt-dlp + Whisper or Gemini full) */
export interface AnalyzeUrlDonePayload {
  analysis: any
  framesAnalyzed: number
  filename: string
  platform?: string
  transcript?: string
  mode?: 'audio' | 'full'
  availableAngles: import('./types').ScalingAngle[]
}

export type AnalyzeUrlEvent =
  | { type: 'phase'; ts: number; phase: string; message: string; detail?: string }
  | { type: 'done'; payload: AnalyzeUrlDonePayload }
  | { type: 'error'; message: string }

export async function analyzeWinningVideoFromUrl(
  url: string,
  mode: 'audio' | 'full' = 'full',
  onEvent?: (evt: AnalyzeUrlEvent) => void,
): Promise<AnalyzeUrlDonePayload> {
  const response = await fetch(`${API_URL}/scale-video/analyze-from-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, mode }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let donePayload: AnalyzeUrlDonePayload | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      for (const line of part.split('\n')) {
        if (!line.startsWith('data: ')) continue
        try {
          const evt = JSON.parse(line.slice(6)) as AnalyzeUrlEvent
          onEvent?.(evt)
          if (evt.type === 'done') donePayload = evt.payload
          if (evt.type === 'error') throw new Error(evt.message)
        } catch (parseErr) {
          if ((parseErr as Error).message && !(parseErr as Error).message.includes('JSON')) throw parseErr
        }
      }
    }
  }

  if (!donePayload) throw new Error('Stream ended without a result')
  return donePayload
}

/** Sprint 3 v2 — Translate winning-ad analysis + user intent → tailored GeminiGen video prompt */
export async function translateVideoPrompt(payload: {
  videoAnalysis: any
  userIntent: string
  productName: string
  productDescription?: string
  /** Asset mode: product / character / none */
  assetMode?: 'product' | 'character' | 'none'
  /** Character mode: character photo base64 (no data: prefix) */
  characterPhotoBase64?: string
  characterPhotoMime?: string
}): Promise<{ videoPrompt: string; hookVariants: string[]; scriptOutline: string }> {
  const res = await api.post('/scale-video/translate-prompt', payload, { timeout: 60000 })
  return res.data
}

export interface ScaleVideoGenerateResponse {
  productName: string
  aspectRatio: string
  totalVariations: number
  variations: import('./types').AngleVariation[]
  productVisualDescription?: string | null
}

export async function generateScaleVideoJob(payload: {
  videoAnalysis: any
  productName: string
  productDescription?: string
  selectedAngles?: string[]
  aspectRatio?: string
  productPhotoBase64?: string
  productPhotoMime?: string
  /** Asset mode: product / character / none */
  assetMode?: 'product' | 'character' | 'none'
  /** Character mode: all character photo base64 strings (max 10), no data: prefix */
  characterPhotosBase64?: string[]
  /** Sprint 3 v2 — when set, every variation uses this prompt instead of the auto-built one */
  customVideoPrompt?: string | null
}): Promise<ScaleVideoGenerateResponse> {
  // Videos take longer — 10s each × N angles × GeminiGen grok-3 queue time = up to 10 min
  const res = await api.post('/scale-video/generate', payload, { timeout: 600000 })
  return res.data
}

export async function getScaleVideoStatus(taskId: string): Promise<ScaleVideoStatus> {
  const res = await api.get(`/scale-video/status/${taskId}`)
  return res.data
}

/**
 * Start a video remake job.
 * Returns remakeId immediately — poll getRemakeStatus() for progress.
 * Cost: ~$0.044/sec output. 21s ≈ $0.92.
 */
export async function startVideoRemake(payload: {
  file: File
  productName: string
  productDescription?: string
  productPhotoBase64?: string
  productPhotoMime?: string
  aspectRatio?: string
  targetSeconds?: number
  clipCount?: number
}): Promise<StartRemakeResponse> {
  const fd = new FormData()
  fd.append('file', payload.file)
  fd.append('productName', payload.productName)
  if (payload.productDescription) fd.append('productDescription', payload.productDescription)
  if (payload.productPhotoBase64) fd.append('productPhotoBase64', payload.productPhotoBase64)
  if (payload.productPhotoMime) fd.append('productPhotoMime', payload.productPhotoMime)
  if (payload.aspectRatio) fd.append('aspectRatio', payload.aspectRatio)
  if (payload.targetSeconds) fd.append('targetSeconds', String(payload.targetSeconds))
  if (payload.clipCount) fd.append('clipCount', String(payload.clipCount))
  const res = await api.post('/scale-video/remake', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  })
  return res.data
}

export async function getRemakeStatus(remakeId: string): Promise<RemakeJobResponse> {
  const res = await api.get(`/scale-video/remake/${remakeId}`)
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
