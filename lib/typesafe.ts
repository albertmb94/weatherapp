/**
 * Server-only wrapper around `@typesafe-ai/sdk`.
 *
 * TypeSafe's System One models (Jev) turn state + typed questions into
 * typed, probabilistic answers. This module centralises three things so
 * callers never touch the SDK directly:
 *
 *   1. A single configured client (`getTypeSafeClient`) instead of a
 *      `new TypeSafeClient()` per request.
 *   2. A cheap "is this even configured?" probe (`isTypeSafeConfigured`)
 *      so routes can degrade gracefully — the same pattern as
 *      `AEMET_API_KEY` / `METEOCAT_API_KEY` — instead of throwing.
 *   3. Re-exports of the question builders and error classes, so the
 *      rest of the app imports from `@/lib/typesafe` and not from the
 *      SDK package (the dependency stays swappable).
 *
 * IMPORTANT: this is server-only. `TYPESAFE_API_KEY` must never reach the
 * browser, so do NOT import this module from a `'use client'` component.
 * The SDK throws if the key is missing, which is why the explicit probe
 * exists.
 */

import { TypeSafeClient } from '@typesafe-ai/sdk'

export {
  TypeSafeClient,
  choice,
  noul,
  score,
  TypeSafeError,
  APIError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
  APIConnectionError,
  APITimeoutError,
  APIUserAbortError,
} from '@typesafe-ai/sdk'

export type {
  ChoiceCriteria,
  ChoiceQuestion,
  ChoiceResponse,
  EntryType,
  NoulQuestion,
  NoulResponse,
  Question,
  Questions,
  RequestOptions,
  ScoreQuestion,
  ScoreResponse,
  SystemOneResult,
  TypeSafeClientConfig,
} from '@typesafe-ai/sdk'

/** Thrown by {@link getTypeSafeClient} when `TYPESAFE_API_KEY` is absent.
 *  Routes should prefer {@link isTypeSafeConfigured} and return a clean
 *  503 rather than catching this. */
export class TypeSafeNotConfiguredError extends Error {
  constructor() {
    super('TypeSafe no está configurado: falta TYPESAFE_API_KEY en el entorno.')
    this.name = 'TypeSafeNotConfiguredError'
  }
}

let cached: TypeSafeClient | null = null
let cachedKey: string | null = null

/** True when a non-blank `TYPESAFE_API_KEY` is present. Synchronous, no I/O. */
export function isTypeSafeConfigured(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY?.trim())
}

/**
 * Return the shared TypeSafe client, creating it on first use.
 *
 * Re-reading the key on every call means a rotated env var (dev HMR or a
 * redeployed function) rebuilds the client instead of pinning a stale
 * credential. Explicit `apiKey` also skips the SDK's own env lookup, so
 * the failure mode here is ours and typed.
 *
 * @throws {TypeSafeNotConfiguredError} when the key is missing or blank.
 */
export function getTypeSafeClient(): TypeSafeClient {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim()
  if (!apiKey) throw new TypeSafeNotConfiguredError()
  if (!cached || cachedKey !== apiKey) {
    cached = new TypeSafeClient({ apiKey })
    cachedKey = apiKey
  }
  return cached
}

/** Drop the memoised client. Test-only; not needed in application code. */
export function resetTypeSafeClient(): void {
  cached = null
  cachedKey = null
}
