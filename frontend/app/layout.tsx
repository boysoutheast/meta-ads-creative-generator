import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Toaster } from 'sonner'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Meta Ads Creative Generator',
  description: 'Generate high-converting Meta Ads creatives dengan AI',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className={inter.className + ' min-h-screen bg-muted/20 text-foreground'}>
        {children}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  )
}
