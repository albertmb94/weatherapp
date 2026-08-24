'use client'

import { useEffect } from 'react'

/**
 * B-NBT-20: floating Ko-fi chat overlay para DESKTOP.
 * Carga el script de Ko-fi y dibuja el widget flotante.
 * En móvil se oculta automáticamente por CSS del propio widget de Ko-fi;
 * el botón móvil es un enlace con imagen en el header.
 *
 * El username se extrae de la URL configurada en /admin/donations
 * (feature.kofi.config.url → https://ko-fi.com/albertminano).
 */
export default function KoFiOverlay({ username }: { username: string }) {
  useEffect(() => {
    // Solo cargar una vez
    if (document.querySelector('script[src*="overlay-widget.js"]')) return

    const script = document.createElement('script')
    script.src = 'https://storage.ko-fi.com/cdn/scripts/overlay-widget.js'
    script.async = true
    document.head.appendChild(script)

    script.onload = () => {
      const w = window as unknown as {
        kofiWidgetOverlay?: { draw: (user: string, opts: Record<string, string>) => void }
      }
      if (w.kofiWidgetOverlay) {
        w.kofiWidgetOverlay.draw(username, {
          'type': 'floating-chat',
          'floating-chat.donateButton.text': 'Support Me',
          'floating-chat.donateButton.background-color': '#323842',
          'floating-chat.donateButton.text-color': '#fff',
        })
      }
    }

    return () => {
      script.remove()
      // Limpiar el widget flotante si existe
      const overlay = document.getElementById('kofi-widget-overlay')
      if (overlay) overlay.remove()
    }
  }, [username])

  return null
}
