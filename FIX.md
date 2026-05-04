# FIX.md — Ads Creative Generator: Full Fix & Feature Sprint

> Execute all tasks autonomously in order. No manual steps. Commit + push at the end.

---

## PREP: Delete old MD files first

```bash
rm -f CLAUDE_CODE_PROMPT.md DEPLOY.md
```

---

## TASK 1 — Fix apimart.ai 404 (image & video generation broken)

### 1a. Discover correct models

Run this Node snippet inside `backend/` to probe the available models:

```bash
cd backend && node -e "
const axios = require('axios');
const key = require('./src/config').apimart.apiKey;
Promise.all([
  axios.get('https://apimart.ai/api/v1/models', { headers: { Authorization: 'Bearer ' + key } }),
  axios.get('https://api.apimart.ai/v1/models', { headers: { Authorization: 'Bearer ' + key } }),
]).then(([r1, r2]) => {
  console.log('CHAT MODELS:', JSON.stringify(r1.data, null, 2));
  console.log('IMAGE MODELS:', JSON.stringify(r2.data, null, 2));
}).catch(e => console.error(e.response?.data || e.message));
"
```

Based on the output, update the model names in `backend/src/config/index.js` to ones that actually exist on apimart.ai. Common apimart.ai models are:
- Image: `flux`, `flux-pro`, `flux-1.1-pro`, `stable-diffusion-3.5-large`, `dall-e-3`
- Video: `kling-v1`, `kling-v1-5`, `minimax-video-01`, `hailuo`, `runway-gen3`
- Vision/Chat: `gpt-4o`, `claude-3-5-sonnet`, `gemini-1.5-pro`

If model discovery fails or returns nothing useful, default to:
```js
image: process.env.IMAGE_MODEL || 'flux-1.1-pro',
video: process.env.VIDEO_MODEL || 'kling-v1-5',
vision: process.env.VISION_MODEL || 'gpt-4o',
chat: process.env.CHAT_MODEL || 'gpt-4o',
```

### 1b. Fix apimart.js — robust error handling + correct polling

Replace `backend/src/services/apimart.js` with this improved version that:
- Handles both sync and async image responses correctly
- Polls task status with better error messages
- Has correct size map for video aspect ratios
- Falls back gracefully if task result shape differs

