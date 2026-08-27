'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { ThemeProvider } from '@/lib/ThemeContext'

// LocaleProvider ya NO se monta aquí: necesita el idioma del segmento de
// ruta, que este layout raíz no conoce (está por encima de [locale]).
// Lo monta app/[locale]/layout.tsx con el valor que recibe por params.
// Derivarlo aquí con usePathname() rompía la hidratación de todo el
// subárbol — ver el comentario largo en lib/LocaleContext.tsx.

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  }))

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  )
}
