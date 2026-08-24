'use client'

import { useEffect } from 'react'

/**
 * B-NBT-22: overlay flotante de Ko-fi en TODOS los tamaños de pantalla.
 * Hardcoded con el username del owner. Sin feature flags ni configs.
 */
export default function KoFiOverlay() {
  useEffect(() => {
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
        w.kofiWidgetOverlay.draw('albertminano', {
          'type': 'floating-chat',
          'floating-chat.donateButton.text': 'Support Me',
          'floating-chat.donateButton.background-color': '#323842',
          'floating-chat.donateButton.text-color': '#fff',
        })
      }
    }

    return () => { script.remove() }
  }, [])

  return null
}