```js
const axios = require('axios');
const config = require('../config');

const CHAT_BASE = config.apimart.baseUrl; // https://apimart.ai/api/v1
const IMAGE_BASE = process.env.APIMART_IMAGE_BASE || 'https://api.apimart.ai/v1';

const chatClient = axios.create({
  baseURL: CHAT_BASE,
  headers: {
    Authorization: `Bearer ${config.apimart.apiKey}`,
    'Content-Type': 'application/json',
  },
  timeout: 120000,
});

const imageClient = axios.create({
  baseURL: IMAGE_BASE,
  headers: {
    Authorization: `Bearer ${config.apimart.apiKey}`,
    'Content-Type': 'application/json',
  },
  timeout: 60000,
});

async function chatCompletion({ model, messages, maxTokens = 1500, temperature = 0.7 }) {
  const response = await chatClient.post('/chat/completions', {
    model: model || config.models.chat,
    messages,
    max_tokens: maxTokens,
    temperature,
  });
  return response.data.choices[0].message.content;
}

async function analyzeImage({ imageBase64, mimeType = 'image/jpeg', prompt }) {
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        { type: 'text', text: prompt },
      ],
    },
  ];
  return await chatCompletion({ model: config.models.vision, messages, maxTokens: 2000 });
}

async function submitImageJob({ prompt, size = '1024x1024', model, n = 1 }) {
  const payload = {
    model: model || config.models.image,
    prompt,
    size,
    n,
  };
  const response = await imageClient.post('/images/generations', payload);
  // Async: { code:200, data:[{ status:"submitted", task_id:"..." }] }
  // Sync:  { code:200, data:[{ url:"..." }] }
  // Also handle: { data: { task_id: "..." } } flat shape
  const rawData = response.data?.data;
  const firstItem = Array.isArray(rawData) ? rawData[0] : rawData;
  if (!firstItem) {
    throw new Error('Invalid image-generation response: ' + JSON.stringify(response.data).slice(0, 300));
  }
  return firstItem;
}

async function getTask(taskId) {
  const response = await imageClient.get(`/tasks/${taskId}`);
  // Handle both { data: {...} } and { data: { data: {...} } }
  return response.data?.data ?? response.data;
}

async function generateImage({ prompt, size = '1024x1024', model, pollIntervalMs = 5000, timeoutMs = 180000 }) {
  const submitted = await submitImageJob({ prompt, size, model });

  // Sync path — url returned immediately
  if (submitted.url) {
    const url = Array.isArray(submitted.url) ? submitted.url[0] : submitted.url;
    return [{ url }];
  }

  const taskId = submitted.task_id || submitted.taskId || submitted.id;
  if (!taskId) {
    throw new Error('No task_id in image response: ' + JSON.stringify(submitted).slice(0, 300));
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const task = await getTask(taskId);
    const status = (task.status || '').toLowerCase();

    if (status === 'completed' || status === 'succeed' || status === 'success') {
      // Various result shapes from different providers
      const images =
        task.result?.images ||
        task.images ||
        task.result?.data ||
        task.output?.images ||
        [];
      if (images.length) {
        const url = Array.isArray(images[0].url) ? images[0].url[0] : (images[0].url || images[0]);
        return [{ url }];
      }
      // Some providers put url directly on result
      const directUrl = task.result?.url || task.url || task.output?.url;
      if (directUrl) return [{ url: directUrl }];
      throw new Error('Task completed but no images found: ' + JSON.stringify(task).slice(0, 300));
    }

    if (['failed', 'error', 'cancelled'].includes(status)) {
      throw new Error('Image generation task failed: ' + JSON.stringify(task).slice(0, 300));
    }
    // status pending/processing/queued — keep polling
  }
  throw new Error(`Image generation timed out after ${timeoutMs}ms (task ${taskId})`);
}

async function generateVideo({ prompt, duration = 5, aspectRatio = '16:9', model }) {
  const payload = {
    model: model || config.models.video,
    prompt,
    duration,
    aspect_ratio: aspectRatio,
  };
  const response = await imageClient.post('/videos/generations', payload);
  const rawData = response.data?.data;
  return Array.isArray(rawData) ? rawData[0] : (rawData || response.data);
}

async function pollVideoTask({ taskId, pollIntervalMs = 5000, timeoutMs = 300000 }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const task = await getTask(taskId);
    const status = (task.status || '').toLowerCase();

    if (status === 'completed' || status === 'succeed' || status === 'success') {
      const videoUrl =
        task.result?.video_url ||
        task.result?.url ||
        task.video_url ||
        task.url ||
        task.output?.url;
      return { status: 'completed', videoUrl };
    }
    if (['failed', 'error', 'cancelled'].includes(status)) {
      return { status: 'failed', error: JSON.stringify(task).slice(0, 200) };
    }
    return { status: task.status || 'processing', progress: task.progress };
  }
  return { status: 'timeout' };
}

async function checkVideoStatus(taskId) {
  return await getTask(taskId);
}

module.exports = {
  chatCompletion,
  analyzeImage,
  submitImageJob,
  generateImage,
  getTask,
  generateVideo,
  pollVideoTask,
  checkVideoStatus,
};
```

### 1c. Add `/api/tasks/:id` route for frontend to poll video status

In `backend/src/index.js`, add after the existing routes:

```js
// Task polling for async video jobs
app.get('/api/tasks/:id', require('./middleware/auth').requireAuth, async (req, res) => {
  const { getTask } = require('./services/apimart');
  const task = await getTask(req.params.id);
  res.json(task);
});
```

---

## TASK 2 — Fix orphaned pages (move into (app) route group)

The pages at `frontend/app/scale/page.tsx`, `frontend/app/create/page.tsx`, and `frontend/app/history/page.tsx` are **outside** the `(app)` layout group — they have no Sidebar and no AuthGuard.

### 2a. Create new route structure

```
frontend/app/(app)/scale/page.tsx        ← move from app/scale/page.tsx
frontend/app/(app)/create/page.tsx       ← move from app/create/page.tsx
frontend/app/(app)/history/page.tsx      ← move from app/history/page.tsx
```

**Steps:**
1. `mkdir -p frontend/app/(app)/scale frontend/app/(app)/create frontend/app/(app)/history`
2. Copy content of `frontend/app/scale/page.tsx` → `frontend/app/(app)/scale/page.tsx`
3. Copy content of `frontend/app/create/page.tsx` → `frontend/app/(app)/create/page.tsx`
4. Copy content of `frontend/app/history/page.tsx` → `frontend/app/(app)/history/page.tsx`
5. Delete the old orphaned files:
   - `rm frontend/app/scale/page.tsx && rmdir frontend/app/scale`
   - `rm frontend/app/create/page.tsx && rmdir frontend/app/create`
   - `rm frontend/app/history/page.tsx && rmdir frontend/app/history`

