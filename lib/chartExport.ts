/**
 * F-12: export a Recharts SVG (or any DOM subtree containing one) to a
 * PNG file. Works without external dependencies: serialise the SVG,
 * wrap it in a Blob, draw it into a canvas via an Image element, then
 * trigger a download.
 */
export async function exportSvgToPng(svg: SVGElement, filename: string): Promise<void> {
  if (typeof window === 'undefined') return
  // Inline the computed styles so the rendered PNG matches the page.
  const clone = svg.cloneNode(true) as SVGElement
  const cs = window.getComputedStyle(svg)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  // Apply explicit width/height since the responsive container might
  // collapse to 0×0 momentarily during the print snapshot.
  const bbox = svg.getBoundingClientRect()
  const width = Math.max(bbox.width, 320)
  const height = Math.max(bbox.height, 160)
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  // Background colour matches the page so the PNG isn't transparent.
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bg.setAttribute('width', '100%')
  bg.setAttribute('height', '100%')
  bg.setAttribute('fill', cs.backgroundColor || '#0a0a0a')
  clone.insertBefore(bg, clone.firstChild)

  const xml = new XMLSerializer().serializeToString(clone)
  const svg64 = btoa(unescape(encodeURIComponent(xml)))
  const dataUrl = `data:image/svg+xml;base64,${svg64}`

  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Image load failed'))
    img.src = dataUrl
  })

  const canvas = document.createElement('canvas')
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2d unavailable')
  ctx.scale(dpr, dpr)
  ctx.drawImage(img, 0, 0, width, height)

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}