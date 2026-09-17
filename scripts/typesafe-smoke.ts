#!/usr/bin/env tsx
/**
 * Smoke test for the TypeSafe SDK (@typesafe-ai/sdk).
 *
 * Verifies that TYPESAFE_API_KEY is picked up from the environment and
 * that a real `/v1/systemone` request round-trips. This is a throwaway
 * probe, not part of the app runtime — delete it once the integration
 * is wired up.
 *
 * Usage:
 *   tsx --env-file=.env.local scripts/typesafe-smoke.ts
 *
 * Env vars:
 *   TYPESAFE_API_KEY — required (see .env.local)
 */

import { TypeSafeClient, choice, noul, score } from '@typesafe-ai/sdk'

async function main() {
  // Throws TypeSafeError when the API key is missing or blank.
  const client = new TypeSafeClient()

  const { data: models } = await client.models.list().withResponse()
  console.log(`[typesafe] ${models.length} modelo(s): ${models.map((m) => m.name).join(', ')}`)

  const result = await client.systemOne({
    state: '¿Va a llover el sábado por la tarde en Girona?',
    questions: {
      es_meteo: noul('¿Es una pregunta sobre el tiempo?'),
      intencion: choice('¿Qué quiere saber la persona?', {
        lluvia: 'Si llueve o va a llover',
        temperatura: 'Qué temperatura hará',
        otra: null,
      }),
      urgencia: score('¿Cuánta urgencia transmite la pregunta?', [
        'Ninguna, simple curiosidad',
        'Interés normal',
        'Urgente, necesita respuesta pronto',
      ]),
    },
  })

  console.log(`[typesafe] modelo=${result.model} tokens=${result.usage.input_tokens}/${result.usage.output_tokens}`)
  console.log('  es_meteo  →', result.answers.es_meteo.noul)
  console.log('  intencion →', result.answers.intencion.choice, JSON.stringify(result.answers.intencion.probabilities))
  console.log('  urgencia  →', result.answers.urgencia.score)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
