'use client'

import { Button } from '@/components/ui/button'
import { DESCRICAO_TIPO_REGRA, NOME_TIPO_REGRA, TIPOS_REGRA, type TipoRegra } from '@/modules/alertas/domain/tipos'

/** Regra nova começa aqui: um cartão por tipo (título + uma frase). O tipo não muda depois. */
export function TipoEscolha({ onEscolher }: { onEscolher: (tipo: TipoRegra) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {TIPOS_REGRA.map((t) => (
        <Button
          key={t}
          type="button"
          variant="outline"
          onClick={() => onEscolher(t)}
          className="h-auto flex-col items-start justify-start gap-1 whitespace-normal p-4 text-left"
        >
          <span className="text-sm font-semibold">{NOME_TIPO_REGRA[t]}</span>
          <span className="text-xs font-normal text-muted-foreground">{DESCRICAO_TIPO_REGRA[t]}</span>
        </Button>
      ))}
    </div>
  )
}
