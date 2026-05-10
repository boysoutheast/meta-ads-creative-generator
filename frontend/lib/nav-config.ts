import {
  LayoutDashboard,
  Clapperboard,
  History,
  Library as LibraryIcon,
  Film,
  Layers,
  Video,
  Wand2,
  Image as ImageIcon,
  Palette,
  Package,
  Users,
  User as UserIcon,
  Drama,
} from 'lucide-react'

export const navGroups = [
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
      { href: '/character-studio', label: 'Character Studio', icon: Drama },
      { href: '/remake', label: 'Video Remake', icon: Wand2 },
      { href: '/generate/single-image', label: 'Single Image', icon: ImageIcon },
      { href: '/create', label: 'Create w/ Reference', icon: Palette },
    ],
  },
  {
    label: 'Produk',
    items: [
      { href: '/products', label: 'Insert Produk', icon: Package },
      { href: '/characters', label: 'Insert Karakter', icon: Users },
    ],
  },
  {
    label: 'Account',
    items: [{ href: '/profile', label: 'Profile', icon: UserIcon }],
  },
]
