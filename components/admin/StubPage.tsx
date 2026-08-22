interface StubProps {
  title: string
  description: string
  children?: React.ReactNode
}

export function StubPage({ title, description, children }: StubProps) {
  return (
    <div className="p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-text-tertiary">{description}</p>
      </header>
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex items-center gap-2">
          <span className="text-amber-400 text-sm">⚠️</span>
          <span className="text-sm font-medium">Funcionalidad desconectada</span>
        </div>
        <p className="text-xs text-text-tertiary mt-1">
          Esta sección se mostrará conectada cuando el feature flag correspondiente esté activo en{' '}
          <a href="/admin/features" className="text-accent hover:underline">/admin/features</a> y se hayan rellenado los parámetros requeridos.
        </p>
      </div>
      {children}
    </div>
  )
}
