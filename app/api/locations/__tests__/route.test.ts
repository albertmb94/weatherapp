import { describe, it, expect } from 'vitest'
import { GET, POST, DELETE } from '@/app/api/locations/route'

describe('/api/locations (removed, per-device only)', () => {
  it('GET returns 410 Gone', async () => {
    const res = await GET()
    expect(res.status).toBe(410)
  })

  it('POST returns 410 Gone', async () => {
    const res = await POST()
    expect(res.status).toBe(410)
  })

  it('DELETE returns 410 Gone', async () => {
    const res = await DELETE()
    expect(res.status).toBe(410)
  })
})
