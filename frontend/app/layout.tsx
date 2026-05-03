import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Navbar } from '@/components/layout/Navbar'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Meta Ads Creative Generator',
  description: 'Scale winning ads & generate Meta Ads creatives dengan AI',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className={inter.className}>
        <Navbar />
        <main className="container py-8">{children}</main>
      </body>
    </html>
  )
}