The `(app)/layout.tsx` already wraps children in `<AuthGuard>` + `<Sidebar>`, so these pages will automatically get the full layout.

---

## TASK 3 — New "Insert Produk" menu (Product CRUD)

### 3a. Add Prisma model

In `backend/prisma/schema.prisma`, add after the `AuditLog` model:

```prisma
model Product {
  id             String   @id @default(cuid())
  userId         String   @map("user_id")
  name           String
  description    String?  @db.Text
  usp            String?  @db.Text
  targetAudience String?  @map("target_audience")
  adGoal         String?  @map("ad_goal")
  brandColors    String?  @map("brand_colors")
  isDefault      Boolean  @default(false) @map("is_default")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt(sort: Desc)])
  @@map("products")
}
```

Also add to the `User` model: `products Product[]`

### 3b. Create backend CRUD route

Create `backend/src/routes/products.js`:

```js
const express = require('express');
const router = express.Router();
const { prisma } = require('../db/prisma');
const { requireAuth } = require('../middleware/auth');
const { z } = require('zod');

const productSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  usp: z.string().optional(),
  targetAudience: z.string().optional(),
  adGoal: z.string().optional(),
  brandColors: z.string().optional(),
  isDefault: z.boolean().optional(),
});

// GET /api/products — list user's products
router.get('/', requireAuth, async (req, res) => {
  const products = await prisma.product.findMany({
    where: { userId: req.user.id },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
  res.json({ products });
});

// POST /api/products — create
router.post('/', requireAuth, async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data = parsed.data;

  // If setting as default, clear other defaults first
  if (data.isDefault) {
    await prisma.product.updateMany({
      where: { userId: req.user.id },
      data: { isDefault: false },
    });
  }

  const product = await prisma.product.create({
    data: {
      userId: req.user.id,
      name: data.name,
      description: data.description || null,
      usp: data.usp || null,
      targetAudience: data.targetAudience || null,
      adGoal: data.adGoal || null,
      brandColors: data.brandColors || null,
      isDefault: data.isDefault || false,
    },
  });
  res.status(201).json({ product });
});

// PUT /api/products/:id — update
router.put('/:id', requireAuth, async (req, res) => {
  const existing = await prisma.product.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  const parsed = productSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data = parsed.data;

  if (data.isDefault) {
    await prisma.product.updateMany({
      where: { userId: req.user.id, id: { not: req.params.id } },
      data: { isDefault: false },
    });
  }

  const product = await prisma.product.update({
    where: { id: req.params.id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.usp !== undefined && { usp: data.usp }),
      ...(data.targetAudience !== undefined && { targetAudience: data.targetAudience }),
      ...(data.adGoal !== undefined && { adGoal: data.adGoal }),
      ...(data.brandColors !== undefined && { brandColors: data.brandColors }),
      ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
    },
  });
  res.json({ product });
});

// DELETE /api/products/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const existing = await prisma.product.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  await prisma.product.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

module.exports = router;
```

Register in `backend/src/index.js` — add after the library route line:
```js
const productRoutes = require('./routes/products');
// ...
app.use('/api/products', productRoutes);
```

### 3c. Add Product API helpers to frontend

In `frontend/lib/api.ts`, add these functions at the bottom (before the last export if any):

```ts
// --- Products ---

export interface Product {
  id: string
  name: string
  description?: string
  usp?: string
  targetAudience?: string
  adGoal?: string
  brandColors?: string
  isDefault: boolean
  createdAt: string
}

export async function getProducts(): Promise<Product[]> {
  const res = await api.get<{ products: Product[] }>('/products')
  return res.data.products
}

export async function createProduct(data: Omit<Product, 'id' | 'createdAt'>): Promise<Product> {
  const res = await api.post<{ product: Product }>('/products', data)
  return res.data.product
}

export async function updateProduct(id: string, data: Partial<Omit<Product, 'id' | 'createdAt'>>): Promise<Product> {
  const res = await api.put<{ product: Product }>(`/products/${id}`, data)
  return res.data.product
}

export async function deleteProduct(id: string): Promise<void> {
  await api.delete(`/products/${id}`)
}
```

### 3d. Create frontend Products page

