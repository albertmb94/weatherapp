const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000
const MAX_RETRY_AFTER_MS = 8000
const REQUEST_TIMEOUT_MS = 20_000
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504])
// Open-Meteo replies with this status when a `models=` ID is no longer in
// the catalogue. We degrade the request by retrying without the
// offending model.
const MODEL_NOT_FOUND_STATUS = 400

export function sanitizeOpenMeteoJson(raw: string): string {
  return raw
    .replace(/:\s*nan\b/gi, ': null')
    .replace(/:\s*undefined\b/g, ': null')
    .replace(/:\s*-?Infinity\b/g, ': null')
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
  const dateMs = Date.parse(header)
  if (Number.isFinite(dateMs)) return Math.min(Math.max(dateMs - Date.now(), 0), MAX_RETRY_AFTER_MS)
  return null
}

/** Try to extract an offending model id from an Open-Meteo 400 body.
 *  B-NBT-9c: the old "fallback" loop was dead logic — it returned null
 *  as soon as ANY requested model wasn't mentioned in the error body,
 *  which duplicated the no-match outcome while looking like it did
 *  something. Simplified to a single regex match + explicit null. */
function extractRejectedModel(body: string, requestedModels: string[]): string | null {
  const match = body.match(/[Mm]odel\s+([a-z0-9_]+)/) || body.match(/unknown model:\s*([a-z0-9_]+)/)
  if (match && requestedModels.includes(match[1])) return match[1]
  return null
}

export async function fetchWithRetry(url: string, signal?: AbortSignal): Promise<Response> {
  // Outer loop: retries for transient failures (429, 5xx).
  // `signal` lets the caller abort the upstream fetch when the client
  // disconnects; combine it with our own per-request timeout so an
  // idle client can't keep the upstream running on Vercel.
  const combinedSignal = combineSignals(signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS))
  let res = await fetch(url, { signal: combinedSignal })
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (res.ok || !RETRYABLE_STATUSES.has(res.status)) return res
    const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'))
    const delay = retryAfterMs ?? BASE_DELAY_MS * Math.pow(2, attempt)
    await new Promise(r => setTimeout(r, delay))
    res = await fetch(url, { signal: combineSignals(signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)) })
  }
  return res
}

/** Combine two AbortSignals into one. The returned signal fires when
 *  either of the inputs fires. We don't use the built-in `any` because
 *  older runtimes (and jsdom in tests) lack it. */
function combineSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (!a && !b) return undefined
  if (!a) return b
  if (!b) return a
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (a.aborted || b.aborted) {
    controller.abort()
    return controller.signal
  }
  a.addEventListener('abort', onAbort, { once: true })
  b.addEventListener('abort', onAbort, { once: true })
  return controller.signal
}

/** Variant used by the forecast route: if Open-Meteo rejects the request
 *  because one of the model IDs is no longer in their catalogue, try
 *  once more without it. Caps at one degradation per request to avoid
 *  pathological loops. */
export async function fetchOpenMeteoWithModelFallback(
  requestUrl: string,
  requestParams: URLSearchParams,
  signal?: AbortSignal
): Promise<{ res: Response; modelsUsed: string[]; modelsRejected: string[] }> {
  const requested = (requestParams.get('models') ?? '').split(',').filter(Boolean)
  let url = requestUrl
  const modelsRejected: string[] = []
  let res = await fetchWithRetry(url, signal)
  if (res.status !== MODEL_NOT_FOUND_STATUS || requested.length === 0) {
    return { res, modelsUsed: requested, modelsRejected }
  }
  const text = await res.text().catch(() => '')
  const rejected = extractRejectedModel(text, requested)
  if (!rejected) {
    // We couldn't pinpoint which model. Try with no models at all — the
    // provider will pick its own default ensemble.
    const params = new URLSearchParams(requestParams)
    params.delete('models')
    url = `${new URL(requestUrl).origin}${new URL(requestUrl).pathname}?${params.toString()}`
    res = await fetchWithRetry(url, signal)
    modelsRejected.push(...requested)
    return { res, modelsUsed: [], modelsRejected }
  }
  modelsRejected.push(rejected)
  const remaining = requested.filter(m => m !== rejected)
  // Retry with the remaining models. Don't recurse: one rejection is the
  // realistic case (provider catalogue churn on a single ID).
  const params = new URLSearchParams(requestParams)
  if (remaining.length > 0) {
    params.set('models', remaining.join(','))
  } else {
    params.delete('models')
  }
  url = `${new URL(requestUrl).origin}${new URL(requestUrl).pathname}?${params.toString()}`
  res = await fetchWithRetry(url, signal)
  return { res, modelsUsed: params.get('models')?.split(',').filter(Boolean) ?? [], modelsRejected }
}

export function parseOpenMeteoResponse(text: string): { parsed: unknown; bodyText: string } {
  try {
    return { parsed: JSON.parse(text), bodyText: text }
  } catch {
    const bodyText = sanitizeOpenMeteoJson(text)
    return { parsed: JSON.parse(bodyText), bodyText }
  }
}

/**
 * B-NEW-41 (2026-08-22): detect requested models whose entire payload
 * is empty. Open-Meteo currently serves some catalogue entries (e.g.
 * `ecmwf_aifs025`, `gfs_graphcast025` on 2026-08-22) as all-null rows:
 * the request succeeds (HTTP 200) but the model contributes nothing.
 * The old pipeline had no way to notice — the ensemble silently
 * renormalized onto whichever models did have data. The forecast route
 * uses this to emit the `X-Forecast-Models-Empty` header and log a
 * warning; the client parser reuses it to populate
 * `ForecastResult.modelsWithNoData`.
 *
 * A model counts as "empty" only when at least one suffixed key exists
 * (`<var>_<id>`) but none of its arrays contain a finite number.
 * Models with NO keys at all are simply out of the provider's coverage
 * footprint for that location (e.g. `dwd_icon_d2` in Barcelona) — a
 * different situation we must not flag.
 */
export function detectModelsWithNoData(
  parsed: unknown,
  modelIds: string[],
): string[] {
  if (!modelIds.length) return []
  const hourly = (parsed as { hourly?: Record<string, unknown> } | null)?.hourly
  if (!hourly || typeof hourly !== 'object') return []
  const empty: string[] = []
  for (const id of modelIds) {
    let sawKey = false
    let sawValue = false
    for (const [key, arr] of Object.entries(hourly)) {
      if (!key.endsWith(`_${id}`) || !Array.isArray(arr)) continue
      sawKey = true
      for (const v of arr) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          sawValue = true
          break
        }
      }
      if (sawValue) break
    }
    if (sawKey && !sawValue) empty.push(id)
  }
  return empty
}
