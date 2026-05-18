import { useEffect, useRef, useCallback, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

interface UrlState {
  lat: number
  lon: number
  metric: string
  models: string[]
  hour: number
  range: number
  showMap: boolean
  showRadar: boolean
  bucket: number
}

const ALLOWED_BUCKETS = new Set([1, 2, 3, 4, 6, 12, 24])

const MODELS_NONE_TOKEN = 'none'

function parseUrlParams(params: URLSearchParams): Partial<UrlState> {
  const result: Partial<UrlState> = {}
  const lat = params.get('lat')
  const lon = params.get('lon')
  if (lat && lon && !isNaN(Number(lat)) && !isNaN(Number(lon))) {
    result.lat = Number(lat)
    result.lon = Number(lon)
  }
  const metric = params.get('metric')
  if (metric) result.metric = metric
  const models = params.get('models')
  if (models !== null) {
    result.models = models === MODELS_NONE_TOKEN ? [] : models.split(',').filter(Boolean)
  }
  const hour = params.get('hour')
  if (hour && !isNaN(Number(hour))) result.hour = Number(hour)
  const range = params.get('range')
  if (range && !isNaN(Number(range))) result.range = Number(range)
  const showMap = params.get('map')
  if (showMap !== null) result.showMap = showMap === '1'
  const showRadar = params.get('radar')
  if (showRadar !== null) result.showRadar = showRadar === '1'
  const bucket = params.get('bucket')
  if (bucket && ALLOWED_BUCKETS.has(Number(bucket))) result.bucket = Number(bucket)
  return result
}

function modelsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function buildQuery(state: UrlState, defaults: UrlState): string {
  const params = new URLSearchParams()
  if (state.lat !== defaults.lat || state.lon !== defaults.lon) {
    params.set('lat', state.lat.toFixed(4))
    params.set('lon', state.lon.toFixed(4))
  }
  if (state.metric !== defaults.metric) params.set('metric', state.metric)
  if (!modelsEqual(state.models, defaults.models)) {
    params.set('models', state.models.length === 0 ? MODELS_NONE_TOKEN : state.models.join(','))
  }
  if (state.hour !== defaults.hour) params.set('hour', String(state.hour))
  if (state.range !== defaults.range) params.set('range', String(state.range))
  if (state.showMap !== defaults.showMap) params.set('map', state.showMap ? '1' : '0')
  if (state.showRadar !== defaults.showRadar) params.set('radar', state.showRadar ? '1' : '0')
  if (state.bucket !== defaults.bucket) params.set('bucket', String(state.bucket))
  return params.toString()
}

export function useUrlState(defaults: UrlState): [UrlState, (updates: Partial<UrlState>) => void] {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const lastPushedQuery = useRef<string | null>(null)

  const [state, setState] = useState<UrlState>(() => {
    const parsed = parseUrlParams(searchParams)
    return {
      lat: parsed.lat ?? defaults.lat,
      lon: parsed.lon ?? defaults.lon,
      metric: parsed.metric ?? defaults.metric,
      models: parsed.models ?? defaults.models,
      hour: parsed.hour ?? defaults.hour,
      range: parsed.range ?? defaults.range,
      showMap: parsed.showMap ?? defaults.showMap,
      showRadar: parsed.showRadar ?? defaults.showRadar,
      bucket: parsed.bucket ?? defaults.bucket,
    }
  })

  // Sync URL whenever state changes (post-render to avoid setState during render).
  useEffect(() => {
    const query = buildQuery(state, defaults)
    if (query === lastPushedQuery.current) return
    lastPushedQuery.current = query
    const href = query ? `${pathname}?${query}` : pathname
    router.replace(href, { scroll: false })
  }, [state, defaults, pathname, router])

  // React to back/forward navigation: setState happens inside the event
  // handler (not in the effect body itself) which the linter is happy with.
  useEffect(() => {
    function onPopState() {
      const params = new URLSearchParams(window.location.search)
      const parsed = parseUrlParams(params)
      if (Object.keys(parsed).length === 0) return
      setState(prev => ({ ...prev, ...parsed }))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const update = useCallback((updates: Partial<UrlState>) => {
    setState(prev => ({ ...prev, ...updates }))
  }, [])

  return [state, update]
}
