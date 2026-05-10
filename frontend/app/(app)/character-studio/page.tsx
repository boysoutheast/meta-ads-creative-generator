'use client'
import { useState, useEffect, useRef } from 'react'
import { Loader2, Plus, Trash2, Copy, ChevronDown, ChevronUp, Sparkles, Drama, FileText, Clapperboard, Check, AlertCircle, Download, RefreshCw, Image as ImageIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  getCharacters, getProducts,
  buildCharacterSheet, getPromptTemplates, createPromptTemplate, updatePromptTemplate, deletePromptTemplate, buildSceneConfig,
  generateScaleVideoSceneImages,
  type Character, type Product, type CharacterSheet, type PromptTemplate, type Storyboard, type StoryboardScene,
} from '@/lib/api'

// Extended scene type with image preview state
type SceneWithImage = StoryboardScene & {
  imageUrl?: string | null
  imgStatus?: 'idle' | 'generating' | 'done' | 'error'
  imgError?: string | null
}

const TABS = [
  { id: 'sheet', label: 'Character Builder', icon: Drama },
  { id: 'templates', label: 'Template Manager', icon: FileText },
  { id: 'storyboard', label: 'Scene Storyboard', icon: Clapperboard },
] as const
type TabId = typeof TABS[number]['id']

const SCENE_TYPES = ['hook', 'body', 'cta', 'custom'] as const

export default function CharacterStudioPage() {
  const [activeTab, setActiveTab] = useState<TabId>('sheet')
  const [characters, setCharacters] = useState<Character[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getCharacters().then(setCharacters).catch(() => {})
    getProducts().then(setProducts).catch(() => {})
  }, [])

  return (
    <div className="max-w-3xl mx-auto space-y-5 pb-12">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><Drama className="h-5 w-5 text-primary" /> Character Studio</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Build character sheets, manage prompt templates, generate scene storyboards.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border bg-muted/30 p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors
              ${activeTab === id ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 px-3 py-2.5 text-sm text-red-700 dark:text-red-400">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />{error}
        </div>
      )}

      {activeTab === 'sheet' && (
        <CharacterSheetTab characters={characters} onError={setError} />
      )}
      {activeTab === 'templates' && (
        <TemplateManagerTab characters={characters} onError={setError} />
      )}
      {activeTab === 'storyboard' && (
        <StoryboardBuilderTab characters={characters} products={products} onError={setError} />
      )}
    </div>
  )
}

// ─── Tab 1: Character Sheet Builder ──────────────────────────────────────────

