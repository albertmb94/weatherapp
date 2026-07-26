'use client'

/**
 * S10 — Usage profile selector.
 *
 * Picks which models and ensemble preset to highlight for the user's
 * use case. Coast vs. mountain vs. plain have very different best
 * regional models, so a "Sailing profile" surfaces marine models and
 * wind variables while an "Urban profile" hides specialist
 * convection-resolving AROME-HD variants in favour of the smoother
 * global IFS / GFS blend.
 *
 * The current implementation is *advisory only* — it does not
 * rewrite the user's `MODELS` selection. We surface a banner near the
 * FriendlyHome header explaining the recommended profile; a future
 * sprint will wire it to the URL state via `?profile=sailing` and
 * run a soft re-weight inside `weightsFor()`.
 */

import { useLocale } from '@/lib/LocaleContext'
import { STRINGS } from '@/lib/i18n'

export type UsageProfile =
  | 'plain'
  | 'coastal'
  | 'mountain'
  | 'urban'
  | 'agricultural'
  | 'sailing'

export interface ProfileRecommendation {
  preferredModels: string[]
  preferMarine: boolean
  preferLongRange: boolean
  descriptionEs: string
  descriptionEn: string
}

export const PROFILE_RECOMMENDATIONS: Record<UsageProfile, ProfileRecommendation> = {
  plain: {
    preferredModels: [],
    preferMarine: false,
    preferLongRange: true,
    descriptionEs: 'Equilibrio global, sin sesgo regional.',
    descriptionEn: 'Global blend with no regional bias.',
  },
  coastal: {
    preferredModels: ['ecmwf_ifs', 'meteofrance_arome_france', 'meteofrance_arpege_europe', 'icon_global'],
    preferMarine: true,
    preferLongRange: false,
    descriptionEs: 'Modelos de alta resolución + variables marinas.',
    descriptionEn: 'High-resolution + marine variables.',
  },
  mountain: {
    preferredModels: ['meteofrance_arome_france_hd', 'knmi_harmonie_arome_europe', 'dwd_icon_d2', 'ecmwf_ifs'],
    preferMarine: false,
    preferLongRange: false,
    descriptionEs: 'Convección + modèles à haute résolution.',
    descriptionEn: 'Convection-resolving + high-res regional.',
  },
  urban: {
    preferredModels: ['ecmwf_ifs', 'icon_global', 'gfs_global', 'meteofrance_arpege_europe'],
    preferMarine: false,
    preferLongRange: false,
    descriptionEs: 'Suavizado urbano: menos detalle local.',
    descriptionEn: 'Smoothed urban view: less local detail.',
  },
  agricultural: {
    preferredModels: ['ecmwf_ifs', 'gem_global', 'icon_global', 'gfs_global'],
    preferMarine: false,
    preferLongRange: true,
    descriptionEs: 'Ensemble estable + horizonte largo para planificar.',
    descriptionEn: 'Stable ensemble + long horizon for planning.',
  },
  sailing: {
    preferredModels: ['ecmwf_ifs', 'icon_global', 'gfs_global', 'meteofrance_arome_france'],
    preferMarine: true,
    preferLongRange: false,
    descriptionEs: 'Viento, ráfagas y oleaje prioritarios.',
    descriptionEn: 'Wind, gusts and waves prioritized.',
  },
}

const PROFILE_LABELS: Record<UsageProfile, keyof typeof STRINGS['en']> = {
  plain: 'profilePlain',
  coastal: 'profileCoastal',
  mountain: 'profileMountain',
  urban: 'profileUrban',
  agricultural: 'profileAgricultural',
  sailing: 'profileSailing',
}

export const PROFILE_ORDER: UsageProfile[] = [
  'plain',
  'coastal',
  'mountain',
  'urban',
  'agricultural',
  'sailing',
]

interface ProfilePickerProps {
  value: UsageProfile
  onChange: (profile: UsageProfile) => void
  className?: string
}

export default function ProfilePicker({ value, onChange, className }: ProfilePickerProps) {
  const { locale } = useLocale()
  const s = STRINGS[locale]
  const rec = PROFILE_RECOMMENDATIONS[value]
  return (
    <section
      aria-label={s.profilePickerLabel}
      className={`rounded-2xl border border-border bg-surface-raised/60 px-3 py-2 flex flex-col gap-2 ${className ?? ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-widest text-text-tertiary font-semibold">
          {s.profilePickerTitle}
        </span>
        <select
          aria-label={s.profilePickerLabel}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-primary"
          value={value}
          onChange={(e) => onChange(e.target.value as UsageProfile)}
        >
          {PROFILE_ORDER.map((p) => (
            <option key={p} value={p}>
              {s[PROFILE_LABELS[p]] as string}
            </option>
          ))}
        </select>
      </div>
      <p className="text-[11px] text-text-tertiary leading-snug">
        {locale === 'en' ? rec.descriptionEn : rec.descriptionEs}
      </p>
    </section>
  )
}
