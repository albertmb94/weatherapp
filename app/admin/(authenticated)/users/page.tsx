'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'

interface UserRow {
  email: string
  premium: boolean
  stations: boolean
  totalSubscriptions: number
  active: number
  lastSeen: number | null
}

export default function UsersPage() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'premium' | 'stations' | 'canceled'>('all')

  // AUDITORÍA: `query` entraba directo en la queryKey, así que se
  // disparaba una petición POR PULSACIÓN de tecla. 300 ms de espera
  // convierten "barcelona" en una consulta en vez de nueve.
  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(t)
  }, [query])

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'users', debouncedQuery, filter],
    queryFn: async () => {
      const r = await fetch(`/api/admin/users?q=${encodeURIComponent(debouncedQuery)}&filter=${filter}`)
      if (!r.ok) throw new Error(`El servidor respondió ${r.status}`)
      return r.json() as Promise<{ ok: boolean; users: UserRow[]; total: number }>
    },
  })

  return (
    <div className="p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Usuarios</h1>
        <p className="text-sm text-text-tertiary">
          Busca por email. Click para ver detalle y conceder grants manuales.
        </p>
      </header>

      <div className="flex gap-2 flex-wrap">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="email@dominio.com"
          className="flex-1 min-w-[200px] px-3 py-1.5 rounded border border-border bg-surface text-xs"
        />
        <select
          value={filter}
          onChange={e => setFilter(e.target.value as 'all' | 'premium' | 'stations' | 'canceled')}
          className="px-3 py-1.5 rounded border border-border bg-surface text-xs"
        >
          <option value="all">Todos</option>
          <option value="premium">Con Premium</option>
          <option value="stations">Con Estaciones</option>
          <option value="canceled">Cancelados</option>
        </select>
      </div>

      {isLoading && <div className="text-sm text-text-tertiary">Cargando…</div>}

      <div className="rounded-2xl border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-surface-raised">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Premium</th>
              <th className="px-3 py-2 font-medium">Estaciones</th>
              <th className="px-3 py-2 font-medium">Activas</th>
              <th className="px-3 py-2 font-medium">Últ. visita</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {(data?.users ?? []).map(u => (
              <tr key={u.email} className="border-t border-border hover:bg-surface-raised">
                <td className="px-3 py-2 font-mono">{u.email}</td>
                <td className="px-3 py-2">{u.premium ? '✅' : '—'}</td>
                <td className="px-3 py-2">{u.stations ? '✅' : '—'}</td>
                <td className="px-3 py-2">{u.active} / {u.totalSubscriptions}</td>
                <td className="px-3 py-2 tabular-nums">
                  {u.lastSeen
                    ? new Date(Number(u.lastSeen)).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
                    : '—'}
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/users/${encodeURIComponent(u.email)}`}
                    className="text-accent hover:underline"
                  >
                    Ver detalle
                  </Link>
                </td>
              </tr>
            ))}
            {/* AUDITORÍA: no se desestructuraba `isError`, así que un 500 del
                servidor se mostraba como "Sin resultados." — el admin
                concluía que no tenía usuarios cuando en realidad la
                consulta había fallado. */}
            {isError && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center">
                  <p className="text-sm text-red-500">
                    No se pudo cargar la lista de usuarios
                    {error instanceof Error ? `: ${error.message}` : '.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => refetch()}
                    className="mt-2 px-3 py-1 rounded-lg border border-border text-xs hover:bg-surface-raised"
                  >
                    Reintentar
                  </button>
                </td>
              </tr>
            )}
            {!isError && (data?.users ?? []).length === 0 && !isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-text-tertiary">
                  Sin resultados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-text-tertiary">
        Mostrando {data?.users.length ?? 0} de {data?.total ?? 0}
      </div>
    </div>
  )
}
