'use client'
import { useEffect, useRef, useState } from 'react'
import { Plus, Pencil, Trash2, Users, Loader2, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import {
  getCharacters,
  createCharacter,
  updateCharacter,
  deleteCharacter,
  type Character,
} from '@/lib/api'

const emptyForm = { name: '', description: '' }

export default function CharactersPage() {
  const [characters, setCharacters] = useState<Character[]>([])
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
      const list = await getCharacters()
      setCharacters(list)
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleEdit = (c: Character) => {
    setEditId(c.id)
    setForm({ name: c.name, description: c.description || '' })
    setExistingPhotos(c.photos || [])
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
    if (total > 10) { toast.error('Maksimal 10 foto'); return }
    setNewPhotos((prev) => [...prev, ...files])
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Nama karakter wajib diisi')
    setSaving(true)
    setError(null)
    try {
      if (editId) {
        const updated = await updateCharacter(editId, {
          name: form.name.trim(),
          description: form.description || undefined,
          photos: newPhotos.length > 0 ? newPhotos : undefined,
        })
        setCharacters((prev) => prev.map((c) => (c.id === editId ? updated : c)))
        toast.success('Karakter diperbarui')
      } else {
        const created = await createCharacter({
          name: form.name.trim(),
          description: form.description || undefined,
          photos: newPhotos,
        })
        setCharacters((prev) => [created, ...prev])
        toast.success('Karakter disimpan')
      }
      handleCancel()
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Hapus karakter "${name}"?`)) return
    try {
      await deleteCharacter(id)
      setCharacters((prev) => prev.filter((c) => c.id !== id))
      toast.success('Karakter dihapus')
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e.message)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="mb-1 inline-flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Insert Karakter</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Simpan karakter dengan foto referensi — pilih langsung saat Scale Winning Video.
          </p>
        </div>
        {!showForm && (
          <Button onClick={handleNew} size="sm">
            <Plus className="h-4 w-4" /> Tambah Karakter
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <Card className="border-primary/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{editId ? 'Edit Karakter' : 'Karakter Baru'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nama karakter *</Label>
              <Input
                placeholder="Contoh: Mbak Rini, Pak Budi"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Deskripsi (opsional)</Label>
              <Textarea
                placeholder="Usia, pekerjaan, kepribadian, gaya berpakaian..."
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                className="resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Foto referensi (maks 10)</Label>
              {/* Existing photos (edit mode) */}
              {existingPhotos.length > 0 && (
                <div className="grid grid-cols-5 gap-1.5 mb-2">
                  {existingPhotos.map((src, i) => (
                    <div key={i} className="relative group aspect-square rounded-md overflow-hidden border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="text-white text-[10px]">Existing</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {/* New photos preview */}
              {newPhotos.length > 0 && (
                <div className="grid grid-cols-5 gap-1.5 mb-2">
                  {newPhotos.map((file, i) => (
                    <div key={i} className="relative group aspect-square rounded-md overflow-hidden border bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={URL.createObjectURL(file)} alt="" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setNewPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                        className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-2.5 w-2.5 text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={existingPhotos.length + newPhotos.length >= 10}
              >
                <Plus className="h-3.5 w-3.5" />
                {editId ? 'Ganti foto' : 'Tambah foto'}
              </Button>
              <p className="text-[11px] text-muted-foreground">
                {existingPhotos.length + newPhotos.length}/10 foto · Foto pertama dipakai sebagai referensi utama
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {saving ? 'Menyimpan…' : 'Simpan'}
              </Button>
              <Button variant="outline" size="sm" onClick={handleCancel}>
                Batal
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Character list */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat karakter…
        </div>
      ) : characters.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          <Users className="mx-auto mb-3 h-10 w-10 opacity-40" />
          <p className="font-medium">Belum ada karakter tersimpan.</p>
          <p className="mt-1 text-sm">Tambah karakter dengan foto referensi untuk dipakai di Scale Winning Video.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {characters.map((c) => (
            <Card key={c.id} className="overflow-hidden">
              {/* Photo strip */}
              {c.photos && c.photos.length > 0 && (
                <div className="flex gap-0.5 overflow-hidden h-28 bg-muted">
                  {c.photos.slice(0, 5).map((src, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={src}
                      alt=""
                      className="flex-1 object-cover min-w-0"
                      style={{ maxWidth: `${100 / Math.min(c.photos!.length, 5)}%` }}
                    />
                  ))}
                </div>
              )}
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-sm leading-tight">{c.name}</p>
                    {c.photos && c.photos.length > 0 && (
                      <p className="text-[11px] text-muted-foreground">{c.photos.length} foto</p>
                    )}
                    {c.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.description}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleEdit(c)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(c.id, c.name)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
