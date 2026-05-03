'use client'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2, User as UserIcon, Lock } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/lib/auth'
import { updateProfile, changePassword } from '@/lib/api-auth'

const ProfileSchema = z.object({
  name: z.string().min(2, 'Nama minimal 2 karakter').max(80),
})
const PasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Wajib diisi'),
    newPassword: z.string().min(8, 'Min. 8 karakter'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Password tidak cocok',
  })

export default function ProfilePage() {
  const { user, setUser } = useAuthStore()
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  const profileForm = useForm<{ name: string }>({
    resolver: zodResolver(ProfileSchema),
    defaultValues: { name: user?.name || '' },
  })
  const pwForm = useForm<{ currentPassword: string; newPassword: string; confirmPassword: string }>({
    resolver: zodResolver(PasswordSchema),
  })

  const submitProfile = async (data: { name: string }) => {
    setSavingProfile(true)
    try {
      const updated = await updateProfile(data)
      setUser(updated)
      toast.success('Profile diupdate')
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Gagal update profile')
    } finally {
      setSavingProfile(false)
    }
  }

  const submitPw = async (data: any) => {
    setSavingPassword(true)
    try {
      await changePassword({ currentPassword: data.currentPassword, newPassword: data.newPassword })
      toast.success('Password diganti')
      pwForm.reset()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Gagal ganti password')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 inline-flex items-center gap-2">
          <UserIcon className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        </div>
        <p className="text-muted-foreground">Kelola info akun kamu</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Info dasar</CardTitle>
          <CardDescription>Email tidak bisa diubah saat ini</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={profileForm.handleSubmit(submitProfile)} className="space-y-4 max-w-md">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={user?.email || ''} disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Nama</Label>
              <Input id="name" {...profileForm.register('name')} aria-invalid={!!profileForm.formState.errors.name} />
              {profileForm.formState.errors.name && (
                <p className="text-xs text-destructive">{profileForm.formState.errors.name.message}</p>
              )}
            </div>
            <Button type="submit" disabled={savingProfile}>
              {savingProfile && <Loader2 className="h-4 w-4 animate-spin" />}
              Simpan
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base inline-flex items-center gap-2">
            <Lock className="h-4 w-4" /> Ganti password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={pwForm.handleSubmit(submitPw)} className="space-y-4 max-w-md">
            <div className="space-y-2">
              <Label htmlFor="cur">Password saat ini</Label>
              <Input id="cur" type="password" {...pwForm.register('currentPassword')} />
              {pwForm.formState.errors.currentPassword && (
                <p className="text-xs text-destructive">{pwForm.formState.errors.currentPassword.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="new">Password baru</Label>
              <Input id="new" type="password" {...pwForm.register('newPassword')} />
              {pwForm.formState.errors.newPassword && (
                <p className="text-xs text-destructive">{pwForm.formState.errors.newPassword.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="conf">Ulangi password baru</Label>
              <Input id="conf" type="password" {...pwForm.register('confirmPassword')} />
              {pwForm.formState.errors.confirmPassword && (
                <p className="text-xs text-destructive">{pwForm.formState.errors.confirmPassword.message}</p>
              )}
            </div>
            <Button type="submit" disabled={savingPassword}>
              {savingPassword && <Loader2 className="h-4 w-4 animate-spin" />}
              Ganti password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
