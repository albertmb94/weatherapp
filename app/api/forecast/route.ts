import { NextResponse } from 'next/server'

// Open-Meteo can emit invalid JSON when a model has no coverage for a
// requested location: bare `nan`, `NaN`, `undefined`, or `Infinity` literals
// leak into the response body. We sanitize those tokens before parsing.
function sanitizeOpenMeteoJson(raw: string): string {
  return raw
    .replace(/:\s*nan\b/gi, ': null')
    .replace(/:\s*undefined\b/g, ': null')
    .replace(/:\s*-?Infinity\b/g, ': null')
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const url = `https://api.open-meteo.com/v1/forecast?${searchParams.toString()}`

  try {
    const res = await fetch(url)
    const text = await res.text()
    if (!res.ok) {
      return NextResponse.json(
        { error: `Open-Meteo ${res.status}`, detail: text },
        { status: res.status }
      )
    }
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      data = JSON.parse(sanitizeOpenMeteoJson(text))
    }
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch forecast' }, { status: 502 })
  }
}
