import Link from 'next/link'
import { Layers, Wand2, ArrowRight, Sparkles } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default function HomePage() {
  return (
    <div className="space-y-10">
      <section className="space-y-3 text-center">
        <Badge variant="secondary" className="mx-auto">
          <Sparkles className="mr-1 h-3 w-3" /> Powered by apimart.ai
        </Badge>
        <h1 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
          Generate Meta Ads creatives yang scroll-stopping
        </h1>
        <p className="mx-auto max-w-xl text-muted-foreground">
          Scale konten winning kamu jadi puluhan variasi, atau bikin iklan baru dari referensi — siap upload ke Meta Ads.
        </p>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <FeatureCard
          href="/scale"
          icon={<Layers className="h-6 w-6" />}
          title="Scale Konten Winning"
          description="Upload iklan winning kamu (gambar / video). AI analisis style & pola, lalu generate variasi baru dengan angle berbeda: FOMO, Social Proof, Before-After, dll."
          highlights={['Image & Video', 'Multi-angle', '8 framework copy']}
        />
        <FeatureCard
          href="/create"
          icon={<Wand2 className="h-6 w-6" />}
          title="Create with Reference"
          description="Upload referensi iklan + isi info produk kamu. AI bakal blend style referensi dengan produkmu, output siap naik Meta Ads."
          highlights={['Wizard 5 step', 'Single image / Video', 'Carousel support']}
        />
      </section>
    </div>
  )
}

function FeatureCard({
  href,
  icon,
  title,
  description,
  highlights,
}: {
  href: string
  icon: React.ReactNode
  title: string
  description: string
  highlights: string[]
}) {
  return (
    <Link href={href} className="group">
      <Card className="h-full transition-all hover:border-primary hover:shadow-lg">
        <CardHeader>
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
            {icon}
          </div>
          <CardTitle className="flex items-center gap-2">
            {title}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {highlights.map((h) => (
              <Badge key={h} variant="outline">{h}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
