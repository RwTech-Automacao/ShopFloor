'use client'

import { Info } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/** O "ⓘ" ao lado de um campo da regra: o que o campo é e como entra no cálculo. Abre no hover e no toque. */
export function Explica({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={120}
        aria-label={`Sobre: ${titulo}`}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Info className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent side="top" className="w-80 gap-1 text-xs leading-relaxed">
        <p className="font-semibold text-foreground">{titulo}</p>
        <div className="flex flex-col gap-1 text-muted-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  )
}
