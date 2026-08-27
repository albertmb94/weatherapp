'use client'

/**
 * B-NBT-22: overlay flotante de Ko-fi para DESKTOP.
 * La URL se recibe por props (desde la feature feature.kofi.url).
 */
import KoFiOverlay from './KoFiOverlay'

export default function KoFiWidgets({ url }: { url: string }) {
  return <KoFiOverlay url={url} />
}
