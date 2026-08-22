'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

interface NavItem {
  href: string
  label: string
  icon: string
  group?: string
}

const NAV: NavItem[] = [
  { href: '/admin', label: 'Overview', icon: '📊' },
  { group: 'Monetización', href: '/admin/features', label: 'Feature flags', icon: '🎚️' },
  { group: 'Monetización', href: '/admin/plans', label: 'Planes', icon: '💳' },
  { group: 'Monetización', href: '/admin/affiliates', label: 'Afiliados', icon: '🤝' },
  { group: 'Monetización', href: '/admin/ads', label: 'Ads', icon: '📢' },
  { group: 'Usuarios', href: '/admin/users', label: 'Usuarios', icon: '👥' },
  { group: 'Usuarios', href: '/admin/emails', label: 'Emails', icon: '📧' },
  { group: 'Contenido', href: '/admin/newsletter', label: 'Newsletter', icon: '📰' },
  { group: 'Contenido', href: '/admin/push', label: 'Push', icon: '🔔' },
  { group: 'Contenido', href: '/admin/donations', label: 'Donaciones', icon: '☕' },
  { group: 'Analytics', href: '/admin/metrics', label: 'Métricas', icon: '📈' },
  { group: 'Sistema', href: '/admin/health', label: 'Health', icon: '🩺' },
  { group: 'Sistema', href: '/admin/settings', label: 'Settings', icon: '⚙️' },
]

interface AdminShellProps {
  email: string
  children: React.ReactNode
}

export default function AdminShell({ email, children }: AdminShellProps) {
  const pathname = usePathname()
  const router = useRouter()

  // Group nav items
  const groups = NAV.reduce<Record<string, NavItem[]>>((acc, item) => {
    const g = item.group ?? '_'
    if (!acc[g]) acc[g] = []
    if (!item.group) acc[g].push(item)
    else acc[g].push(item)
    return acc
  }, {})

  // Re-arrange so ungrouped (Overview) shows first
  const ordered = ['_', ...Object.keys(groups).filter(g => g !== '_')]

  async function logout() {
    await fetch('/api/admin/auth/logout', { method: 'POST' })
    router.push('/admin/login')
  }

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <aside className="w-60 shrink-0 border-r border-border bg-surface-raised flex flex-col">
        <div className="p-4 border-b border-border">
          <div className="text-sm font-semibold">Weather Admin</div>
          <div className="text-xs text-text-tertiary truncate" title={email}>{email}</div>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-3">
          {ordered.map(g => (
            <div key={g}>
              {g !== '_' && (
                <div className="text-[10px] uppercase tracking-wider text-text-tertiary px-2 mt-2 mb-1">
                  {g}
                </div>
              )}
              <ul className="space-y-0.5">
                {(groups[g] ?? []).map(item => {
                  const active = pathname === item.href || (item.href !== '/admin' && pathname?.startsWith(item.href))
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                          active
                            ? 'bg-accent text-white'
                            : 'text-text-secondary hover:bg-surface'
                        }`}
                      >
                        <span>{item.icon}</span>
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="p-3 border-t border-border">
          <button
            onClick={logout}
            className="w-full text-xs text-text-tertiary hover:text-text-primary py-1"
          >
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
    </div>
  )
}
