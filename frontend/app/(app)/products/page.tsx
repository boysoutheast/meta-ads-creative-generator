'use client'
import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Star, Package, Loader2, Check, AlertCircle } from 'lucide-react'
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
          <p className="mt-1 text-sm">Klik &quot;Tambah Produk&quot; untuk menyimpan info produk pertamamu.</p>
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