Create `frontend/app/(app)/products/page.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Star, StarOff, Package, Loader2, Check, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  type Product,
} from '@/lib/api'

const emptyForm = {
  name: '',
  description: '',
  usp: '',
  targetAudience: '',
  adGoal: '',
  brandColors: '',
  isDefault: false,
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      const list = await getProducts()
      setProducts(list)
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleEdit = (p: Product) => {
    setEditId(p.id)
    setForm({
      name: p.name,
      description: p.description || '',
      usp: p.usp || '',
      targetAudience: p.targetAudience || '',
      adGoal: p.adGoal || '',
      brandColors: p.brandColors || '',
      isDefault: p.isDefault,
    })
    setShowForm(true)
  }

  const handleNew = () => {
    setEditId(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditId(null)
    setForm(emptyForm)
  }

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Nama produk wajib diisi')
    setSaving(true)
    try {
      if (editId) {
        const updated = await updateProduct(editId, form)
        setProducts((prev) => prev.map((p) => {
          if (form.isDefault && p.id !== editId) return { ...p, isDefault: false }
          if (p.id === editId) return updated
          return p
        }))
        toast.success('Produk diperbarui')
      } else {
        const created = await createProduct(form)
        setProducts((prev) => {
          const next = form.isDefault ? prev.map((p) => ({ ...p, isDefault: false })) : prev
          return [created, ...next]
        })
        toast.success('Produk disimpan')
      }
      handleCancel()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Hapus produk ini?')) return
    try {
      await deleteProduct(id)
      setProducts((prev) => prev.filter((p) => p.id !== id))
      toast.success('Produk dihapus')
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e.message)
    }
  }

  const handleSetDefault = async (p: Product) => {
    try {
      await updateProduct(p.id, { isDefault: true })
      setProducts((prev) => prev.map((x) => ({ ...x, isDefault: x.id === p.id })))
      toast.success(`"${p.name}" dijadikan produk default`)
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e.message)
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Produk</h1>
          </div>
          <p className="text-muted-foreground">
            Simpan info produk sekali, langsung tersedia di semua flow generate.
          </p>
        </div>
        {!showForm && (
          <Button onClick={handleNew}>
            <Plus className="h-4 w-4" /> Tambah Produk
          </Button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{editId ? 'Edit Produk' : 'Tambah Produk Baru'}</CardTitle>
            <CardDescription>Info ini akan tersedia sebagai pilihan di form generate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Nama produk <span className="text-destructive">*</span></Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Contoh: Glow Serum Vitamin C"
                />
              </div>
              <div className="space-y-2">
                <Label>Tujuan iklan</Label>
                <Input
                  value={form.adGoal}
                  onChange={(e) => setForm({ ...form, adGoal: e.target.value })}
                  placeholder="Contoh: Conversion / brand awareness"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Deskripsi produk</Label>
                <Textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Apa produknya & manfaat utamanya?"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>USP / keunggulan</Label>
                <Textarea
                  rows={2}
                  value={form.usp}
                  onChange={(e) => setForm({ ...form, usp: e.target.value })}
                  placeholder="Keunggulan utama dibanding kompetitor"
                />
              </div>
              <div className="space-y-2">
                <Label>Target audience</Label>
                <Input
                  value={form.targetAudience}
                  onChange={(e) => setForm({ ...form, targetAudience: e.target.value })}
                  placeholder="Contoh: Wanita 25-35, urban, suka skincare"
                />
              </div>
              <div className="space-y-2">
                <Label>Brand colors</Label>
                <Input
                  value={form.brandColors}
                  onChange={(e) => setForm({ ...form, brandColors: e.target.value })}
                  placeholder="Contoh: pink pastel, cream, gold"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                id="isDefault"
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                className="h-4 w-4 accent-primary"
              />
              <Label htmlFor="isDefault" className="cursor-pointer">Jadikan produk default</Label>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {editId ? 'Simpan perubahan' : 'Simpan produk'}
              </Button>
              <Button variant="outline" onClick={handleCancel} disabled={saving}>Batal</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat produk…
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          <Package className="mx-auto mb-3 h-10 w-10 opacity-40" />
          <p className="font-medium">Belum ada produk tersimpan.</p>
          <p className="mt-1 text-sm">Klik "Tambah Produk" untuk menyimpan info produk pertamamu.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <Card key={p.id} className={p.isDefault ? 'ring-2 ring-primary/40' : ''}>
              <CardContent className="p-4">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{p.name}</p>
                    {p.adGoal && <p className="mt-0.5 text-xs text-muted-foreground">{p.adGoal}</p>}
                  </div>
                  {p.isDefault && <Badge variant="secondary" className="shrink-0">Default</Badge>}
                </div>
                {p.description && (
                  <p className="mb-2 line-clamp-2 text-sm text-muted-foreground">{p.description}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-1">
                  {p.targetAudience && (
                    <Badge variant="outline" className="text-xs">{p.targetAudience}</Badge>
                  )}
                  {p.brandColors && (
                    <Badge variant="outline" className="text-xs">{p.brandColors}</Badge>
                  )}
                </div>
                <div className="mt-4 flex items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => handleEdit(p)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {!p.isDefault && (
                    <Button size="sm" variant="outline" onClick={() => handleSetDefault(p)} title="Jadikan default">
                      <Star className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDelete(p.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
```

