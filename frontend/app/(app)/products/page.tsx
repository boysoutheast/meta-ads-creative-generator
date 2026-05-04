'use client'
import { useEffect, useRef, useState } from 'react'
import { Plus, Pencil, Trash2, Package, Loader2, Check, AlertCircle, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { getProducts, createProduct, updateProduct, deleteProduct, type Product } from '@/lib/api'

const fmt = (n?: number) =>
  n !== undefined ? 'Rp ' + n.toLocaleString('id-ID') : ''

const emptyForm = {
  name: '',
  description: '',
  texture: '',
  price: '',
  promoPrice: '',
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [newPhotos, setNewPhotos] = useState<File[]>([])
  const [existingPhotos, setExistingPhotos] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

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
      texture: p.texture || '',
      price: p.price !== undefined ? String(p.price) : '',
      promoPrice: p.promoPrice !== undefined ? String(p.promoPrice) : '',
    })
    setExistingPhotos(p.photos || [])
    setNewPhotos([])
    setShowForm(true)
  }

  const handleNew = () => {
    setEditId(null)
    setForm(emptyForm)
    setExistingPhotos([])
    setNewPhotos([])
    setShowForm(true)
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditId(null)
    setForm(emptyForm)
    setNewPhotos([])
    setExistingPhotos([])
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const total = existingPhotos.length + newPhotos.length + files.length
    if (total > 5) {
      toast.error('Maksimal 5 foto')
      return
    }
    setNewPhotos((prev) => [...prev, ...files])
    if (fileRef.current) fileRef.current.value = ''
  }

  const removeNewPhoto = (i: number) =>
    setNewPhotos((prev) => prev.filter((_, idx) => idx !== i))

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Nama produk wajib diisi')
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description || undefined,
        texture: form.texture || undefined,
        price: form.price ? parseFloat(form.price) : undefined,
        promoPrice: form.promoPrice ? parseFloat(form.promoPrice) : undefined,
        photos: newPhotos.length > 0 ? newPhotos : undefined,
      }
      if (editId) {
        const updated = await updateProduct(editId, payload)
        setProducts((prev) => prev.map((p) => (p.id === editId ? updated : p)))
        toast.success('Produk diperbarui')
      } else {
        const created = await createProduct(payload)
        setProducts((prev) => [created, ...prev])
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

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

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
            {/* 1. Nama */}
            <div className="space-y-2">
              <Label>Nama produk <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Contoh: Glow Serum Vitamin C"
              />
            </div>

            {/* 2. Deskripsi */}
            <div className="space-y-2">
              <Label>Deskripsi</Label>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Apa produknya & manfaat utamanya?"
              />
            </div>

            {/* 3. Tekstur */}
            <div className="space-y-2">
              <Label>Tekstur</Label>
              <Input
                value={form.texture}
                onChange={(e) => setForm({ ...form, texture: e.target.value })}
                placeholder="Contoh: ringan, cepat menyerap, tidak lengket"
              />
            </div>

            {/* 4. Upload foto */}
            <div className="space-y-2">
              <Label>Foto produk (maks 5)</Label>
              <div className="flex flex-wrap gap-2">
                {/* Existing photos (edit mode) */}
                {existingPhotos.map((url, i) => (
                  <div key={i} className="relative h-20 w-20 shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${API_URL}${url}`}
                      alt=""
                      className="h-full w-full rounded-md object-cover"
                    />
                    <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-muted-foreground/60 text-[10px] text-white">
                      ✓
                    </span>
                  </div>
                ))}
                {/* New photo previews */}
                {newPhotos.map((file, i) => (
                  <div key={i} className="relative h-20 w-20 shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={URL.createObjectURL(file)}
                      alt=""
                      className="h-full w-full rounded-md object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeNewPhoto(i)}
                      className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-white"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
                {/* Add button */}
                {existingPhotos.length + newPhotos.length < 5 && (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/30 text-muted-foreground hover:border-primary hover:text-primary"
                  >
                    <Plus className="h-6 w-6" />
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
              <p className="text-xs text-muted-foreground">
                {editId ? 'Upload foto baru akan menggantikan semua foto lama.' : 'Upload hingga 5 foto.'}
              </p>
            </div>

            {/* 5 & 6. Harga */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Harga jual</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">Rp</span>
                  <Input
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    placeholder="0"
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Harga promo</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">Rp</span>
                  <Input
                    type="number"
                    value={form.promoPrice}
                    onChange={(e) => setForm({ ...form, promoPrice: e.target.value })}
                    placeholder="0"
                    className="pl-10"
                  />
                </div>
              </div>
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
          <p className="mt-1 text-sm">Klik &quot;Tambah Produk&quot; untuk menyimpan info produk pertamamu.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <Card key={p.id}>
              <CardContent className="p-4">
                <div className="mb-3 flex items-start gap-3">
                  {/* Thumbnail */}
                  {p.photos && p.photos.length > 0 ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`${API_URL}${p.photos[0]}`}
                      alt={p.name}
                      className="h-20 w-20 shrink-0 rounded-md object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  ) : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Package className="h-8 w-8 text-muted-foreground/40" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{p.name}</p>
                    {p.description && (
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{p.description}</p>
                    )}
                  </div>
                </div>

                {/* Price row */}
                {(p.price !== undefined || p.promoPrice !== undefined) && (
                  <div className="mb-2 flex items-center gap-2 text-sm">
                    {p.promoPrice !== undefined ? (
                      <>
                        <span className="font-medium text-primary">{fmt(p.promoPrice)}</span>
                        <span className="text-muted-foreground line-through">{fmt(p.price)}</span>
                      </>
                    ) : (
                      <span className="font-medium">{fmt(p.price)}</span>
                    )}
                  </div>
                )}

                {/* Texture badge */}
                {p.texture && (
                  <Badge variant="outline" className="mb-3 text-xs">{p.texture}</Badge>
                )}

                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => handleEdit(p)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
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
