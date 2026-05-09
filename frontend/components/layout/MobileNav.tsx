'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Menu, X, Sparkles, LogOut,
  LayoutDashboard, Clapperboard, History, Layers, Video, Wand2, Film,
  Library as LibraryIcon, Image as ImageIcon, Package, User as UserIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/lib/auth'
import { Button } from '@/components/ui/button'

const navGroups = [
  {
    label: 'Workspace',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/results-reels', label: 'Results Reels', icon: Clapperboard },
      { href: '/library', label: 'Library', icon: LibraryIcon },
      { href: '/history', label: 'History', icon: History },
    ],
  },
  {
    label: 'Generate',
    items: [
      { href: '/reels', label: 'Create AI Reels', icon: Film },
      { href: '/scale', label: 'Scale Winning Image', icon: Layers },
      { href: '/scale-video', label: 'Scale Winning Video', icon: Video },
      { href: '/remake', label: 'Video Remake', icon: Wand2 },
      { href: '/generate/single-image', label: 'Single Image', icon: ImageIcon },
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

export function MobileNav() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuthStore()
  const [open, setOpen] = useState(false)

  // Close menu on route change
  useEffect(() => { setOpen(false) }, [pathname])

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [open])

  return (
    <>
      {/* Mobile top bar — only visible < md */}
      <div className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-white px-3 md:hidden">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-foreground hover:bg-accent"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-pink-500 text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <span className="font-bold tracking-tight text-sm">Ads Creative Gen</span>
        </Link>
      </div>

      {/* Drawer overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer panel */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-50 flex h-full w-72 flex-col border-r bg-white shadow-xl transition-transform duration-200 md:hidden',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-pink-500 text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="font-bold tracking-tight">Ads Creative Gen</span>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4 text-sm">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map(({ href, label, icon: Icon }) => {
                  const active = pathname === href || pathname.startsWith(href + '/')
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        className={cn(
                          'flex items-center gap-2 rounded-md px-2 py-2 transition-colors',
                          active
                            ? 'bg-primary/10 font-medium text-primary'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t p-3">
          {user && (
            <div className="mb-2 rounded-md bg-muted/40 p-2">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => {
              logout()
              router.push('/login')
            }}
          >
            <LogOut className="h-4 w-4" /> Logout
          </Button>
        </div>
      </aside>
    </>
  )
}
