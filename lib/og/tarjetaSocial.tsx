import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locale } from '@/lib/i18n'

/**
 * Tarjeta que se ve al compartir un enlace, en los dos idiomas.
 *
 * POR QUÉ EXISTE. El sitio declaraba `summary_large_image` en
 * `lib/locale/pageMeta.ts` y en el layout de idioma —es decir, prometía
 * tarjeta grande con imagen— pero no había ningún `opengraph-image.*`.
 * WhatsApp, Telegram, Slack, LinkedIn y X mostraban el enlace pelado.
 *
 * Se genera con `ImageResponse` en tiempo de build en lugar de
 * commitear PNGs: el texto sigue al copy si cambia, hay una versión por
 * idioma sin duplicar ficheros, y el repositorio no engorda.
 *
 * Restricciones de Satori que condicionan el diseño: sólo flexbox (nada
 * de grid) y un tope de 500 KB para JSX + CSS + fuentes + imágenes. Por
 * eso el icono va como SVG en línea y no como PNG incrustado.
 */

export const TAMANO = { width: 1200, height: 630 }

const COPY: Record<Locale, { kicker: string; titulo: string; bajada: string }> = {
  es: {
    kicker: '15 modelos · 1 gráfico',
    titulo: 'Compara modelos meteorológicos',
    bajada: 'Mira cuál acierta más en tu ciudad, hora a hora.',
  },
  en: {
    kicker: '15 models · 1 chart',
    titulo: 'Compare weather models',
    bajada: 'See which one gets your city right, hour by hour.',
  },
}

export function altPara(locale: Locale): string {
  return COPY[locale].titulo
}

export async function tarjetaSocial(locale: Locale): Promise<ImageResponse> {
  // El mismo icono que usa la app. Se lee del disco en build, así que no
  // hay petición de red que pueda dejar la tarjeta a medias.
  const icono = await readFile(join(process.cwd(), 'public', 'icon-512.svg'))
  const iconoDataUri = `data:image/svg+xml;base64,${icono.toString('base64')}`
  const t = COPY[locale]

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          // Mismo fondo que `--background` en oscuro (app/globals.css).
          background: '#0a0a0a',
          padding: 72,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={iconoDataUri} width={112} height={112} alt="" />
          <div style={{ fontSize: 30, color: '#9ca3af', letterSpacing: 1 }}>{t.kicker}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              fontSize: 76,
              fontWeight: 700,
              color: '#ffffff',
              lineHeight: 1.1,
              letterSpacing: -1.5,
            }}
          >
            {t.titulo}
          </div>
          <div style={{ fontSize: 38, color: '#9ca3af', lineHeight: 1.35 }}>{t.bajada}</div>
        </div>

        {/* Franja de acento: `--accent` → `--accent-hover` → el amarillo
            del sol del icono. */}
        <div
          style={{
            display: 'flex',
            height: 12,
            width: '100%',
            borderRadius: 6,
            background: 'linear-gradient(90deg, #3b82f6 0%, #60a5fa 60%, #fbbf24 100%)',
          }}
        />
      </div>
    ),
    { ...TAMANO },
  )
}
