import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../admin/auth'

describe('admin password hashing (B-NBT-11)', () => {
  it('roundtrip: contraseña correcta verifica', () => {
    const stored = hashPassword('Wx-Staging-2026!k7Q')
    expect(verifyPassword('Wx-Staging-2026!k7Q', stored)).toBe(true)
  })

  it('rechaza contraseña incorrecta', () => {
    const stored = hashPassword('correcta')
    expect(verifyPassword('incorrecta', stored)).toBe(false)
  })

  it('formato s1$salt$hash con salt aleatorio por llamada', () => {
    const a = hashPassword('x')
    const b = hashPassword('x')
    expect(a).not.toBe(b) // salts distintos
    expect(a.startsWith('s1$')).toBe(true)
    expect(a.split('$').length).toBe(3)
  })

  it('rechaza hashes corruptos sin lanzar', () => {
    expect(verifyPassword('x', 'garbage')).toBe(false)
    expect(verifyPassword('x', 's2$zz$zz')).toBe(false)
    expect(verifyPassword('', 's1$aa$' + '0'.repeat(128))).toBe(false)
  })
})