---

## TASK 4 — Sync Scale & Create pages with saved products

### 4a. Update Scale page to pre-fill from saved product

In `frontend/app/(app)/scale/page.tsx`, add product selector at the top of the form. When user picks a saved product, auto-fill `productName`.

Add this import:
```ts
import { useEffect, useState } from 'react'
import { getProducts, type Product } from '@/lib/api'
```

Add state after existing state declarations:
```ts
const [products, setProducts] = useState<Product[]>([])
const [selectedProductId, setSelectedProductId] = useState<string>('')
```

Add useEffect to load products:
```ts
useEffect(() => {
  getProducts().then((list) => {
    setProducts(list)
    const def = list.find((p) => p.isDefault)
    if (def) {
      setSelectedProductId(def.id)
      setProductName(def.name)
    }
  }).catch(() => {})
}, [])
```

In the form section (inside the `analysisResp &&` Card, before the productName Input), add a product selector:
```tsx
{products.length > 0 && (
  <div className="space-y-2">
    <Label>Produk tersimpan</Label>
    <Select
      value={selectedProductId}
      onValueChange={(id) => {
        setSelectedProductId(id)
        const p = products.find((x) => x.id === id)
        if (p) setProductName(p.name)
      }}
    >
      <SelectTrigger><SelectValue placeholder="Pilih produk…" /></SelectTrigger>
      <SelectContent>
        {products.map((p) => (
          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
)}
```

### 4b. Update Create page to pre-fill from saved product

In `frontend/app/(app)/create/page.tsx`, add product selector in Step 2.

Add import:
```ts
import { getProducts, type Product } from '@/lib/api'
```

Add state:
```ts
const [savedProducts, setSavedProducts] = useState<Product[]>([])
const [selectedProductId, setSelectedProductId] = useState<string>('')
```

Add useEffect:
```ts
useEffect(() => {
  getProducts().then((list) => {
    setSavedProducts(list)
    const def = list.find((p) => p.isDefault)
    if (def) {
      setSelectedProductId(def.id)
      setProduct({
        productName: def.name,
        description: def.description || '',
        usp: def.usp || '',
        targetAudience: def.targetAudience || '',
        adGoal: def.adGoal || '',
        brandColors: def.brandColors || '',
      })
    }
  }).catch(() => {})
}, [])
```

In Step 2 card, before the grid of fields, add:
```tsx
{savedProducts.length > 0 && (
  <div className="mb-4 space-y-2">
    <Label>Muat dari produk tersimpan</Label>
    <Select
      value={selectedProductId}
      onValueChange={(id) => {
        setSelectedProductId(id)
        const p = savedProducts.find((x) => x.id === id)
        if (p) setProduct({
          productName: p.name,
          description: p.description || '',
          usp: p.usp || '',
          targetAudience: p.targetAudience || '',
          adGoal: p.adGoal || '',
          brandColors: p.brandColors || '',
        })
      }}
    >
      <SelectTrigger><SelectValue placeholder="Pilih produk…" /></SelectTrigger>
      <SelectContent>
        {savedProducts.map((p) => (
          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
    <p className="text-xs text-muted-foreground">Form akan terisi otomatis. Kamu tetap bisa edit manual.</p>
  </div>
)}
```

---

## TASK 5 — Update Sidebar navigation

Replace `frontend/components/layout/Sidebar.tsx` navGroups with:

