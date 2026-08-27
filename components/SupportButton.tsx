'use client'

import Link from 'next/link'
import { useLocale } from '@/lib/LocaleContext'
import { localizedHref } from '@/lib/locale/routing'

export default function SupportButton() {
  const { locale } = useLocale()
  const es = locale === 'es'
  return (
    <Link
      href={localizedHref('/support', locale)}
      className="text-[10px] text-text-tertiary hover:text-text-primary"
      aria-label={es ? 'Invítame a un café' : 'Buy me a coffee'}
    >
      ☕ {es ? 'Invítame a un café' : 'Buy me a coffee'}
    </Link>
  )
}
