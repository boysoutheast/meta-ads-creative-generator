# SPRINT: Asset Mode — Product / Character / None

Project root: `/Users/siscaliman/Documents/Claude/Projects/Ads creative generator`

**Rules (WAJIB):**
- Jangan install package baru.
- Jangan ubah: `geminiGenService.js`, `videoRemakeService.js`, `routes/reels.js`, `scalingService.js`.
- Jangan ubah endpoint yang sudah ada selain yang disebutkan di sini.
- Jalankan endless audit loop sampai 0 error sebelum commit.
- Kerjakan perubahan secara urut (backend dulu, lalu frontend).

---

## OVERVIEW

Ganti section "Pilih Produk" di Step 2 (`scale-video/page.tsx`) menjadi **Asset Mode** dengan 3 pilihan:

| Mode | Label | Deskripsi |
|------|-------|-----------|
| `product` | 📦 Produk | Pilih dari daftar produk tersimpan (behavior existing) |
| `character` | 👤 Karakter | Input nama karakter + upload foto karakter (maks 10 foto) |
| `none` | 🚫 None | Tidak pakai aset — generate tanpa referensi foto |

Pilihan ini bersifat **opsional** — tombol Generate **tidak boleh** disabled karena belum pilih produk.
`assetMode` jadi required, tapi value `none` valid.

Foto karakter / produk dipakai sebagai:
1. Image reference ke GeminiGen (image-to-video)
2. Bahan deskripsi visual yang di-merge ke `translateVideoPrompt`

---

## FEATURE 1 — frontend/app/(app)/scale-video/page.tsx

### 1.1 Tambah imports

Tambah ke import lucide-react yang sudah ada: `Package, User, Ban, Plus, X, ImageIcon`

Tambah import baru setelah baris import `Textarea`:
```ts
import { useRef } from 'react'
```

### 1.2 Tambah/ubah states

**Hapus** (tidak lagi diperlukan sebagai mandatory):
```ts
// TIDAK ADA yang dihapus — cukup tidak wajibkan selectedProduct
```

**Tambah** setelah `const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)`:
```ts
// Asset mode
const [assetMode, setAssetMode] = useState<'product' | 'character' | 'none'>('product')

// Character mode states
const [characterName, setCharacterName] = useState('')
const [characterPhotos, setCharacterPhotos] = useState<string[]>([]) // base64 data URLs, max 10
```

### 1.3 Update `handleTranslatePrompt`

Hapus guard `!selectedProduct`:

Ganti:
```ts
  const handleTranslatePrompt = async () => {
    if (!userIntent.trim() || !videoAnalysis || !selectedProduct) return
```

Dengan:
```ts
  const handleTranslatePrompt = async () => {
    if (!userIntent.trim() || !videoAnalysis) return
```

Update payload yang dikirim ke `translateVideoPrompt`:
```ts
      const result = await translateVideoPrompt({
        videoAnalysis,
        userIntent: userIntent.trim(),
        productName:
          assetMode === 'product'
            ? (selectedProduct?.name ?? 'Unknown Product')
            : assetMode === 'character'
            ? characterName || 'Character'
            : 'Generic',
        productDescription:
          assetMode === 'product'
            ? (selectedProduct?.description ?? '')
            : assetMode === 'character'
            ? `Character name: ${characterName || 'unnamed'}. ${characterPhotos.length} character photo(s) provided.`
            : '',
        assetMode,
        characterPhotoBase64:
          assetMode === 'character' && characterPhotos.length > 0
            ? characterPhotos[0].replace(/^data:[^;]+;base64,/, '')
            : undefined,
        characterPhotoMime:
          assetMode === 'character' && characterPhotos.length > 0
            ? (characterPhotos[0].match(/^data:([^;]+);/)?.[1] ?? 'image/jpeg')
            : undefined,
      })
```

### 1.4 Update `handleGenerate`

