'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  Library,
  Sparkles,
  LogOut,
  User as UserIcon,
  History,
  Package,
  Layers,
  Film,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/lib/auth'
import { Button } from '@/components/ui/button'

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
      { href: '/scale', label: 'Scale Winning Image', icon: Layers },
      { href: '/reels', label: 'Create AI Reels', icon: Film },
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

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuthStore()

  return (
    <aside className="hidden w-64 shrink-0 border-r bg-white md:flex md:flex-col">
      <div className="flex h-16 items-center gap-2 border-b px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-pink-500 text-white">
          <Sparkles className="h-4 w-4" />
        </div>
        <span className="font-bold tracking-tight">Ads Creative Gen</span>
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
  )
}
