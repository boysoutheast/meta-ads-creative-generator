// ─── Shared enums ────────────────────────────────────────────────────────────

export type AspectRatio = '1:1' | '9:16' | '16:9' | '4:5'
export type OutputType = 'image' | 'video' | 'carousel'
export type Language = 'id' | 'en' | 'bilingual'
export type GenerationStatus = 'idle' | 'analyzing' | 'generating' | 'done' | 'error'

export const ASPECT_RATIOS: { value: AspectRatio; label: string; size: string }[] = [
  { value: '1:1', label: 'Square 1:1', size: '1080×1080' },
  { value: '9:16', label: 'Story / Reels 9:16', size: '1080×1920' },
  { value: '4:5', label: 'Portrait 4:5', size: '1080×1350' },
  { value: '16:9', label: 'Landscape 16:9', size: '1920×1080' },
]

// ─── Scaling angles (mirror of backend SCALING_ANGLES) ───────────────────────

export interface ScalingAngle {
  key: string
  label: string
  hook: string
}

export interface AngleVariation {
  angle: string
  headline: string
  subheadline: string
  bodyText: string
  cta: string
  imageDirection: string
  imagePrompt?: string | null
  promptError?: string | null
  imageUrl?: string | null
  imageError?: string | null
  conceptNote?: string | null
}

export interface WinningAdAnalysis {
  hook?: string
  visualStyle?: string
  colorPalette?: string[]
  copyPattern?: string
  dominantAngle?: string
  format?: string
  targetAudience?: string
  primaryEmotion?: string
  strengths?: string[]
  composition?: string
  lighting?: string
  mood?: string
  type?: 'image' | 'video'
  raw?: string
  framesAnalyzed?: number
  [k: string]: any
}

export interface AnalyzeWinningResponse {
  analysis: WinningAdAnalysis
  filename: string
  availableAngles: ScalingAngle[]
}

export interface GenerateVariationsResponse {
  productName: string
  aspectRatio: AspectRatio
  totalVariations: number
  variations: AngleVariation[]
  productVisualDescription?: string | null
}

// ─── Reference / create ──────────────────────────────────────────────────────

export interface ReferenceAnalysis {
  type?: 'image' | 'video'
  raw?: string
  framesAnalyzed?: number
  [k: string]: any
}

export interface ProductInfo {
  productName: string
  description?: string
  usp?: string
  targetAudience?: string
  adGoal?: string
  brandColors?: string
}

export interface SlideCopy {
  headline: string
  subtext: string
  cta: string | null
}

export interface CreateResultItem {
  variationIndex: number
  imagePrompt: string | null
  copy: SlideCopy | string | null
  imageUrl: string | null
  videoJobId: string | null
  format: AspectRatio
  outputType: 'image' | 'video'
  error?: string
}

export interface CreateGenerateResponse {
  productName: string
  format: AspectRatio
  outputType: 'image' | 'video'
  language: Language
  totalVariations: number
  blendedContext: string
  results: CreateResultItem[]
}

export interface CarouselSlide {
  slideIndex: number
  slideRole?: string
  imagePrompt: string
  imageUrl?: string | null
  copy?: SlideCopy | null
  headline?: string
  subtext?: string
  cta?: string | null
}

export interface CarouselResponse {
  productName: string
  totalSlides: number
  blendedContext: string
  slides: CarouselSlide[]
}

// ─── Scale V2 Carousel ───────────────────────────────────────────────────────

export interface ScaleCarouselSlide {
  slideNumber: number
  type: 'hook' | 'benefit' | 'cta'
  headline: string
  subtext: string
  imagePrompt: string
  imageUrl?: string | null
  imageError?: string | null
}

export interface ScaleCarouselResponse {
  totalSlides: number
  productName: string
  slides: ScaleCarouselSlide[]
}

// ─── Scale Winning Video ─────────────────────────────────────────────────────

export interface VideoScene {
  scene: number
  duration: string
  description: string
  visualStyle?: string
  cameraAngle?: string
}

export interface VideoAnalysis {
  scenes?: VideoScene[]
  overallStyle?: string
  pacing?: string
  hookType?: string
  colorPalette?: string[]
  cameraMovement?: string
  emotionArc?: string
  recommendedDuration?: number
  musicVibe?: string
  raw?: string
  [k: string]: any
}

export interface ScaleVideoJobResponse {
  taskId: string | null
  videoScript: VideoScene[]
  videoPrompt: string
  productVisualDescription: string | null
  message?: string
}

export interface ScaleVideoStatus {
  taskId: string
  status: 'processing' | 'completed' | 'failed'
  videoUrl: string | null
  progress: number | null
  error: string | null
}

// ─── History (localStorage) ──────────────────────────────────────────────────

export type HistoryKind = 'scale' | 'create' | 'carousel'

export interface HistoryEntry {
  id: string
  kind: HistoryKind
  createdAt: number
  productName: string
  thumbnailUrl?: string | null
  payload: any
}
