'use client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { WinningAdAnalysis } from '@/lib/types'

// ── Collapsible section ───────────────────────────────────────────────────────
function Collapsible({
  label,
  children,
  defaultOpen = false,
  accent = false,
}: {
  label: string
  children: React.ReactNode
  defaultOpen?: boolean
  accent?: boolean
}) {
  return (
    <details open={defaultOpen}>
      <summary
        className={`cursor-pointer select-none text-xs font-semibold hover:opacity-80 ${
          accent ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {label}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  )
}

// ── Field row ─────────────────────────────────────────────────────────────────
function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={highlight ? 'font-medium leading-snug' : 'text-sm leading-snug'}>{value}</p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
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

  const hasDeepAnalysis = !!(analysis.humanScenario || analysis.emotionalTruth || analysis.hookMechanism)
  const hasFramework    = !!(analysis.adType || analysis.adAngle || analysis.designFramework)

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">Hasil Analisis Iklan Winning</CardTitle>
          <div className="flex flex-wrap gap-1.5">
            {/* Ad type badge */}
            {analysis.adType && (
              <Badge variant="secondary" className="text-[11px]">
                {analysis.adType}
              </Badge>
            )}
            {/* Composition type badge */}
            {analysis.compositionType && (
              <Badge
                variant="outline"
                className={
                  analysis.compositionType === 'product_only'
                    ? 'border-blue-300 text-blue-700 bg-blue-50 text-[11px]'
                    : analysis.compositionType === 'hand_holding'
                    ? 'border-amber-300 text-amber-700 bg-amber-50 text-[11px]'
                    : 'border-emerald-300 text-emerald-700 bg-emerald-50 text-[11px]'
                }
              >
                {analysis.compositionType === 'product_only' && '📦 Product only'}
                {analysis.compositionType === 'hand_holding' && '✋ Hand holding'}
                {analysis.compositionType === 'model_with_product' && '👤 Model + produk'}
              </Badge>
            )}
            {/* Dominant angle badge */}
            {analysis.dominantAngle && (
              <Badge variant="outline" className="text-[11px] capitalize">
                {analysis.dominantAngle.replace(/_/g, ' ')}
              </Badge>
            )}
          </div>
        </div>
        {/* Ad angle — 1-sentence psychological mechanism */}
        {analysis.adAngle && (
          <p className="mt-1.5 text-xs text-muted-foreground italic leading-relaxed">{analysis.adAngle}</p>
        )}
      </CardHeader>

      <CardContent className="space-y-3 text-sm">

        {/* ── A-K Design Framework (full structured analysis) ── */}
        {hasFramework && analysis.designFramework && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
            <Collapsible label="📐 Framework Desain Lengkap (A–I)" accent>
              <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/80 font-sans mt-1">
                {analysis.designFramework}
              </pre>
            </Collapsible>
          </div>
        )}

        {/* ── Section J: Replication Blueprint (slot-based template) ── */}
        {analysis.replicationBlueprint && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3">
            <Collapsible label="🔲 Template Framework Reusable (Section J)">
              <pre className="whitespace-pre-wrap text-xs leading-relaxed text-indigo-900/80 font-sans mt-1">
                {analysis.replicationBlueprint}
              </pre>
            </Collapsible>
          </div>
        )}

        {/* ── Deep analysis dimensions ── */}
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
            <hr className="border-dashed" />
          </>
        )}

        {/* ── 5-paragraph visual detail ── */}
        {analysis.detailedVisualAnalysis && (
          <Collapsible label="📝 Deskripsi Visual Detail (5 paragraf)">
            <p className="rounded bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {analysis.detailedVisualAnalysis}
            </p>
          </Collapsible>
        )}

        {/* ── Standard visual fields ── */}
        {!hasDeepAnalysis && analysis.hook && <Field label="Hook" value={analysis.hook} />}
        {analysis.visualStyle && <Field label="Visual style" value={analysis.visualStyle} />}

        {/* Color palette */}
        {analysis.colorPalette && analysis.colorPalette.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Color palette</p>
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

        {/* Strengths */}
        {analysis.strengths && analysis.strengths.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Strengths</p>
            <ul className="ml-4 list-disc space-y-0.5 text-xs">
              {analysis.strengths.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        )}

        {analysis.primaryEmotion  && <Field label="Emosi utama"     value={analysis.primaryEmotion} />}
        {analysis.targetAudience  && <Field label="Target audience" value={analysis.targetAudience} />}
        {analysis.framesAnalyzed  && (
          <p className="text-xs text-muted-foreground">{analysis.framesAnalyzed} frame video dianalisis</p>
        )}
      </CardContent>
    </Card>
  )
}
