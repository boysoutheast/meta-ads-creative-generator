'use client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { WinningAdAnalysis } from '@/lib/types'

export function AnalysisCard({ analysis }: { analysis: WinningAdAnalysis }) {
  if (analysis.raw && !analysis.hook && !analysis.visualStyle && !analysis.hookMechanism) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Analisis</CardTitle></CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{analysis.raw}</p>
        </CardContent>
      </Card>
    )
  }

  // V2 deep analysis (concept translation pipeline)
  const hasDeepAnalysis = !!(analysis.humanScenario || analysis.emotionalTruth || analysis.hookMechanism)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Hasil Analisis Iklan Winning</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">

        {/* Composition type badge — critical for image generation accuracy */}
        {analysis.compositionType && (
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium text-muted-foreground">Komposisi terdeteksi:</p>
            <Badge
              variant="outline"
              className={
                analysis.compositionType === 'product_only'
                  ? 'border-blue-400 text-blue-700 bg-blue-50'
                  : analysis.compositionType === 'hand_holding'
                  ? 'border-amber-400 text-amber-700 bg-amber-50'
                  : 'border-emerald-400 text-emerald-700 bg-emerald-50'
              }
            >
              {analysis.compositionType === 'product_only' && '📦 Produk saja — tanpa model'}
              {analysis.compositionType === 'hand_holding' && '✋ Tangan memegang produk'}
              {analysis.compositionType === 'model_with_product' && '👤 Ada model + produk'}
            </Badge>
          </div>
        )}

        {/* 5-paragraph detailed description */}
        {analysis.detailedVisualAnalysis && (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
              📝 Deskripsi visual detail (5 paragraf)
            </summary>
            <p className="mt-2 rounded bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {analysis.detailedVisualAnalysis}
            </p>
          </details>
        )}

        {/* V2 deep dimensions */}
        {hasDeepAnalysis && (
          <>
            {analysis.humanScenario && (
              <Field label="Human Scenario" value={analysis.humanScenario} highlight />
            )}
            {analysis.emotionalTruth && (
              <Field label="Emotional Truth" value={analysis.emotionalTruth} highlight />
            )}
            {(analysis.hookMechanism || analysis.hook) && (
              <Field label="Hook Mechanism" value={analysis.hookMechanism || analysis.hook || ''} highlight />
            )}
            {analysis.narrativeStructure && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Narrative Structure</p>
                <div className="space-y-1 rounded-md bg-muted/40 p-2 text-xs">
                  {analysis.narrativeStructure.setup && (
                    <p><span className="font-semibold text-foreground">Setup:</span> {analysis.narrativeStructure.setup}</p>
                  )}
                  {analysis.narrativeStructure.tension && (
                    <p><span className="font-semibold text-foreground">Tension:</span> {analysis.narrativeStructure.tension}</p>
                  )}
                  {analysis.narrativeStructure.resolution && (
                    <p><span className="font-semibold text-foreground">Resolution:</span> {analysis.narrativeStructure.resolution}</p>
                  )}
                </div>
              </div>
            )}
            {analysis.replicationBlueprint && (
              <details>
                <summary className="cursor-pointer text-xs font-medium text-primary">
                  Replication Blueprint
                </summary>
                <p className="mt-1 rounded bg-primary/5 border border-primary/20 p-2 text-xs text-primary/80 leading-relaxed">
                  {analysis.replicationBlueprint}
                </p>
              </details>
            )}
            <hr className="border-dashed" />
          </>
        )}

        {/* Standard fields */}
        {!hasDeepAnalysis && (analysis.hook) && (
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
        {analysis.primaryEmotion && <Field label="Emosi utama" value={analysis.primaryEmotion} />}
        {analysis.targetAudience && <Field label="Target audience" value={analysis.targetAudience} />}
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

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={highlight ? 'font-medium leading-snug' : ''}>{value}</p>
    </div>
  )
}
