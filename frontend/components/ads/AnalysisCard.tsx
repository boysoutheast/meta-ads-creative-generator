'use client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { WinningAdAnalysis } from '@/lib/types'

export function AnalysisCard({ analysis }: { analysis: WinningAdAnalysis }) {
  if (analysis.raw && !analysis.hook && !analysis.visualStyle) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Analisis</CardTitle></CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{analysis.raw}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Hasil Analisis Iklan Winning</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {analysis.hook && (
          <Field label="Hook" value={analysis.hook} />
        )}
        {analysis.visualStyle && <Field label="Visual style" value={analysis.visualStyle} />}
        {analysis.dominantAngle && (
          <div>
            <p className="text-xs font-medium text-muted-foreground">Dominant angle</p>
            <Badge variant="secondary">{analysis.dominantAngle}</Badge>
          </div>
        )}
        {analysis.colorPalette && analysis.colorPalette.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Color palette</p>
            <div className="flex flex-wrap gap-2">
              {analysis.colorPalette.map((c) => (
                <div key={c} className="flex items-center gap-1 rounded border bg-background px-2 py-1 text-xs">
                  <span className="inline-block h-3 w-3 rounded-sm border" style={{ backgroundColor: c }} />
                  {c}
                </div>
              ))}
            </div>
          </div>
        )}
        {analysis.targetAudience && <Field label="Target audience" value={analysis.targetAudience} />}
        {analysis.primaryEmotion && <Field label="Emosi utama" value={analysis.primaryEmotion} />}
        {analysis.strengths && analysis.strengths.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Strengths</p>
            <ul className="ml-4 list-disc space-y-0.5">
              {analysis.strengths.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        )}
        {analysis.framesAnalyzed && (
          <p className="text-xs text-muted-foreground">{analysis.framesAnalyzed} frame video dianalisis</p>
        )}
      </CardContent>
    </Card>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p>{value}</p>
    </div>
  )
}