Ganti seluruh fungsi `handleGenerate`:
```ts
  const handleGenerate = async () => {
    if (!videoAnalysis || selectedAngles.length === 0) return
    setError(null)
    setGenerating(true)
    setResult(null)

    try {
      // Build asset payload depending on mode
      let productPhotoBase64: string | undefined
      let productPhotoMime: string | undefined
      let productName = 'Generic'
      let productDescription = ''
      let characterPhotosBase64: string[] | undefined

      if (assetMode === 'product' && selectedProduct) {
        const photoDataUrl = selectedProduct.photos?.[0]
        const photoMatch = photoDataUrl?.match(/^data:([^;]+);base64,(.+)$/)
        productPhotoBase64 = photoMatch?.[2] ?? undefined
        productPhotoMime = photoMatch?.[1] ?? undefined
        productName = selectedProduct.name
        productDescription = selectedProduct.description ?? ''
      } else if (assetMode === 'character') {
        productName = characterName || 'Character'
        productDescription = `Character: ${characterName || 'unnamed'}`
        if (characterPhotos.length > 0) {
          // First photo as primary image-to-video reference
          const firstMatch = characterPhotos[0].match(/^data:([^;]+);base64,(.+)$/)
          productPhotoBase64 = firstMatch?.[2] ?? undefined
          productPhotoMime = firstMatch?.[1] ?? undefined
          // All photos as additional references
          characterPhotosBase64 = characterPhotos.map((p) =>
            p.replace(/^data:[^;]+;base64,/, '')
          )
        }
      }
      // assetMode === 'none': all remain undefined/empty

      const resp = await generateScaleVideoJob({
        videoAnalysis,
        productName,
        productDescription,
        selectedAngles,
        aspectRatio,
        productPhotoBase64,
        productPhotoMime,
        characterPhotosBase64,
        assetMode,
        customVideoPrompt: refinedPrompt || undefined,
      })
      setResult(resp)
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || 'Gagal generate video')
    } finally {
      setGenerating(false)
    }
  }
```

### 1.5 Ganti seluruh Step 2 Card JSX

Cari blok:
```tsx
          {/* Step 2 */}
          {videoAnalysis && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">2. Pilih Produk & Setting</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Product selector */}
                {products.length > 0 && (
                  ...
                )}
```

Ganti seluruh Card tersebut (dari `{/* Step 2 */}` sampai closing `</Card>` + `)}` pertama) dengan:

