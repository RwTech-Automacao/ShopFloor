'use client'

import { Button } from '@/components/ui/button'
import { ESTOQUES_DESTINO, ROTULO_ESTOQUE } from '@/modules/compels/domain/estoque-destino'
import type { EstoqueEscolhido } from './use-estoque-destino'

/**
 * O seletor PA / EINTER (0175) de quem confirma no Almoxarifado. Só aparece quando o EINTER está configurado
 * neste ambiente; do contrário não renderiza nada (a tela fica exatamente como era).
 */
export function SeletorEstoque({ estoque, desabilitado = false }: { estoque: EstoqueEscolhido; desabilitado?: boolean }) {
  if (!estoque.disponivel) return null
  return (
    <div className="flex flex-col gap-1">
      <div role="group" aria-label="Estoque de destino" className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Estoque</span>
        {ESTOQUES_DESTINO.map((e) => (
          <Button
            key={e}
            type="button"
            size="sm"
            variant={estoque.valor === e ? 'default' : 'outline'}
            aria-pressed={estoque.valor === e}
            onClick={() => estoque.escolher(e)}
            disabled={desabilitado}
          >
            {ROTULO_ESTOQUE[e]}
          </Button>
        ))}
      </div>
      {estoque.aviso && <p className="text-xs text-amber-700 dark:text-amber-400">{estoque.aviso}</p>}
    </div>
  )
}
