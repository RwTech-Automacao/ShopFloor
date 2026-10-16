'use client'

import { Button } from '@/components/ui/button'
import { DESCRICAO_TIPO_REGRA, NOME_TIPO_REGRA, type TipoRegra } from '@/modules/alertas/domain/tipos'
import { TIPOS_REGRA_POR_MODULO, type ModuloAlerta } from '@/modules/alertas/domain/modulo'

/** Regra nova começa aqui: um cartão por tipo DO MÓDULO (título + uma frase). O tipo não muda depois. */
export function TipoEscolha({
  modulo,
  onEscolher,
}: {
  modulo: ModuloAlerta
  onEscolher: (tipo: TipoRegra) => void
}) {
  const tipos = TIPOS_REGRA_POR_MODULO[modulo]
  return (
    // A grade era de 3 colunas para 3 cartões; com 4 (ShopFloor) ela ficou apertada. Duas colunas
    // acomodam 4 e 1 sem cartão órfão esticado.
    <div className="grid gap-3 sm:grid-cols-2">
      {tipos.map((t) => (
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
