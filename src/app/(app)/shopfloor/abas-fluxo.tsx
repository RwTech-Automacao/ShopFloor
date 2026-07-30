'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

/** Barra de abas por rota do Fluxo (Operação/Análise). Aba ativa por pathname. */
export function AbasFluxo({ tabs }: { tabs: { rotulo: string; href: string }[] }) {
  const pathname = usePathname()
  return (
    <nav className="mb-4 flex gap-1 border-b border-border">
      {tabs.map((t) => {
        const ativa = pathname === t.href || pathname.startsWith(t.href + '/')
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              ativa
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.rotulo}
          </Link>
        )
      })}
    </nav>
  )
}
