import { AuthGuard } from '@/components/auth/AuthGuard'
import { Sidebar } from '@/components/layout/Sidebar'
import { MobileNav } from '@/components/layout/MobileNav'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 overflow-x-hidden">
          <MobileNav />
          <div className="mx-auto max-w-6xl px-4 py-4 md:px-8 md:py-8">{children}</div>
        </main>
      </div>
    </AuthGuard>
  )
}