```ts
const navGroups = [
  {
    label: 'Workspace',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/library', label: 'Library', icon: Library },
      { href: '/history', label: 'History', icon: History },
    ],
  },
  {
    label: 'Generate',
    items: [
      { href: '/generate/single-image', label: 'Single Image', icon: ImageIcon },
      { href: '/scale', label: 'Scale Winning', icon: Wand2 },
      { href: '/create', label: 'Create w/ Reference', icon: Sparkles },
    ],
  },
  {
    label: 'Produk',
    items: [
      { href: '/products', label: 'Insert Produk', icon: Package },
    ],
  },
  {
    label: 'Account',
    items: [{ href: '/profile', label: 'Profile', icon: UserIcon }],
  },
]
```

Add these imports at the top of the Sidebar file:
```ts
import { History, Package } from 'lucide-react'
```

---

## TASK 6 — Fix History page

The current `history/page.tsx` content — after moving into `(app)/history/` — should work. But verify it uses `@/lib/history` correctly. If it's a simple page, ensure it calls `getHistory()` and renders entries.

If the history page is empty or broken, replace its content with:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { History as HistoryIcon, ImageIcon, Layers, Wand2, Trash2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getHistory, clearHistory, type HistoryEntry } from '@/lib/history'

const kindIcon = { scale: Layers, create: Wand2, carousel: Wand2, 'single-image': ImageIcon }
const kindLabel = { scale: 'Scale', create: 'Create', carousel: 'Carousel', 'single-image': 'Single Image' }

export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])

  useEffect(() => { setEntries(getHistory()) }, [])

  const handleClear = () => {
    clearHistory()
    setEntries([])
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2">
            <HistoryIcon className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">History</h1>
          </div>
          <p className="text-muted-foreground">Riwayat generate yang tersimpan di browser.</p>
        </div>
        {entries.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleClear}>
            <Trash2 className="h-4 w-4" /> Hapus semua
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          <HistoryIcon className="mx-auto mb-3 h-10 w-10 opacity-40" />
          <p>Belum ada riwayat generate.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((e) => {
            const Icon = kindIcon[e.kind] || ImageIcon
            return (
              <Card key={e.id}>
                <CardContent className="p-4">
                  {e.thumbnailUrl && (
                    <img
                      src={e.thumbnailUrl}
                      alt={e.productName}
                      className="mb-3 h-32 w-full rounded-md object-cover"
                      onError={(ev) => ((ev.target as HTMLImageElement).style.display = 'none')}
                    />
                  )}
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <p className="truncate font-medium">{e.productName}</p>
                    <Badge variant="secondary" className="ml-auto shrink-0 text-xs">
                      {kindLabel[e.kind] || e.kind}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(e.createdAt).toLocaleString('id-ID')}
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

Also check `frontend/lib/history.ts` — ensure it exports `getHistory`, `saveHistoryEntry`, `clearHistory`, and `HistoryEntry` type. If `clearHistory` is missing, add:
```ts
export function clearHistory(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(HISTORY_KEY)
}
```

---

## TASK 7 — Run prisma db push + test build

After all code changes:

```bash
# In backend directory
cd backend
npx prisma generate
# (db push happens at deploy time via railway.json)

# In frontend directory
cd ../frontend
npm run build
```

Fix any TypeScript/build errors before committing.

---

## TASK 8 — Git commit & push

```bash
cd "/path/to/project/root"
git add -A
git commit -m "fix: move orphaned pages to (app) group, add products CRUD, fix apimart integration, sync generate flows with products"
git push origin main
```

Railway will auto-redeploy (runs `prisma db push` then starts server).
Vercel will auto-redeploy frontend.

---

## Summary checklist

- [ ] Old MD files deleted (CLAUDE_CODE_PROMPT.md, DEPLOY.md)
- [ ] apimart.js rewritten with robust polling + correct model defaults
- [ ] `/api/tasks/:id` route added for video status polling
- [ ] scale, create, history pages moved into `(app)/` group
- [ ] Product Prisma model added to schema.prisma
- [ ] `User` model updated with `products Product[]` relation
- [ ] `backend/src/routes/products.js` created (CRUD)
- [ ] products route registered in index.js
- [ ] Product API helpers added to `frontend/lib/api.ts`
- [ ] `frontend/app/(app)/products/page.tsx` created
- [ ] Scale page updated with product selector + auto-fill
- [ ] Create page updated with product selector + auto-fill
- [ ] Sidebar updated: added History, Products, removed "(legacy)" label
- [ ] History page working with clearHistory
- [ ] `npm run build` passes with no errors
- [ ] Committed and pushed to main
