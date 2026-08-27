import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import DailySummary from '@/components/DailySummary'
import { LocaleProvider } from '@/lib/LocaleContext'

// B-NEW-10 (2026-07-25): DailySummary must respect the Avanzado
// toggle. When the caller passes ensembleMode='wedai', the chips
// use the calibrated full land-model ensemble (every non-marine
// model with preset weights) regardless of which models the user
// has in `activeModelIds`. When the caller passes 'models' (or
// omits the prop), the chips respect `activeModelIds` exactly as
// before. Previously this component always used `activeModelIds`
// literally, so a single-model selection in Models mode leaked
// into the Resumen diario even after the user clicked WedAI.

const MODELS = [
  { id: 'gfs_global', label: 'GFS', color: '#fff', maxHours: 384, weight: 50, type: 'deterministic' as const, region: 'global' as const },
  { id: 'icon_global', label: 'ICON', color: '#fff', maxHours: 240, weight: 50, type: 'deterministic' as const, region: 'global' as const },
  // Include a marine model that should be filtered out by
  // resolveActiveModels for WedAI mode (only non-marine count).
  { id: 'marine_global', label: 'Marine', color: '#fff', maxHours: 240, weight: 1, type: 'deterministic' as const, region: 'global' as const },
]

function fakeTimes(count: number): Date[] {
  const out: Date[] = []
  const base = new Date(Date.UTC(2026, 5, 10, 0, 0, 0))
  for (let i = 0; i < count; i++) out.push(new Date(base.getTime() + i * 3_600_000))
  return out
}

function divergentSeries(count: number) {
  // gfs_global = 18°C, icon_global = 26°C, marine_global = 0°C
  // (should NOT contribute to WedAI per resolveActiveModels).
  return {
    gfs_global: {
      temperature: Array.from({ length: count }, () => 18),
      precipitation: Array.from({ length: count }, () => 0),
      wind_gusts: Array.from({ length: count }, () => 5),
      cloud_cover: Array.from({ length: count }, () => 0),
    },
    icon_global: {
      temperature: Array.from({ length: count }, () => 26),
      precipitation: Array.from({ length: count }, () => 0),
      wind_gusts: Array.from({ length: count }, () => 5),
      cloud_cover: Array.from({ length: count }, () => 0),
    },
    marine_global: {
      temperature: Array.from({ length: count }, () => 0),
      precipitation: Array.from({ length: count }, () => 0),
      wind_gusts: Array.from({ length: count }, () => 0),
      cloud_cover: Array.from({ length: count }, () => 0),
    },
  }
}

function wrap(node: React.ReactNode) {
  return <LocaleProvider locale="es">{node}</LocaleProvider>
}

function extractHighLow(container: HTMLElement): { high: string; low: string } | null {
  // Each daily chip renders two temperature spans inside a flex
  // row: the first (text-[11px] font-bold) is the daily high, the
  // second (text-[10px]) is the daily low. The title attribute on
  // the button starts with "Jump to ".
  const chip = container.querySelector('button[title^="Jump to"]')
  if (!chip) return null
  const highSpan = chip.querySelector('span.text-\\[11px\\].font-bold')
  const lowSpan = chip.querySelector('span.text-\\[10px\\].text-text-tertiary')
  return {
    high: highSpan?.textContent ?? '',
    low: lowSpan?.textContent ?? '',
  }
}

describe('DailySummary — ensembleMode prop (B-NEW-10)', () => {
  it('ensembleMode="wedai" overrides a single-model activeModelIds and uses both models', () => {
    const count = 24 * 3
    const { container } = render(wrap(
      <DailySummary
        models={MODELS}
        activeModelIds={['gfs_global']}  // user's single-model selection
        times={fakeTimes(count)}
        series={divergentSeries(count)}
        selectedHour={0}
        onSelectHour={() => undefined}
        maxHours={count}
        utcOffsetSeconds={0}
        ensembleMode="wedai"
      />
    ))
    const out = extractHighLow(container)
    expect(out).not.toBeNull()
    // With both models contributing, the daily high should be the
    // calibrated mean (22°C) — definitely NOT 18 (gfs alone) and
    // definitely NOT 0 (marine alone, which is excluded from WedAI).
    expect(parseInt(out!.high, 10)).toBeGreaterThan(20)
    expect(parseInt(out!.high, 10)).toBeLessThan(24)
    expect(parseInt(out!.low, 10)).toBeGreaterThan(20)
    expect(parseInt(out!.low, 10)).toBeLessThan(24)
  })

  it('ensembleMode="models" respects activeModelIds literally (gfs only)', () => {
    const count = 24 * 3
    const { container } = render(wrap(
      <DailySummary
        models={MODELS}
        activeModelIds={['gfs_global']}
        times={fakeTimes(count)}
        series={divergentSeries(count)}
        selectedHour={0}
        onSelectHour={() => undefined}
        maxHours={count}
        utcOffsetSeconds={0}
        ensembleMode="models"
      />
    ))
    const out = extractHighLow(container)
    expect(out).not.toBeNull()
    // Single-model selection: chip shows gfs_global's flat 18°C.
    expect(parseInt(out!.high, 10)).toBe(18)
    expect(parseInt(out!.low, 10)).toBe(18)
  })

  it('ensembleMode="wedai" excludes the marine model from the ensemble', () => {
    // If WedAI accidentally counted marine_global (0°C) the
    // calibrated mean would skew down. We verify the result is
    // the gfs+icon mean (~22), not the gfs+icon+marine mean (~14).
    const count = 24 * 3
    const { container } = render(wrap(
      <DailySummary
        models={MODELS}
        activeModelIds={[]}  // empty selection — WedAI should still work
        times={fakeTimes(count)}
        series={divergentSeries(count)}
        selectedHour={0}
        onSelectHour={() => undefined}
        maxHours={count}
        utcOffsetSeconds={0}
        ensembleMode="wedai"
      />
    ))
    const out = extractHighLow(container)
    expect(out).not.toBeNull()
    // With gfs=18 and icon=26 (marine excluded from WedAI), the
    // mean is ~22.
    expect(parseInt(out!.high, 10)).toBeGreaterThanOrEqual(20)
    expect(parseInt(out!.high, 10)).toBeLessThanOrEqual(24)
  })
})
