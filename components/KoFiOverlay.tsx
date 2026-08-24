'use client'

import { useEffect } from 'react'

/**
 * B-NBT-23: overlay flotante de Ko-fi minimalista.
 * Solo el logo circular, sin texto — discreto.
 */
export default function KoFiOverlay() {
  useEffect(() => {
    if (document.querySelector('script[src*="overlay-widget.js"]')) return

    const script = document.createElement('script')
    script.src = 'https://storage.ko-fi.com/cdn/scripts/overlay-widget.js'
    script.async = true
    document.head.appendChild(script)

    // CSS para hacer el botón discreto: solo logo, sin texto, más pequeño
    const style = document.createElement('style')
    style.textContent = `
      #kofi-widget-overlay-container .kofi-chat-launcher,
      #kofi-widget-overlay-container [class*="donate-button"] {
        min-width: 0 !important;
      }
      #kofi-widget-overlay-container .kofi-chat-launcher-text,
      #kofi-widget-overlay-container [class*="donate-button"] span:not(:first-child) {
        display: none !important;
      }
    `
    document.head.appendChild(style)

    script.onload = () => {
      const w = window as unknown as {
        kofiWidgetOverlay?: { draw: (user: string, opts: Record<string, string>) => void }
      }
      if (w.kofiWidgetOverlay) {
        w.kofiWidgetOverlay.draw('albertminano', {
          'type': 'floating-chat',
          'floating-chat.donateButton.background-color': '#323842',
          'floating-chat.donateButton.text-color': '#fff',
        })
      }
    }

    return () => {
      script.remove()
      style.remove()
    }
  }, [])

  return null
}
