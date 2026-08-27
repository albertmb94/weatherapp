
/**
 * B-NBT-11: login clásico con FORMULARIO NATIVO (method=post sin JS).
 * El magic link está DESACTIVADO; los errores llegan como ?error=…
 */
const ERRORS: Record<string, string> = {
  credentials: 'Credenciales incorrectas.',
  missing: 'Rellena usuario y contraseña.',
  invalid: 'Petición inválida.',
  rate: 'Demasiados intentos. Espera un minuto.',
  storage: 'Base de datos no disponible.',
  store: 'No se pudo registrar la sesión. Inténtalo de nuevo.',
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const sp = await searchParams
  const errorMsg = sp.error ? (ERRORS[sp.error] ?? 'Error desconocido.') : null

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface-raised p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Weather Admin</h1>
          <p className="text-xs text-text-tertiary mt-1">Acceso restringido al panel de administración.</p>
        </div>
        {errorMsg && (
          <p role="alert" className="text-xs text-red-400">{errorMsg}</p>
        )}
        {/* method=post nativo: funciona incluso si la hidratación falla */}
        <form action="/api/admin/auth/login" method="post" className="space-y-3">
          <input
            type="text"
            name="username"
            placeholder="Usuario"
            autoComplete="username"
            required
            autoFocus
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm"
          />
          <input
            type="password"
            name="password"
            placeholder="Contraseña"
            autoComplete="current-password"
            required
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm"
          />
          <button
            type="submit"
            className="w-full py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
          >
            Acceder
          </button>
        </form>
      </div>
    </div>
  )
}
