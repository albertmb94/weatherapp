import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Los tokens de texto tienen que cumplir AA de verdad, no en el comentario.
 *
 * EL FALLO QUE ESTO FIJA. `app/globals.css` declaraba «Text: 4 levels,
 * all WCAG AA on the matching surface» y era falso. Medido sobre
 * `--surface-raised`, que es el caso más exigente:
 *
 *   --text-tertiary  #71717a -> 3,90:1   (AA exige 4,5:1)
 *   --text-muted     #52525b -> 2,44:1
 *   --text-muted (claro) #9ca3af -> 2,54:1
 *
 * Y no eran tokens decorativos: los usan `InsightsTable`,
 * `CurrentWeatherCard` y `AirConditionsGrid`, en algún sitio a
 * `text-[10px]` — por debajo del propio `--min-text: 11px` que el mismo
 * fichero declara.
 *
 * Un comentario que promete accesibilidad es peor que ninguno: nadie
 * vuelve a comprobar lo que ya está prometido. Por eso esto no es un
 * comentario, es un test que LEE el CSS y calcula la relación. Si
 * alguien retoca un token y se pasa de tenue, se entera aquí.
 */

const css = readFileSync(join(__dirname, '..', 'globals.css'), 'utf8')

/** Lee un token dentro de un bloque concreto (`:root` o `html.light`). */
function token(bloque: string, nombre: string): string {
  const inicio = css.indexOf(bloque)
  if (inicio < 0) throw new Error(`no encuentro el bloque ${bloque}`)
  const fin = css.indexOf('\n}', inicio)
  const cuerpo = css.slice(inicio, fin)
  const m = cuerpo.match(new RegExp(`${nombre}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m) throw new Error(`no encuentro ${nombre} en ${bloque}`)
  return m[1].toLowerCase()
}

function canalLineal(v: number): number {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Luminancia relativa según WCAG 2.x. */
function luminancia(hex: string): number {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return 0.2126 * canalLineal(r) + 0.7152 * canalLineal(g) + 0.0722 * canalLineal(b)
}

function contraste(a: string, b: string): number {
  const la = luminancia(a)
  const lb = luminancia(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** El mínimo de AA para texto normal. */
const AA = 4.5

const NIVELES = ['--text-primary', '--text-secondary', '--text-tertiary', '--text-muted'] as const

describe('contraste de los tokens de texto', () => {
  it('la función de contraste es correcta (negro sobre blanco = 21:1)', () => {
    // Sin esto, un error en el cálculo haría pasar el test entero.
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contraste('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  describe.each([
    { tema: 'oscuro', bloque: ':root {', fondos: ['--background', '--surface-raised'] },
    { tema: 'claro', bloque: 'html.light {', fondos: ['--background', '--surface-raised'] },
  ])('tema $tema', ({ tema, bloque, fondos }) => {
    for (const nivel of NIVELES) {
      for (const fondo of fondos) {
        it(`${nivel} cumple AA sobre ${fondo}`, () => {
          const color = token(bloque, nivel)
          const bg = token(bloque, fondo)
          const r = contraste(color, bg)
          expect(
            r,
            `${tema}: ${nivel} (${color}) sobre ${fondo} (${bg}) da ${r.toFixed(2)}:1, ` +
              `y AA exige ${AA}:1. Aclara u oscurece el token — y recuerda que el ` +
              `comentario de globals.css afirma que TODOS cumplen.`,
          ).toBeGreaterThanOrEqual(AA)
        })
      }
    }

    it('la jerarquía visual se conserva: cada nivel es más tenue que el anterior', () => {
      // Subir el contraste es fácil; lo difícil es no aplanar los cuatro
      // niveles en el mismo gris y perder la jerarquía que existían para
      // marcar.
      const bg = token(bloque, '--surface-raised')
      const ratios = NIVELES.map(n => contraste(token(bloque, n), bg))
      for (let i = 1; i < ratios.length; i++) {
        expect(
          ratios[i],
          `${tema}: ${NIVELES[i]} no es más tenue que ${NIVELES[i - 1]}`,
        ).toBeLessThan(ratios[i - 1])
      }
    })
  })
})
