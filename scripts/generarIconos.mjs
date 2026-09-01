import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Genera los iconos PNG de la PWA a partir del SVG de origen.
 *
 * POR QUÉ EXISTE ESTE SCRIPT (y por qué los PNG SÍ se commitean).
 *
 * El manifiesto sólo declaraba iconos SVG y `apple-touch-icon` apuntaba
 * a un SVG. **iOS no admite SVG en `apple-touch-icon`**: quien añadía la
 * app a la pantalla de inicio de un iPhone se quedaba con un icono en
 * blanco. Es el momento de mayor intención de uso que tiene la app y
 * fallaba en silencio.
 *
 * Otros dos problemas que arregla:
 *
 *  - `icon-192.svg` e `icon-512.svg` eran EL MISMO fichero (638 bytes,
 *    los dos con `width="512"`). La entrada de 192 mentía.
 *  - El icono `maskable` no tenía zona segura. Android recorta los
 *    iconos maskable con la forma del sistema (círculo, gota,
 *    superelipse...) y sólo garantiza el 80% central: con el dibujo a
 *    sangre, el sol y parte de la nube quedaban fuera. Aquí se genera
 *    una variante con el dibujo al 72% sobre fondo sólido.
 *
 * Se generan en build y se commitean en lugar de rasterizar en tiempo
 * de ejecución porque el manifiesto necesita URLs estables y públicas.
 * Para regenerarlos:  node scripts/generarIconos.mjs
 */

const RAIZ = join(import.meta.dirname, '..')
const ORIGEN = join(RAIZ, 'public', 'icon-512.svg')
const FONDO = '#0a0a0a' // el mismo `--background` del tema oscuro

const svg = readFileSync(ORIGEN)

/** Icono normal: el dibujo a sangre, con su propio fondo redondeado. */
async function normal(tamano, destino) {
  const png = await sharp(svg, { density: 512 })
    .resize(tamano, tamano, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
  writeFileSync(join(RAIZ, 'public', destino), png)
  return png.length
}

/**
 * Variante maskable: el DIBUJO SOLO, ampliado, sobre fondo sólido.
 *
 * La especificación pide que todo lo importante quepa en el círculo
 * central del 80%, porque Android recorta estos iconos con la forma del
 * sistema (círculo, gota, superelipse...).
 *
 * El primer intento fue escalar el SVG entero al 72%, y salió mal: el
 * SVG YA trae su propio margen dentro del cuadro de 512, así que el
 * dibujo quedaba al ~50% y se veía ridículo dentro del icono. Aquí se
 * quita el `<rect>` de fondo —invisible de todos modos sobre el fondo
 * sólido— y se recoloca el trazo real.
 *
 * La caja del dibujo en el SVG original, contando el grosor de trazo,
 * es x∈[136,404] e y∈[84,421]: centro (270, 252,5) y semidiagonal ≈215.
 * El círculo seguro tiene radio 205, así que el factor máximo sería
 * 0,95; se usa 0,90 para dejar holgura a las máscaras más agresivas.
 */
async function maskable(tamano, destino) {
  const dibujo = svg
    .toString('utf8')
    // Fuera el fondo redondeado: aquí el fondo lo pone el compositor.
    .replace(/<rect[^>]*\/>/, '')
    .replace(
      /(<svg[^>]*>)/,
      '$1<g transform="translate(256,256) scale(0.9) translate(-270,-252.5)">',
    )
    .replace('</svg>', '</g></svg>')

  const trazo = await sharp(Buffer.from(dibujo), { density: 512 })
    .resize(tamano, tamano)
    .png()
    .toBuffer()

  const png = await sharp({
    create: { width: tamano, height: tamano, channels: 4, background: FONDO },
  })
    .composite([{ input: trazo }])
    .png({ compressionLevel: 9 })
    .toBuffer()
  writeFileSync(join(RAIZ, 'public', destino), png)
  return png.length
}

/**
 * Icono de iOS: 180×180 y SIN transparencia.
 *
 * iOS pinta el `apple-touch-icon` sobre blanco cuando tiene canal alfa,
 * y este dibujo es oscuro: quedaría un halo blanco alrededor. Se aplana
 * contra el fondo del tema.
 */
async function apple(destino) {
  const png = await sharp(svg, { density: 512 })
    .resize(180, 180)
    .flatten({ background: FONDO })
    .png({ compressionLevel: 9 })
    .toBuffer()
  writeFileSync(join(RAIZ, 'public', destino), png)
  return png.length
}

const salida = [
  ['icon-192.png', await normal(192, 'icon-192.png')],
  ['icon-512.png', await normal(512, 'icon-512.png')],
  ['icon-maskable-512.png', await maskable(512, 'icon-maskable-512.png')],
  ['apple-touch-icon.png', await apple('apple-touch-icon.png')],
]

for (const [nombre, bytes] of salida) {
  console.log(`${nombre.padEnd(24)} ${(bytes / 1024).toFixed(1)} KB`)
}
