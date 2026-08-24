'use client'

import { useEffect } from 'react'
import { useFeature } from '@/lib/hooks/useFeature'
import KoFiOverlay from './KoFiOverlay'

/**
 * B-NBT-20: widgets de Ko-fi para donaciones.
 *
 * Desktop (≥1024px): overlay flotante de chat Ko-fi.
 * Móvil: botón con imagen en el header (implementado en home-content).
 *
 * Se activa cuando feature.kofi está ON y la URL configurada contiene
 * un username extraíble.
 */
export default function KoFiWidgets() {
  const { data } = useFeature('feature.kofi')

  const url = typeof data?.config?.url === 'string' ? data.config.url : ''
  const isEnabled = data?.enabled === true && url.includes('ko-fi.com')
  if (!isEnabled) return null

  // Extraer username: https://ko-fi.com/albertminano → albertminano
  const username = url.replace(/\/+$/, '').split('/').pop() ?? ''

  return <KoFiOverlay username={username} />
}
