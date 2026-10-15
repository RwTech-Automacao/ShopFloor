'use client'

import { Info } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * O "ⓘ" com a definição de um número. Abre no hover e no toque (tablet). Mesma ideia do dashboard
 * do ShopFloor, copiada de propósito: esta tela não depende de código do ShopFloor.
 */
export function Explica({ texto, rotulo = 'Como é calculado' }: { texto: string; rotulo?: string }) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={120}
        aria-label={rotulo}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Info className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent side="top" className="w-72 max-w-[calc(100vw-2rem)] gap-1 text-xs leading-relaxed">
        <p className="font-semibold text-foreground">{rotulo}</p>
        <p className="text-muted-foreground">{texto}</p>
      </PopoverContent>
    </Popover>
  )
}
