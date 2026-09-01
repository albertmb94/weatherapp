import { describe, it, expect } from 'vitest'
import { grafoSitio, grafoPortada, serializarJsonLd } from '../datosEstructurados'
import { socialCardUrl } from '../routing'

const ORIGEN = 'https://ejemplo.test'

describe('datos estructurados', () => {
  it('el grafo del sitio es JSON-LD válido y enlaza el editor', () => {
    const g = JSON.parse(serializarJsonLd(grafoSitio(ORIGEN, 'es'))) as {
      '@graph': { '@type': string; '@id': string; publisher?: { '@id': string } }[]
    }
    const tipos = g['@graph'].map(n => n['@type'])
    expect(tipos).toContain('Organization')
    expect(tipos).toContain('WebSite')

    // El `publisher` tiene que apuntar a un nodo que EXISTE en el
    // grafo: una referencia colgando no la resuelve nadie.
    const sitio = g['@graph'].find(n => n['@type'] === 'WebSite')
    const org = g['@graph'].find(n => n['@type'] === 'Organization')
    expect(sitio?.publisher?.['@id']).toBe(org?.['@id'])
  })

  it('cada idioma declara el suyo', () => {
    const es = JSON.parse(serializarJsonLd(grafoSitio(ORIGEN, 'es'))) as { '@graph': { inLanguage?: string }[] }
    const en = JSON.parse(serializarJsonLd(grafoSitio(ORIGEN, 'en'))) as { '@graph': { inLanguage?: string }[] }
    expect(es['@graph'].some(n => n.inLanguage === 'es-ES')).toBe(true)
    expect(en['@graph'].some(n => n.inLanguage === 'en-US')).toBe(true)
  })

  it('la portada se declara aplicación gratuita', () => {
    const g = JSON.parse(serializarJsonLd(grafoPortada(ORIGEN, 'en'))) as {
      '@type': string
      isAccessibleForFree: boolean
      offers: { price: string }
    }
    expect(g['@type']).toBe('WebApplication')
    expect(g.isAccessibleForFree).toBe(true)
    expect(g.offers.price).toBe('0')
  })

  it('escapa `<` para que nada pueda cerrar la etiqueta script', () => {
    // Hoy ningún texto lleva `</script>`, pero el copy lo edita gente y
    // esto no puede depender de eso: una cadena con `</script>` cerraría
    // la etiqueta antes de tiempo y volcaría el resto como HTML.
    const suelto = serializarJsonLd({ x: '</script><img onerror=alert(1)>' })
    expect(suelto).not.toContain('</script>')
    expect(suelto).toContain('\\u003c')
    expect(JSON.parse(suelto)).toEqual({ x: '</script><img onerror=alert(1)>' })
  })
})

describe('URL de la tarjeta social', () => {
  it('en español apunta a la URL SIN prefijo', () => {
    // Dejar que Next la dedujera del segmento emitía `/es/opengraph-image`,
    // y el proxy responde a `/es/...` con un 308 hacia la versión sin
    // prefijo. La tarjeta quedaba detrás de un salto que algunos
    // rastreadores no siguen para imágenes.
    expect(socialCardUrl(ORIGEN, 'es')).toBe(`${ORIGEN}/opengraph-image`)
  })

  it('en inglés lleva el prefijo', () => {
    expect(socialCardUrl(ORIGEN, 'en')).toBe(`${ORIGEN}/en/opengraph-image`)
  })
})
