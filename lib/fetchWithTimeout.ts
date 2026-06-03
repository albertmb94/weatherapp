const DEFAULT_TIMEOUT_MS = 15_000

export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = options

  // If the caller's signal is already aborted, throw immediately
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  // Link caller's signal to our controller
  if (signal) {
    const onAbort = () => controller.abort()
    signal.addEventListener('abort', onAbort, { once: true })
    // Clean up listener when request finishes
    controller.signal.addEventListener('abort', () => {
      signal.removeEventListener('abort', onAbort)
    }, { once: true })
  }

  try {
    return await fetch(url, { ...rest, signal: controller.signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // Distinguish timeout from caller abort
      if (signal?.aborted) {
        throw err // Caller aborted — propagate as-is
      }
      throw new Error(`Request timed out after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}
