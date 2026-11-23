'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useKiosk } from '@/shared/ui/kiosk/kiosk-context'
import { IndicadorLinkPendente } from '@/shared/ui/indicador-link-pendente'

/** Barra de abas por seção do Fluxo (Operação/Análise). No kiosk some — a barra única (KioskTabs) cobre a navegação. */
export function AbasFluxo({ tabs }: { tabs: { rotulo: string; href: string }[] }) {
  const pathname = usePathname()
  const { ligado } = useKiosk()
  if (ligado) return null
  return (
    <nav className="mb-4 flex gap-1 border-b border-border print:hidden">
      {tabs.map((t) => {
        const ativa = pathname === t.href || pathname.startsWith(t.href + '/')
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              '-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              ativa
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.rotulo}
            <IndicadorLinkPendente />
          </Link>
        )
      })}
    </nav>
  )
}