```tsx
          {/* Step 2 */}
          {videoAnalysis && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">2. Setting & Aset</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">

                {/* ── Asset mode selector ─────────────────── */}
                <div className="space-y-2">
                  <Label>Tambahan aset tersimpan</Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { mode: 'product', icon: Package, label: 'Produk' },
                        { mode: 'character', icon: User, label: 'Karakter' },
                        { mode: 'none', icon: Ban, label: 'None' },
                      ] as const
                    ).map(({ mode, icon: Icon, label }) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setAssetMode(mode)}
                        className={`flex flex-col items-center gap-1 rounded-lg border py-2.5 text-xs font-medium transition-colors ${
                          assetMode === mode
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-background text-muted-foreground hover:text-foreground hover:border-muted-foreground'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── Product picker ───────────────────────── */}
                {assetMode === 'product' && products.length > 0 && (
                  <div className="space-y-2">
                    <Select
                      value={selectedProduct?.id || ''}
                      onValueChange={(id) => {
                        const p = products.find((x) => x.id === id)
                        if (p) setSelectedProduct(p)
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Pilih produk…" /></SelectTrigger>
                      <SelectContent>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}{p.price !== undefined ? ` — ${fmt(p.price)}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedProduct?.photos?.[0] && (
                      <p className="flex items-center gap-1 text-xs text-emerald-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                        Foto produk tersedia — image-to-video aktif
                      </p>
                    )}
                  </div>
                )}
                {assetMode === 'product' && products.length === 0 && (
                  <p className="text-xs text-muted-foreground rounded border border-dashed p-2 text-center">
                    Belum ada produk tersimpan. Tambah dulu di menu Produk.
                  </p>
                )}

                {/* ── Character builder ────────────────────── */}
                {assetMode === 'character' && (
                  <CharacterBuilder
                    name={characterName}
                    onNameChange={setCharacterName}
                    photos={characterPhotos}
                    onPhotosChange={setCharacterPhotos}
                  />
                )}

                {/* ── None info ────────────────────────────── */}
                {assetMode === 'none' && (
                  <p className="text-xs text-muted-foreground rounded border border-dashed p-2 text-center">
                    Generate tanpa referensi foto produk / karakter.
                  </p>
                )}

                {/* Format */}
                <div className="space-y-2">
                  <Label>Format</Label>
                  <div className="flex gap-2">
                    {FORMATS.map((f) => (
                      <Button
                        key={f.value}
                        type="button"
                        size="sm"
                        variant={aspectRatio === f.value ? 'default' : 'outline'}
                        onClick={() => setAspectRatio(f.value)}
                        className="flex-1 flex-col h-auto py-2"
                      >
                        <span className="text-xs font-semibold">{f.value}</span>
                        <span className="text-[10px] opacity-70">{f.hint}</span>
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Duration info badge */}
                <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                  <Video className="h-3.5 w-3.5 text-primary shrink-0" />
                  <p className="text-xs text-primary font-medium">Durasi: 10 detik · Model: GeminiGen grok-3</p>
                </div>

                {/* Angle selector */}
                {availableAngles.length > 0 && (
                  <div>
                    <Label className="mb-2 block">Pilih angle</Label>
                    <AngleSelector
                      angles={availableAngles}
                      selected={selectedAngles}
                      onChange={setSelectedAngles}
                    />
                  </div>
                )}

                <Button
                  className="w-full"
                  onClick={handleGenerate}
                  disabled={generating || selectedAngles.length === 0}
                >
                  {generating ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Generating videos… (bisa 5-10 menit)</>
                  ) : (
                    <><Video className="h-4 w-4" /> Generate {selectedAngles.length} variasi video</>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}
```

### 1.6 Tambah komponen `CharacterBuilder` di akhir file (sebelum closing brace terakhir / setelah `VideoVariationCard`)

```tsx
// ── CharacterBuilder ──────────────────────────────────────────────────────────

interface CharacterBuilderProps {
  name: string
  onNameChange: (n: string) => void
  photos: string[]           // base64 data URLs
  onPhotosChange: (p: string[]) => void
}

function CharacterBuilder({ name, onNameChange, photos, onPhotosChange }: CharacterBuilderProps) {
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    const remaining = 10 - photos.length
    const toAdd = Array.from(files).slice(0, remaining)
    toAdd.forEach((file) => {
      if (!file.type.startsWith('image/')) return
      const reader = new FileReader()
      reader.onload = (e) => {
        const result = e.target?.result as string
        if (result) onPhotosChange([...photos, result])
      }
      reader.readAsDataURL(file)
    })
  }

  const removePhoto = (i: number) => {
    onPhotosChange(photos.filter((_, idx) => idx !== i))
  }

  return (
    <div className="space-y-3">
      <Input
        placeholder="Nama karakter (contoh: Mbak Rini)"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        className="text-sm"
      />

      {/* Photo grid */}
      <div className="grid grid-cols-5 gap-1.5">
        {photos.map((src, i) => (
          <div key={i} className="relative group aspect-square rounded-md overflow-hidden border bg-muted">
            <img src={src} alt={`char-${i}`} className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => removePhoto(i)}
              className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="h-2.5 w-2.5 text-white" />
            </button>
          </div>
        ))}
        {photos.length < 10 && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="aspect-square rounded-md border border-dashed flex flex-col items-center justify-center gap-0.5 text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="text-[9px]">Foto</span>
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <p className="text-[10px] text-muted-foreground">
        {photos.length}/10 foto · Foto pertama jadi image reference utama untuk GeminiGen
      </p>
    </div>
  )
}
```

---

## FEATURE 2 — frontend/lib/api.ts

### 2.1 Update `translateVideoPrompt` payload type

Cari:
```ts
export async function translateVideoPrompt(payload: {
  videoAnalysis: any
  userIntent: string
  productName: string
```

Ganti dengan:
```ts
export async function translateVideoPrompt(payload: {
  videoAnalysis: any
  userIntent: string
  productName: string
  productDescription?: string
  assetMode?: 'product' | 'character' | 'none'
  characterPhotoBase64?: string
  characterPhotoMime?: string
```

### 2.2 Update `generateScaleVideoJob` payload type

Cari:
```ts
export async function generateScaleVideoJob(payload: {
  videoAnalysis: any
  productName: string
  productDescription?: string
  selectedAngles?: string[]
  aspectRatio?: string
  productPhotoBase64?: string
  productPhotoMime?: string
  /** Sprint 3 v2 — when set, every variation uses this prompt instead of the auto-built one */
  customVideoPrompt?: string | null
```

Ganti dengan:
```ts
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
```

---

## FEATURE 3 — backend/src/routes/scale-video.js

### 3.1 Update `/translate-prompt` endpoint — accept character fields

Cari dalam `router.post('/translate-prompt', ...`:
```js
  const { videoAnalysis, userIntent, productName, productDescription = '' } = req.body || {};
```

Ganti dengan:
```js
  const {
    videoAnalysis,
    userIntent,
    productName,
    productDescription = '',
    assetMode = 'product',
    characterPhotoBase64,
    characterPhotoMime = 'image/jpeg',
  } = req.body || {};
```

Ganti juga call ke `translateVideoPrompt`:
```js
    const result = await translateVideoPrompt({
      videoAnalysis,
      userIntent,
      productName,
      productDescription,
      assetMode,
      characterPhotoBase64: characterPhotoBase64 || null,
      characterPhotoMime,
    });
```

### 3.2 Update `/generate` endpoint — accept character fields

Cari destructuring dalam `router.post('/generate', ...`:
```js
  const {
    videoAnalysis,
    productName,
    productDescription = '',
    selectedAngles = [],
    aspectRatio = '9:16',
    productPhotoBase64 = null,
    productPhotoMime = 'image/jpeg',
    customVideoPrompt = null,
  } = req.body;
```

Ganti dengan:
```js
  const {
    videoAnalysis,
    productName = 'Generic',
    productDescription = '',
    selectedAngles = [],
    aspectRatio = '9:16',
    productPhotoBase64 = null,
    productPhotoMime = 'image/jpeg',
    assetMode = 'product',
    characterPhotosBase64 = [],    // array of base64 strings, no data: prefix
    customVideoPrompt = null,
  } = req.body;
```

Juga ubah validasi (hapus mandatory productName):
```js
  if (!videoAnalysis) {
    return res.status(400).json({ error: 'videoAnalysis is required' });
  }
```

Setelah Step 1 (product photo analysis), tambah Step 1b untuk karakter:
```js
  // Step 1b: If character mode with multiple photos, analyze all & combine descriptions
  let characterVisualDescription = null;
  if (assetMode === 'character' && characterPhotosBase64.length > 0) {
    try {
      const charDescriptions = await Promise.all(
        characterPhotosBase64.slice(0, 4).map((b64, i) =>
          analyzeImage({
            imageBase64: b64,
            mimeType: 'image/jpeg',
            prompt: `Describe this character photo ${i + 1}: appearance, outfit, hair, skin tone, expression, style. Be specific for AI video generation. Under 60 words.`,
          }).catch(() => null)
        )
      );
      const valid = charDescriptions.filter(Boolean);
      if (valid.length > 0) {
        characterVisualDescription = `Character "${productName}": ${valid.join(' | ')}`;
      }
    } catch (e) {
      console.warn('Character photo analysis failed (non-fatal):', e.message);
    }
  }
```

Ubah `productVisualDescription` assignment untuk karakter: setelah Step 1 & 1b, jika karakter, pakai `characterVisualDescription` sebagai `productVisualDescription`:
```js
  // Merge: for character mode, visual description comes from character photos
  if (assetMode === 'character' && characterVisualDescription) {
    productVisualDescription = characterVisualDescription;
  }
```

---

## FEATURE 4 — backend/src/services/translatePromptService.js

### 4.1 Update function signature dan prompt untuk support character/none mode

Cari:
```js
async function translateVideoPrompt({ videoAnalysis, userIntent, productName, productDescription = '' }) {
```

Ganti dengan:
```js
async function translateVideoPrompt({
  videoAnalysis,
  userIntent,
  productName,
  productDescription = '',
  assetMode = 'product',
  characterPhotoBase64 = null,
  characterPhotoMime = 'image/jpeg',
}) {
```

Tambah character photo analysis sebelum `chatCompletion` call:
```js
  // If character mode with photo, analyze character first
  let characterVisualDesc = '';
  if (assetMode === 'character' && characterPhotoBase64) {
    try {
      const { analyzeImage } = require('./apimart');
      characterVisualDesc = await analyzeImage({
        imageBase64: characterPhotoBase64,
        mimeType: characterPhotoMime || 'image/jpeg',
        prompt: 'Describe this character: appearance, outfit, hair, skin tone, expression, style. Under 60 words. For use in AI video generation prompts.',
      });
    } catch (e) {
      console.warn('[translatePrompt] character photo analysis non-fatal:', e.message);
    }
  }
```

Update prompt content section. Ganti:
```js
PRODUCT: ${productName}
${productDescription ? `PRODUCT DESCRIPTION: ${productDescription}` : ''}
```

Dengan:
```js
${assetMode === 'character'
  ? `CHARACTER NAME: ${productName}
${characterVisualDesc ? `CHARACTER APPEARANCE: ${characterVisualDesc}` : ''}
${productDescription ? `ADDITIONAL INFO: ${productDescription}` : ''}`
  : assetMode === 'none'
  ? 'ASSET: None — create a generic/conceptual video prompt without specific product or character'
  : `PRODUCT: ${productName}
${productDescription ? `PRODUCT DESCRIPTION: ${productDescription}` : ''}`
}
```

Update instruction in the prompt. Ganti:
```
   - Adapts the content to showcase "${productName}"
```
Dengan:
```
   - Adapts the content to showcase ${assetMode === 'character' ? `the character "${productName}"` : assetMode === 'none' ? 'the concept described in the user intent' : `"${productName}"`}
```

---

## AUDIT LOOP (WAJIB — ulangi sampai 0 error)

```bash
# 1. TypeScript — must be 0 errors
cd "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/frontend"
npx tsc --noEmit

# 2. Node syntax
node --check "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/backend/src/routes/scale-video.js"
node --check "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/backend/src/services/translatePromptService.js"

# 3. Verify no missing imports in page.tsx
grep -n "^import\|from '@\|from \"" "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/frontend/app/(app)/scale-video/page.tsx" | grep -E "Package|User|Ban|Plus|X |ImageIcon|useRef|CharacterBuilder"

# 4. Verify assetMode plumbing — frontend
grep -n "assetMode\|characterPhotos\|characterName\|CharacterBuilder" "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/frontend/app/(app)/scale-video/page.tsx"

# 5. Verify assetMode plumbing — backend
grep -n "assetMode\|characterPhotos\|characterVisual" "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/backend/src/routes/scale-video.js"

# 6. Verify handleGenerate no longer requires selectedProduct
grep -n "selectedProduct" "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/frontend/app/(app)/scale-video/page.tsx" | grep "disabled\|return\|if (!"
# → must NOT contain selectedProduct in disabled condition for Generate button

# 7. Fix any error found, re-run from step 1
```

---

## COMMIT + DEPLOY

```bash
cd "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator"
git add -A
git commit -m "feat: asset mode — product / character (up to 10 photos) / none in Scale Video step 2"
git push origin main
railway up --detach
```
