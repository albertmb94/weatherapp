'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'

interface TemplateSummary {
  id: string
  name: string
  category: string
  enabled: boolean
  updatedAt: number | null
}

interface EmailLogEntry {
  id: string
  templateId: string | null
  recipient: string
  subject: string | null
  status: string
  resendId: string | null
  error: string | null
  metadata: string | null
  sentAt: number | null
  sentBy: string | null
}

export default function EmailsPage() {
  const [tab, setTab] = useState<'templates' | 'log'>('templates')

  const { data: templatesData } = useQuery({
    queryKey: ['admin', 'email-templates'],
    queryFn: async () => {
      const r = await fetch('/api/admin/emails/templates')
      if (!r.ok) throw new Error('failed')
      return r.json() as Promise<{ ok: boolean; templates: TemplateSummary[] }>
    },
  })

  const { data: logData } = useQuery({
    queryKey: ['admin', 'email-log'],
    queryFn: async () => {
      const r = await fetch('/api/admin/emails/log?limit=100')
      if (!r.ok) throw new Error('failed')
      return r.json() as Promise<{ ok: boolean; entries: EmailLogEntry[] }>
    },
    enabled: tab === 'log',
  })

  return (
    <div className="p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Emails</h1>
        <p className="text-sm text-text-tertiary">
          Edita templates transaccionales y marketing. El envío está gated por la feature <code className="text-[10px]">feature.resend</code>.
        </p>
      </header>

      <div className="flex gap-2 border-b border-border">
        <button
          onClick={() => setTab('templates')}
          className={`px-3 py-1.5 text-xs font-medium border-b-2 ${
            tab === 'templates' ? 'border-accent text-text-primary' : 'border-transparent text-text-tertiary'
          }`}
        >
          Templates
        </button>
        <button
          onClick={() => setTab('log')}
          className={`px-3 py-1.5 text-xs font-medium border-b-2 ${
            tab === 'log' ? 'border-accent text-text-primary' : 'border-transparent text-text-tertiary'
          }`}
        >
          Log
        </button>
      </div>

      {tab === 'templates' && (
        <div className="rounded-2xl border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-surface-raised">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Nombre</th>
                <th className="px-3 py-2 font-medium">Categoría</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {(templatesData?.templates ?? []).map(t => (
                <tr key={t.id} className="border-t border-border hover:bg-surface-raised">
                  <td className="px-3 py-2 font-mono text-[10px]">{t.id}</td>
                  <td className="px-3 py-2">{t.name}</td>
                  <td className="px-3 py-2 text-text-tertiary">{t.category}</td>
                  <td className="px-3 py-2">{t.enabled ? '✅' : '❌'}</td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/emails/templates/${encodeURIComponent(t.id)}`}
                      className="text-accent hover:underline"
                    >
                      Editar
                    </Link>
                  </td>
                </tr>
              ))}
              {(templatesData?.templates ?? []).length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-text-tertiary">Sin templates.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'log' && (
        <div className="rounded-2xl border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-surface-raised">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Fecha</th>
                <th className="px-3 py-2 font-medium">Para</th>
                <th className="px-3 py-2 font-medium">Template</th>
                <th className="px-3 py-2 font-medium">Asunto</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium">Enviado por</th>
              </tr>
            </thead>
            <tbody>
              {(logData?.entries ?? []).map((e: EmailLogEntry) => (
                <tr key={e.id} className="border-t border-border hover:bg-surface-raised">
                  <td className="px-3 py-2 text-text-tertiary">{e.sentAt ? new Date(e.sentAt).toLocaleString() : '—'}</td>
                  <td className="px-3 py-2 font-mono text-[10px]">{e.recipient}</td>
                  <td className="px-3 py-2 text-text-tertiary">{e.templateId ?? '—'}</td>
                  <td className="px-3 py-2 truncate max-w-[200px]">{e.subject}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      e.status === 'sent' ? 'bg-emerald-500/15 text-emerald-400' :
                      e.status === 'failed' ? 'bg-red-500/15 text-red-400' :
                      e.status === 'skipped' ? 'bg-amber-500/15 text-amber-400' :
                      'bg-gray-500/15 text-text-tertiary'
                    }`}>{e.status}</span>
                  </td>
                  <td className="px-3 py-2 text-text-tertiary">{e.sentBy ?? '—'}</td>
                </tr>
              ))}
              {(logData?.entries ?? []).length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-text-tertiary">Sin envíos.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
