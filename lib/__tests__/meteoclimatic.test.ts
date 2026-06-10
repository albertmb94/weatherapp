import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseRss, fetchStationData } from '../meteoclimatic'

const SINGLE_STATION_RSS = `<?xml version="1.0" encoding="ISO-8859-15"?>
<rss version="2.0">
 <channel>
  <item>
   <title>Badalona - BCIN (Barcelona)</title>
   <pubDate>Thu, 04 Jun 2026 09:00:00 +0000</pubDate>
   <description><![CDATA[<ul><li>Temperatura</li></ul><!--
[[<BEGIN:ESCAT0800000008915C:DATA>]]
[[<ESCAT0800000008915C;(21,4;22,4;21,0;sun);(90,0;90,0;80,0);(1014,6;1017,1;1014,6);(23,0;43,0;180);(0,0);Badalona - BCIN>]]
[[<END:ESCAT0800000008915C:DATA>]]
--></description>
   <georss:point>41.46 2.26</georss:point>
  </item>
 </channel>
</rss>`

const MULTI_STATION_RSS = `<?xml version="1.0" encoding="ISO-8859-15"?>
<rss version="2.0">
 <channel>
  <item>
   <title>Station A (Barcelona)</title>
   <pubDate>Thu, 04 Jun 2026 09:00:00 +0000</pubDate>
   <description><![CDATA[<!-- [[<BEGIN:ESA:DATA>]] [[<ESA;(20,0;22,0;18,0;sun);(70,0;80,0;60,0);(1010,0;1012,0;1008,0);(10,0;20,0;180);(0,0);Station A>]] [[<END:ESA:DATA>]] --></description>
   <georss:point>41.40 2.20</georss:point>
  </item>
  <item>
   <title>Station B (Barcelona)</title>
   <pubDate>Thu, 04 Jun 2026 09:00:00 +0000</pubDate>
   <description><![CDATA[<!-- [[<BEGIN:ESB:DATA>]] [[<ESB;(18,5;20,0;17,0;cloud);(85,0;90,0;80,0);(1012,0;1015,0;1010,0);(15,0;25,0;270);(2,5);Station B>]] [[<END:ESB:DATA>]] --></description>
   <georss:point>41.38 2.18</georss:point>
  </item>
 </channel>
</rss>`

const ENTITY_NAME_RSS = `<?xml version="1.0" encoding="ISO-8859-15"?>
<rss version="2.0">
 <channel>
  <item>
   <title>Avi&#224; (Barcelona)</title>
   <pubDate>Thu, 04 Jun 2026 09:00:00 +0000</pubDate>
   <description><![CDATA[<!-- [[<BEGIN:ESAV:DATA>]] [[<ESAV;(22,0;22,0;14,4;sun);(68,0;85,0;68,0);(1009,7;1013,4;1009,7);(-99,0;-99,0;233);(0,0);Avi&#224;>]] [[<END:ESAV:DATA>]] --></description>
   <georss:point>41.50 2.30</georss:point>
  </item>
 </channel>
</rss>`

const WIND_ONLY_RSS = `<?xml version="1.0" encoding="ISO-8859-15"?>
<rss version="2.0">
 <channel>
  <item>
   <title>Wind Station</title>
   <pubDate>Thu, 04 Jun 2026 09:00:00 +0000</pubDate>
   <description><![CDATA[<!-- [[<BEGIN:ESW:DATA>]] [[<ESW;(15,0;16,0;14,0;sun);(50,0;60,0;40,0);(1013,0;1015,0;1011,0);(25,0;40,0;90);(0,0);Wind Station>]] [[<END:ESW:DATA>]] --></description>
   <georss:point>40.00 -3.00</georss:point>
  </item>
 </channel>
</rss>`

