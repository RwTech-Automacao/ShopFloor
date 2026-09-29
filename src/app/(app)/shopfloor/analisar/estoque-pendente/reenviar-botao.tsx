'use client'

import { useTransition } from 'react'
import { RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { reenviarEstoqueAction } from '@/modules/shopfloor/application/estoque-pendente-actions'

/**
 * O Reenviar de UMA linha da fila de estoque.
 *
 * TOAST EMBAIXO (`bottom-center`), e não o painel fixo grande: esta é uma tela de GESTOR, não de
 * bipe — a decisão travada do usuário é painel fixo só nas telas de bipe, e toast embaixo (perto da
 * ação, onde o olho já está) nas telas de cadastro e análise. É o mesmo padrão do Excluir OP.
 *
 * Não há diálogo de confirmação: reenviar é reversível por natureza (a linha volta para a fila e a
 * chave de idempotência impede o ERP de contar a movimentação duas vezes), ao contrário do Excluir
 * OP, que apaga. O que protege contra o clique repetido é o `disabled` enquanto a ação corre, e a
 * própria ação, que recusa a linha que já voltou para a fila.
 */
export function ReenviarBotao({ id, chave }: { id: string; chave: string }) {
  const [pendente, startTransition] = useTransition()

  function onReenviar() {
    startTransition(async () => {
      const r = await reenviarEstoqueAction(id)
      if (r.ok) {
        toast.success(`${chave} voltou para a fila do Compels`, { position: 'bottom-center' })
      } else {
        // `duration` maior que o padrão porque as recusas aqui EXPLICAM o motivo (a linha mudou, uma
        // rodada está entregando, falta permissão) — texto que não se lê em 4 segundos.
        toast.error(r.erro, { position: 'bottom-center', duration: 10_000 })
      }
    })
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pendente}
      onClick={onReenviar}
      aria-label={`Reenviar ${chave}`}
    >
      <RotateCcw className="size-4" />
      {pendente ? 'Reenviando…' : 'Reenviar'}
    </Button>
  )
}
