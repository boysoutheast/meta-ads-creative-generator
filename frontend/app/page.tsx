'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'

export default function HomePage() {
  const router = useRouter()
  const { hydrated, token } = useAuthStore()

  useEffect(() => {
    if (!hydrated) return
    router.replace(token ? '/dashboard' : '/login')
  }, [hydrated, token, router])

  return (
    <div className="flex min-h-screen items-center justify-center text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  )
}