describe('parseRss', () => {
  it('parses a single station correctly', () => {
    const stations = parseRss(SINGLE_STATION_RSS)
    expect(stations).toHaveLength(1)
    const s = stations[0]
    expect(s.code).toBe('ESCAT0800000008915C')
    expect(s.name).toBe('Badalona - BCIN')
    expect(s.lat).toBeCloseTo(41.46)
    expect(s.lon).toBeCloseTo(2.26)
    expect(s.temperature.current).toBeCloseTo(21.4)
    expect(s.temperature.max).toBeCloseTo(22.4)
    expect(s.temperature.min).toBeCloseTo(21.0)
    expect(s.condition).toBe('sun')
    expect(s.humidity.current).toBeCloseTo(90.0)
    expect(s.humidity.max).toBeCloseTo(90.0)
    expect(s.humidity.min).toBeCloseTo(80.0)
    expect(s.pressure.current).toBeCloseTo(1014.6)
    expect(s.pressure.max).toBeCloseTo(1017.1)
    expect(s.pressure.min).toBeCloseTo(1014.6)
    expect(s.wind.speed).toBeCloseTo(23.0)
    expect(s.wind.gust).toBeCloseTo(43.0)
    expect(s.wind.bearing).toBeCloseTo(180)
    expect(s.wind.direction).toBe('S')
    expect(s.precipitation).toBeCloseTo(0.0)
  })

  it('parses multiple stations from region feed', () => {
    const stations = parseRss(MULTI_STATION_RSS)
    expect(stations).toHaveLength(2)
    expect(stations[0].code).toBe('ESA')
    expect(stations[0].name).toBe('Station A')
    expect(stations[0].temperature.current).toBeCloseTo(20.0)
    expect(stations[1].code).toBe('ESB')
    expect(stations[1].name).toBe('Station B')
    expect(stations[1].temperature.current).toBeCloseTo(18.5)
    expect(stations[1].condition).toBe('cloud')
  })

  it('decodes HTML entities in station names', () => {
    const stations = parseRss(ENTITY_NAME_RSS)
    expect(stations).toHaveLength(1)
    expect(stations[0].name).toBe('Avià')
    expect(stations[0].code).toBe('ESAV')
  })

  it('returns empty array for empty XML', () => {
    expect(parseRss('')).toEqual([])
  })

  it('returns empty array for XML with no items', () => {
    expect(parseRss('<?xml version="1.0"?><rss><channel></channel></rss>')).toEqual([])
  })

  it('skips items without data blocks', () => {
    const xml = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title>No Data Station</title>
    <description><![CDATA[<p>No data</p>]]></description>
  </item>
</channel></rss>`
    expect(parseRss(xml)).toEqual([])
  })

  it('parses wind direction as compass bearing', () => {
    const stations = parseRss(WIND_ONLY_RSS)
    expect(stations).toHaveLength(1)
    expect(stations[0].wind.direction).toBe('E')
    expect(stations[0].wind.bearing).toBe(90)
  })

  it('handles null/missing wind bearing gracefully', () => {
    const xml = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title>Test</title>
    <pubDate>Thu, 04 Jun 2026 09:00:00 +0000</pubDate>
    <description><![CDATA[<!-- [[<BEGIN:EST:DATA>]] [[<EST;(20,0;22,0;18,0;sun);(50,0;60,0;40,0);(1013,0;1015,0;1011,0);(10,0;20,0;);(0,0);Test Station>]] [[<END:EST:DATA>]] --></description>
    <georss:point>40.0 -3.0</georss:point>
  </item>
</channel></rss>`
    const stations = parseRss(xml)
    expect(stations).toHaveLength(1)
    expect(stations[0].wind.direction).toBe('')
  })

  it('handles comma decimals correctly', () => {
    const stations = parseRss(SINGLE_STATION_RSS)
    expect(stations[0].temperature.current).toBeCloseTo(21.4)
    expect(stations[0].pressure.current).toBeCloseTo(1014.6)
  })

  it('preserves updatedAt from pubDate', () => {
    const stations = parseRss(SINGLE_STATION_RSS)
    expect(stations[0].updatedAt).toBe('Thu, 04 Jun 2026 09:00:00 +0000')
  })
})

describe('fetchStationData', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('fetches and parses station data', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(SINGLE_STATION_RSS),
    })

    const stations = await fetchStationData('ESCAT0800000008915C')
    expect(stations).toHaveLength(1)
    expect(stations[0].code).toBe('ESCAT0800000008915C')

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://meteoclimatic.net/feed/rss/ESCAT0800000008915C',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          'User-Agent': expect.stringContaining('Mozilla'),
        }),
      })
    )
  })

  it('throws on non-OK response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: vi.fn().mockResolvedValue('Forbidden'),
    })

    await expect(fetchStationData('ESCAT08')).rejects.toThrow('Meteoclimatic fetch failed: 403')
  })

  it('throws on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    await expect(fetchStationData('ESCAT08')).rejects.toThrow('Network error')
  })
})
