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
}

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
  if (models) result.models = models.split(',').filter(Boolean)
  const hour = params.get('hour')
  if (hour && !isNaN(Number(hour))) result.hour = Number(hour)
  const range = params.get('range')
  if (range && !isNaN(Number(range))) result.range = Number(range)
  const showMap = params.get('map')
  if (showMap !== null) result.showMap = showMap === '1'
  return result
}

export function useUrlState(defaults: UrlState): [UrlState, (updates: Partial<UrlState>) => void] {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const initialized = useRef(false)
  const pendingUrl = useRef<string | null>(null)

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
    }
  })

  const update = useCallback((updates: Partial<UrlState>) => {
    setState(prev => {
      const next = { ...prev, ...updates }
      const params = new URLSearchParams()
      if (next.lat !== defaults.lat || next.lon !== defaults.lon) {
        params.set('lat', next.lat.toFixed(4))
        params.set('lon', next.lon.toFixed(4))
      }
      if (next.metric !== defaults.metric) params.set('metric', next.metric)
      if (next.models.length !== defaults.models.length || next.models.some((m, i) => m !== defaults.models[i])) {
        if (next.models.length > 0) params.set('models', next.models.join(','))
      }
      if (next.hour !== defaults.hour) params.set('hour', String(next.hour))
      if (next.range !== defaults.range) params.set('range', String(next.range))
      if (next.showMap !== defaults.showMap) params.set('map', next.showMap ? '1' : '0')
      const query = params.toString()
      pendingUrl.current = query ? `${pathname}?${query}` : pathname
      return next
    })
  }, [defaults, pathname])

  useEffect(() => {
    if (pendingUrl.current) {
      router.replace(pendingUrl.current, { scroll: false })
      pendingUrl.current = null
    }
  })

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    const parsed = parseUrlParams(searchParams)
    if (Object.keys(parsed).length > 0) {
      setState(prev => ({ ...prev, ...parsed }))
    }
  }, [searchParams])

  return [state, update]
}
