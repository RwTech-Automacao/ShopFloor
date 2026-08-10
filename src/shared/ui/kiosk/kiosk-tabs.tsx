'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useKiosk } from './kiosk-context'
import { TODAS_ABAS } from './abas'

/** Barra ÚNICA do kiosk: todas as abas liberadas juntas (Operação + Análise), pra navegar entre seções. */
export function KioskTabs() {
  const { ligado, abas } = useKiosk()
  const pathname = usePathname()
  if (!ligado) return null
  const tabs = TODAS_ABAS.filter((t) => abas.includes(t.href))
  if (tabs.length <= 1) return null // 1 aba só → não precisa de barra
  return (
    <nav className="flex shrink-0 gap-1 border-b border-border bg-card px-4 sm:px-6">
      {tabs.map((t) => {
        const ativa = pathname === t.href || pathname.startsWith(t.href + '/')
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              ativa ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.rotulo}
          </Link>
        )
      })}
    </nav>
  )
}
