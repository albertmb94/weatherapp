import { NextRequest, NextResponse } from 'next/server'
import { comprobarSalud } from '@/lib/health'
import { sendEmail } from '@/lib/emails'

export const runtime = 'nodejs'

/**
 * Vigilancia diaria del despliegue.
 *
 * POR QUÉ EXISTE. `/api/health` sólo habla cuando alguien le pregunta, y
 * su único consumidor era el panel de admin. Es decir: el endpoint que
 * construimos PARA QUE EL INCIDENTE DEL CRON NO SE REPITIERA dependía de
 * que un humano se acordara de abrirlo. Aquel incidente —`CRON_SECRET`
 * sin definir, cuatro días sin consolidar analítica— se habría avisado
 * solo el primer día con esto puesto.
 *
 * Ejecuta las comprobaciones DIRECTAMENTE, sin pedirse a sí mismo por
 * HTTP: así no depende de que `appOrigin()` esté configurado y un fallo
 * de red no se confunde con un fallo de salud.
 *
 * SÓLO AVISA CUANDO HAY ALGO QUE CONTAR. Un correo diario de "todo bien"
 * se convierte en un correo que nadie abre, y entonces el día que diga
 * otra cosa tampoco se abrirá. Si todo está correcto, responde 200 y no
 * manda nada.
 *
 * Auth: igual que el resto de crons — Vercel manda
 * `Authorization: Bearer $CRON_SECRET` cuando esa variable existe.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'cron_not_configured' }, { status: 503 })
  }
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const salud = await comprobarSalud()

  // Qué se considera digno de un correo. `ok` global sólo mira base de
  // datos y Open-Meteo; aquí importan además el esquema y el cron,
  // porque son justo los fallos silenciosos que motivaron todo esto: un
  // despliegue con migraciones pendientes responde a las consultas pero
  // registra "cero visitas", y un cron caído no se nota hasta que faltan
  // días de datos.
  const problemas = Object.entries(salud.checks)
    .filter(([nombre, c]) => !c.ok && VIGILADOS.has(nombre))
    .map(([nombre, c]) => `${nombre}: ${c.detail ?? 'fallo'}`)

  if (problemas.length === 0) {
    return NextResponse.json({ ok: true, alerted: false, checks: salud.checks })
  }

  const destino = process.env.ADMIN_EMAIL
  if (!destino) {
    // Sin destinatario no se puede avisar, pero el fallo tiene que
    // quedar registrado en algún sitio: los logs de la función.
    console.error('[health-check] problemas sin destinatario configurado:', problemas.join(' · '))
    return NextResponse.json(
      { ok: false, alerted: false, error: 'admin_email_not_configured', problemas },
      { status: 500 },
    )
  }

  const lineas = problemas.map(p => `<li>${escaparHtml(p)}</li>`).join('')
  const envio = await sendEmail({
    to: destino,
    subject: `[Weather] Autodiagnóstico: ${problemas.length} problema(s)`,
    html:
      `<p>El autodiagnóstico ha encontrado esto:</p><ul>${lineas}</ul>` +
      `<p>Detalle completo en <code>/api/health</code> o en el panel de administración.</p>`,
    plainText: `Autodiagnóstico:\n${problemas.map(p => `- ${p}`).join('\n')}`,
    metadata: { origen: 'cron/health-check' },
    sentBy: 'cron',
  })

  if (!envio.ok) {
    console.error('[health-check] no se pudo avisar:', envio.error, '·', problemas.join(' · '))
  }

  return NextResponse.json({ ok: false, alerted: envio.ok, problemas, checks: salud.checks })
}

/**
 * Comprobaciones que merecen un correo.
 *
 * `resend` y `stripe` quedan fuera a propósito: informan de si están
 * configurados, y su `ok` es `false` incluso funcionando bien (ver
 * `lib/health.ts`). Meterlas aquí generaría una alerta diaria garantizada
 * y el aviso dejaría de significar nada.
 */
const VIGILADOS = new Set(['db', 'schema', 'cron', 'openmeteo'])

function escaparHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