function CharacterSheetTab({ characters, onError }: { characters: Character[]; onError: (e: string) => void }) {
  const [selectedCharId, setSelectedCharId] = useState<string>('')
  const [building, setBuilding] = useState(false)
  const [sheet, setSheet] = useState<CharacterSheet | null>(null)
  const [rawAppearance, setRawAppearance] = useState('')
  const [copied, setCopied] = useState(false)

  const selectedChar = characters.find(c => c.id === selectedCharId)

  const handleBuild = async () => {
    if (!selectedChar) return
    setBuilding(true)
    onError('')
    try {
      const res = await buildCharacterSheet({
        characterId: selectedChar.id,
        characterName: selectedChar.name,
      })
      setSheet(res.characterSheet)
      setRawAppearance(res.rawAppearance)
    } catch (e: any) {
      onError(e?.response?.data?.error || e.message || 'Gagal build character sheet')
    } finally {
      setBuilding(false)
    }
  }

  const copyJson = () => {
    if (!sheet) return
    navigator.clipboard.writeText(JSON.stringify(sheet, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Build Character Sheet</CardTitle>
          <CardDescription>GPT-4o analyzes reference photos → generates structured JSON config untuk video generation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Pilih Karakter</Label>
            <Select value={selectedCharId} onValueChange={setSelectedCharId}>
              <SelectTrigger><SelectValue placeholder="Pilih karakter dari library..." /></SelectTrigger>
              <SelectContent>
                {characters.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} {c.photos?.length ? `· ${c.photos.length} foto` : '· no foto'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {characters.length === 0 && (
              <p className="text-xs text-muted-foreground">Belum ada karakter. <a href="/characters" className="underline text-primary">Insert karakter dulu →</a></p>
            )}
          </div>

          {selectedChar && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {(selectedChar.photos || []).slice(0, 5).map((p, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={p} alt="" className="h-14 w-14 rounded-lg object-cover border shrink-0" />
              ))}
              <div className="flex items-center px-3 text-xs text-muted-foreground shrink-0">
                {(selectedChar.photos?.length || 0)} foto akan dianalisis
              </div>
            </div>
          )}

          <Button onClick={handleBuild} disabled={!selectedCharId || building} className="w-full">
            {building ? <><Loader2 className="h-4 w-4 animate-spin" /> Analyzing photos…</> : <><Sparkles className="h-4 w-4" /> Build Character Sheet</>}
          </Button>
        </CardContent>
      </Card>

      {sheet && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{sheet.characterName} — Character Sheet</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={copyJson}>
                  {copied ? <><Check className="h-3.5 w-3.5 text-emerald-500" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy JSON</>}
                </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{sheet.appearanceSummary}</p>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {/* Prompt prefix — most important */}
            <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 space-y-1">
              <p className="text-xs font-semibold text-primary uppercase tracking-wide">Prompt Prefix (paste ke setiap imagePrompt)</p>
              <p className="font-mono text-xs leading-relaxed">{sheet.promptPrefix}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <SheetField label="Wajah" value={sheet.appearance?.face} />
              <SheetField label="Rambut" value={sheet.appearance?.hair} />
              <SheetField label="Postur" value={sheet.appearance?.build} />
              <SheetField label="Signature" value={sheet.appearance?.signature} />
              <SheetField label="Outfit" value={sheet.outfitSignature} />
              <SheetField label="Aksesoris" value={sheet.accessories} />
              <SheetField label="Voice Direction" value={sheet.voiceDirection} />
              <SheetField label="Animation Style" value={sheet.animationStyle} />
            </div>

            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Color Palette</p>
              <div className="flex gap-2">
                {(sheet.colorPalette || []).map((c, i) => (
                  <span key={i} className="rounded-full border px-2 py-0.5 text-xs">{c}</span>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Constraints (DO NOT change)</p>
              <ul className="space-y-0.5">
                {(sheet.constraints || []).map((c, i) => (
                  <li key={i} className="text-xs flex items-start gap-1.5"><span className="text-amber-500 mt-0.5">⚠</span>{c}</li>
                ))}
              </ul>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Negative Prompt</p>
              <p className="text-xs text-muted-foreground">{sheet.negativePrompt}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function SheetField({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-xs leading-relaxed">{value}</p>
    </div>
  )
}

// ─── Tab 2: Template Manager ──────────────────────────────────────────────────

function TemplateManagerTab({ characters, onError }: { characters: Character[]; onError: (e: string) => void }) {
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [filterCharId, setFilterCharId] = useState<string>('all')
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // New template form
  const [form, setForm] = useState({
    name: '', sceneType: 'hook', characterId: '',
    imagePrompt: '', voiceover: '', voiceDirection: '',
    textOverlay: '', cameraMovement: '', mood: '', style: '', negativePrompt: '',
  })

  const load = async () => {
    setLoading(true)
    try {
      const list = await getPromptTemplates(filterCharId !== 'all' ? filterCharId : undefined)
      setTemplates(list)
    } catch (e: any) { onError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [filterCharId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async () => {
    if (!form.name || !form.imagePrompt) { onError('name dan imagePrompt wajib diisi'); return }
    setSaving(true)
    try {
      await createPromptTemplate({
        ...form,
        characterId: form.characterId || null,
        tags: [],
      } as any)
      setCreating(false)
      setForm({ name: '', sceneType: 'hook', characterId: '', imagePrompt: '', voiceover: '', voiceDirection: '', textOverlay: '', cameraMovement: '', mood: '', style: '', negativePrompt: '' })
      await load()
    } catch (e: any) { onError(e?.response?.data?.error || e.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    try {
      await deletePromptTemplate(id)
      setTemplates(prev => prev.filter(t => t.id !== id))
    } catch (e: any) { onError(e.message) }
  }

  const copyPrompt = (t: PromptTemplate) => {
    navigator.clipboard.writeText(t.imagePrompt)
  }

  return (
    <div className="space-y-4">
      {/* Filter + Create */}
      <div className="flex gap-2">
        <Select value={filterCharId} onValueChange={setFilterCharId}>
          <SelectTrigger className="flex-1"><SelectValue placeholder="Filter karakter..." /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua template</SelectItem>
            {characters.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button onClick={() => setCreating(v => !v)} variant={creating ? 'secondary' : 'default'}>
          <Plus className="h-4 w-4" /> Buat Template
        </Button>
      </div>

      {/* Create form */}
      {creating && (
        <Card className="border-primary/30">
          <CardHeader className="pb-3"><CardTitle className="text-sm">Template Baru</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Nama Template *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Kapten Tara Hook Scene" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Scene Type</Label>
                <Select value={form.sceneType} onValueChange={v => setForm(f => ({ ...f, sceneType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SCENE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Link ke Karakter (opsional)</Label>
              <Select
                value={form.characterId || '__none__'}
                onValueChange={v => setForm(f => ({ ...f, characterId: v === '__none__' ? '' : v }))}
              >
                <SelectTrigger><SelectValue placeholder="Pilih karakter..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Tidak ada</SelectItem>
                  {characters.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Image Prompt * (untuk GeminiGen + GPT-image-2)</Label>
              <Textarea value={form.imagePrompt} onChange={e => setForm(f => ({ ...f, imagePrompt: e.target.value }))}
                placeholder="[STYLE] ... [CHARACTER] ... [ENVIRONMENT] ... [MOTION] ... [CAMERA] ... [MOOD] ... [TEXT OVERLAY] ... [NEGATIVE] ..."
                rows={6} className="font-mono text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Voiceover (Bahasa Indonesia)</Label>
                <Textarea value={form.voiceover} onChange={e => setForm(f => ({ ...f, voiceover: e.target.value }))} rows={3} placeholder="[VOICE: suara laki-laki lucu] Kalimat 1. Kalimat 2. Kalimat 3." />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Voice Direction (English)</Label>
                <Textarea value={form.voiceDirection} onChange={e => setForm(f => ({ ...f, voiceDirection: e.target.value }))} rows={3} placeholder="Friendly male mascot, energetic, warm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Text Overlay</Label>
                <Input value={form.textOverlay} onChange={e => setForm(f => ({ ...f, textOverlay: e.target.value }))} placeholder="HEADLINE / subtext" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Camera Movement</Label>
                <Input value={form.cameraMovement} onChange={e => setForm(f => ({ ...f, cameraMovement: e.target.value }))} placeholder="Medium shot → slow push-in" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Mood</Label>
                <Input value={form.mood} onChange={e => setForm(f => ({ ...f, mood: e.target.value }))} placeholder="heroic, hopeful, premium" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Style</Label>
                <Input value={form.style} onChange={e => setForm(f => ({ ...f, style: e.target.value }))} placeholder="3D semi-cartoon, glossy, cinematic" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Negative Prompt</Label>
              <Input value={form.negativePrompt} onChange={e => setForm(f => ({ ...f, negativePrompt: e.target.value }))} placeholder="no gore, no horror, no wounds" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setCreating(false)} className="flex-1">Batal</Button>
              <Button onClick={handleCreate} disabled={saving} className="flex-1">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Simpan Template'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Template list */}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : templates.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">Belum ada template. Buat template pertama kamu.</div>
      ) : (
        <div className="space-y-2">
          {templates.map(t => (
            <Card key={t.id} className="overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30"
                onClick={() => setExpandedId(id => id === t.id ? null : t.id)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{t.name}</span>
                    <Badge variant="outline" className="text-[10px] shrink-0">{t.sceneType}</Badge>
                    {t.character && <Badge variant="secondary" className="text-[10px] shrink-0">{t.character.name}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{t.imagePrompt.slice(0, 80)}…</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={e => { e.stopPropagation(); copyPrompt(t) }}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={e => { e.stopPropagation(); handleDelete(t.id) }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  {expandedId === t.id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>
              {expandedId === t.id && (
                <div className="border-t px-4 py-3 space-y-3 bg-muted/20 text-xs">
                  <div>
                    <p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Image Prompt</p>
                    <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed bg-background rounded-md p-2 border">{t.imagePrompt}</pre>
                  </div>
                  {t.voiceover && <div><p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Voiceover</p><p className="leading-relaxed">{t.voiceover}</p></div>}
                  {t.voiceDirection && <div><p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Voice Direction</p><p>{t.voiceDirection}</p></div>}
                  {t.textOverlay && <div><p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Text Overlay</p><p className="font-semibold">{t.textOverlay}</p></div>}
                  {t.cameraMovement && <div><p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Camera</p><p>{t.cameraMovement}</p></div>}
                  {t.mood && <div><p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Mood</p><p>{t.mood}</p></div>}
                  {t.negativePrompt && <div><p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Negative</p><p className="text-muted-foreground">{t.negativePrompt}</p></div>}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Tab 3: Scene Storyboard Builder ─────────────────────────────────────────

function StoryboardBuilderTab({ characters, products, onError }: { characters: Character[]; products: Product[]; onError: (e: string) => void }) {
  const [brief, setBrief] = useState('')
  const [selectedCharId, setSelectedCharId] = useState<string>('')
  const [productDesc, setProductDesc] = useState('')
  const [sceneCount, setSceneCount] = useState(3)
  const [mood, setMood] = useState('')
  const [style, setStyle] = useState('3D semi-cartoon premium, glossy, cinematic lighting, smooth animation, vertical 9:16')
  const [building, setBuilding] = useState(false)
  const [scenes, setScenes] = useState<SceneWithImage[]>([])
  const [storyboardMeta, setStoryboardMeta] = useState<{ title: string; totalDuration: number; style: string } | null>(null)
  const [generatingImages, setGeneratingImages] = useState(false)
  const [charSheet, setCharSheet] = useState<any>(null)
  const [loadingSheet, setLoadingSheet] = useState(false)
  const [expandedScene, setExpandedScene] = useState<number | null>(0)
  const [copied, setCopied] = useState<number | null>(null)
  const abortRef = useRef<{ current: boolean }>({ current: false })

  const selectedChar = characters.find(c => c.id === selectedCharId)

  // Auto-build char sheet when character changes
  useEffect(() => {
    if (!selectedChar || !selectedChar.photos?.length) { setCharSheet(null); return }
    setLoadingSheet(true)
    buildCharacterSheet({ characterId: selectedChar.id, characterName: selectedChar.name })
      .then(res => setCharSheet(res.characterSheet))
      .catch(() => setCharSheet(null))
      .finally(() => setLoadingSheet(false))
  }, [selectedCharId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sequential image generation per scene — same pattern as scale-video
  const generateImagesSequential = async (
    sceneList: SceneWithImage[],
    assetPhotos: string[] | undefined,
    abort: { current: boolean }
  ) => {
    for (let i = 0; i < sceneList.length; i++) {
      if (abort.current) break
      const s = sceneList[i]
      setScenes(prev => prev.map(x => x.scene === s.scene ? { ...x, imgStatus: 'generating' } : x))
      try {
        const result = await generateScaleVideoSceneImages([{
          scene: s.scene, duration: s.duration, voiceover: s.voiceover || '', imagePrompt: s.imagePrompt,
        }], assetPhotos)
        if (abort.current) break
        const { imageUrl = null, imgError = null } = result[0] ?? {}
        setScenes(prev => prev.map(x =>
          x.scene === s.scene ? { ...x, imageUrl, imgStatus: imageUrl ? 'done' : 'error', imgError: imgError || (imageUrl ? null : 'Gagal generate') } : x
        ))
      } catch (e: any) {
        if (abort.current) break
        setScenes(prev => prev.map(x =>
          x.scene === s.scene ? { ...x, imgStatus: 'error', imgError: e?.response?.data?.error || e.message || 'Error' } : x
        ))
      }
    }
  }

  const handleRetryImage = async (sceneNum: number) => {
    const s = scenes.find(x => x.scene === sceneNum)
    if (!s) return
    const assetPhotos = selectedChar?.photos?.slice(0, 10)
    setScenes(prev => prev.map(x => x.scene === sceneNum ? { ...x, imgStatus: 'generating', imgError: null } : x))
    try {
      const result = await generateScaleVideoSceneImages([{
        scene: s.scene, duration: s.duration, voiceover: s.voiceover || '', imagePrompt: s.imagePrompt,
      }], assetPhotos)
      const { imageUrl = null, imgError = null } = result[0] ?? {}
      setScenes(prev => prev.map(x =>
        x.scene === sceneNum ? { ...x, imageUrl, imgStatus: imageUrl ? 'done' : 'error', imgError: imgError || null } : x
      ))
    } catch (e: any) {
      setScenes(prev => prev.map(x =>
        x.scene === sceneNum ? { ...x, imgStatus: 'error', imgError: e.message || 'Error' } : x
      ))
    }
  }

  const handleBuild = async () => {
    if (!brief.trim()) { onError('Brief wajib diisi'); return }
    setBuilding(true)
    onError('')
    try {
      const res = await buildSceneConfig({
        brief, characterSheet: charSheet,
        productDesc: productDesc || undefined,
        sceneCount, style, mood: mood || undefined,
      })

      // Defensive: guard against unexpected server response shape
      const storyboard = res?.storyboard
      if (!storyboard || typeof storyboard !== 'object') {
        throw new Error('Server returned invalid storyboard response')
      }
      const rawScenes = Array.isArray(storyboard.scenes) ? storyboard.scenes : []
      const { scenes: _ignored, ...meta } = storyboard as any
      setStoryboardMeta(meta)

      // Normalise scene fields — GPT may return wrong types (object instead of string, etc.)
      const initialScenes: SceneWithImage[] = rawScenes.map((s: any, i: number) => ({
        scene: typeof s.scene === 'number' ? s.scene : i + 1,
        duration: String(s.duration ?? `${i * 10}-${(i + 1) * 10}s`),
        sceneType: String(s.sceneType ?? 'custom'),
        imagePrompt: String(s.imagePrompt ?? ''),
        voiceover: String(s.voiceover ?? ''),
        voiceDirection: String(s.voiceDirection ?? ''),
        textOverlay: String(s.textOverlay ?? ''),
        cameraMovement: String(s.cameraMovement ?? ''),
        mood: String(s.mood ?? ''),
        notes: String(s.notes ?? ''),
        imgStatus: 'generating' as const,
        imgError: null,
      }))
      setScenes(initialScenes)
      setExpandedScene(0)

      // Auto-generate preview images sequentially
      abortRef.current.current = true
      const newAbort = { current: false }
      abortRef.current = newAbort
      const assetPhotos = selectedChar?.photos?.slice(0, 10)
      setGeneratingImages(true)
      generateImagesSequential(initialScenes, assetPhotos, newAbort)
        .catch(e => console.error('[storyboard] image generation error:', e))
        .finally(() => setGeneratingImages(false))
    } catch (e: any) {
      onError(e?.response?.data?.error || e.message || 'Gagal build storyboard')
    } finally {
      setBuilding(false)
    }
  }

  const copyScene = (s: SceneWithImage, idx: number) => {
    navigator.clipboard.writeText(s.imagePrompt)
    setCopied(idx)
    setTimeout(() => setCopied(null), 2000)
  }

  const exportJson = () => {
    if (!scenes.length) return
    const data = { ...storyboardMeta, scenes: scenes.map(({ imageUrl, imgStatus, imgError, ...s }) => s) }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `storyboard-${storyboardMeta?.title?.replace(/\s+/g, '-') || 'export'}.json`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Scene Storyboard Builder</CardTitle>
          <CardDescription>Dari brief singkat → full scene config JSON + preview image per scene (GPT-image-2) siap untuk Scale Winning Video.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Brief / Konsep Video *</Label>
            <Textarea value={brief} onChange={e => setBrief(e.target.value)}
              placeholder="e.g. Kapten Tara datang ke Kota Kulit yang redup, membawa Melastop Night Cream sebagai solusi wajah kusam. Mood: heroic, hopeful, premium."
              rows={4} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Karakter (opsional)</Label>
              <Select
                value={selectedCharId || '__none__'}
                onValueChange={v => setSelectedCharId(v === '__none__' ? '' : v)}
              >
                <SelectTrigger><SelectValue placeholder="Pilih karakter..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Tidak ada</SelectItem>
                  {characters.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {loadingSheet && <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />Building character sheet…</p>}
              {charSheet && !loadingSheet && <p className="text-xs text-emerald-600 flex items-center gap-1"><Check className="h-3 w-3" />Character sheet ready</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Jumlah Scene</Label>
              <Select value={String(sceneCount)} onValueChange={v => setSceneCount(parseInt(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1,2,3,4,5,6].map(n => <SelectItem key={n} value={String(n)}>{n} scene ({n * 10}s)</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Deskripsi Produk (opsional)</Label>
            <Input value={productDesc} onChange={e => setProductDesc(e.target.value)}
              placeholder="e.g. TaraCare Melastop Night Cream, jar hitam glossy, label ungu, cream putih-silver" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Mood</Label>
              <Input value={mood} onChange={e => setMood(e.target.value)} placeholder="heroic, hopeful, premium" />
            </div>
            <div className="space-y-1.5">
              <Label>Style</Label>
              <Input value={style} onChange={e => setStyle(e.target.value)} placeholder="3D semi-cartoon, glossy, cinematic" />
            </div>
          </div>

          <Button onClick={handleBuild} disabled={!brief.trim() || building} className="w-full">
            {building
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating {sceneCount} scene config…</>
              : <><Sparkles className="h-4 w-4" /> Build {sceneCount} Scene Storyboard</>}
          </Button>
        </CardContent>
      </Card>

      {scenes.length > 0 && storyboardMeta && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">{storyboardMeta.title}</h3>
              <p className="text-xs text-muted-foreground">
                {storyboardMeta.totalDuration}s · {scenes.length} scene
                {generatingImages && <span className="ml-2 text-primary animate-pulse">· Generating preview images…</span>}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={exportJson}>
              <Download className="h-3.5 w-3.5" /> Export JSON
            </Button>
          </div>

          {/* Mini storyboard strip */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {scenes.map((s, i) => (
              <div key={i} className="relative shrink-0 rounded-lg overflow-hidden bg-muted border cursor-pointer"
                style={{ width: 64, aspectRatio: '9/16' }}
                onClick={() => setExpandedScene(n => n === i ? null : i)}>
                {s.imageUrl
                  ? <img src={s.imageUrl} alt="" className="w-full h-full object-cover" /> // eslint-disable-line @next/next/no-img-element
                  : <div className="w-full h-full flex items-center justify-center">
                      {s.imgStatus === 'generating'
                        ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        : <ImageIcon className="h-4 w-4 text-muted-foreground/40" />}
                    </div>}
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 px-1 pb-1">
                  <p className="text-[8px] text-white font-bold">{s.duration}</p>
                </div>
              </div>
            ))}
          </div>

          {scenes.map((s, i) => (
            <Card key={i} className="overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30"
                onClick={() => setExpandedScene(n => n === i ? null : i)}>
                {/* Thumbnail */}
                <div className="relative shrink-0 rounded-md overflow-hidden bg-muted" style={{ width: 32, aspectRatio: '9/16' }}>
                  {s.imageUrl
                    ? <img src={s.imageUrl} alt="" className="w-full h-full object-cover" /> // eslint-disable-line @next/next/no-img-element
                    : <div className="w-full h-full flex items-center justify-center">
                        {s.imgStatus === 'generating'
                          ? <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
                          : <ImageIcon className="h-2.5 w-2.5 text-muted-foreground/40" />}
                      </div>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{s.duration}</span>
                    <Badge variant="outline" className="text-[10px]">{s.sceneType}</Badge>
                    {s.imgStatus === 'generating' && <span className="text-[10px] text-primary animate-pulse">generating image…</span>}
                    {s.imgStatus === 'error' && <span className="text-[10px] text-red-500">image failed</span>}
                    {s.textOverlay && <span className="text-[10px] text-muted-foreground truncate max-w-24">"{s.textOverlay}"</span>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{s.voiceover?.slice(0, 70)}…</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  {s.imgStatus === 'error' && (
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400" title="Retry image"
                      onClick={e => { e.stopPropagation(); handleRetryImage(s.scene) }}>
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={e => { e.stopPropagation(); copyScene(s, i) }}>
                    {copied === i ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                  {expandedScene === i ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>

              {expandedScene === i && (
                <div className="border-t px-4 py-3 space-y-3 bg-muted/10 text-xs">
                  {/* Preview image full size */}
                  {s.imageUrl && (
                    <div className="flex justify-center">
                      <img src={s.imageUrl} alt={`Scene ${s.scene}`} // eslint-disable-line @next/next/no-img-element
                        className="max-h-64 rounded-lg border object-contain" />
                    </div>
                  )}
                  {s.imgStatus === 'generating' && (
                    <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /><span>Generating preview image via GPT-image-2…</span>
                    </div>
                  )}
                  {s.imgStatus === 'error' && (
                    <div className="flex items-center justify-between rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 px-3 py-2">
                      <span className="text-red-600 text-[11px]">{s.imgError || 'Image generation failed'}</span>
                      <Button size="sm" variant="ghost" className="h-6 text-xs text-red-600" onClick={() => handleRetryImage(s.scene)}>
                        <RefreshCw className="h-3 w-3" /> Retry
                      </Button>
                    </div>
                  )}
                  <div>
                    <p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Image Prompt (GeminiGen)</p>
                    <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed bg-background rounded-md p-2 border">{s.imagePrompt}</pre>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Voiceover (ID)</p>
                      <p className="leading-relaxed">{s.voiceover}</p>
                    </div>
                    <div className="space-y-2">
                      {s.voiceDirection && <div><p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">Voice Direction</p><p>{s.voiceDirection}</p></div>}
                      {s.textOverlay && <div><p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">Text Overlay</p><p className="font-semibold">{s.textOverlay}</p></div>}
                      {s.cameraMovement && <div><p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">Camera</p><p>{s.cameraMovement}</p></div>}
                      {s.mood && <div><p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">Mood</p><p>{s.mood}</p></div>}
                    </div>
                  </div>
                  {s.notes && (
                    <div>
                      <p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Director Notes</p>
                      <p className="text-muted-foreground italic">{s.notes}</p>
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
