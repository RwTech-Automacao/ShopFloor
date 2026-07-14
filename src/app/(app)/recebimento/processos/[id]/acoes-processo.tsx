'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { StatusProcesso } from '@/modules/recebimento/domain/ciclo-vida'
import { finalizarProcesso, reabrirProcesso } from '@/modules/recebimento/application/transicoes-processo'

interface AcoesProcessoProps {
  processoId: string
  status: StatusProcesso
  podeFinalizar: boolean
  podeEditarFinalizado: boolean
  /**
   * Quando `true`, o botão Finalizar fica desabilitado com uma dica — usado
   * enquanto o formulário tem alterações não salvas, para evitar finalizar
   * com valores diferentes dos que o usuário está vendo/editando na tela.
   */
  finalizarBloqueado?: boolean
}

/**
 * Botões contextuais de mudança de status, conforme o status atual e as
 * permissões do usuário. As Server Actions (`finalizarProcesso`,
 * `reabrirProcesso`) são a única fonte de verdade sobre o que é permitido —
 * os `pode*` aqui só controlam a exibição/UX do botão.
 */
export function AcoesProcesso({
  processoId,
  status,
  podeFinalizar,
  podeEditarFinalizado,
  finalizarBloqueado = false,
}: AcoesProcessoProps) {
  const mostrarFinalizar = status === 'em_conferencia' && podeFinalizar
  const mostrarReabrir =
    status !== 'aberto' && status !== 'em_conferencia' && podeEditarFinalizado

  if (!mostrarFinalizar && !mostrarReabrir) return null

  return (
    <div className="flex flex-wrap items-start gap-3">
      {mostrarFinalizar && (
        <BotaoFinalizar processoId={processoId} bloqueado={finalizarBloqueado} />
      )}
      {mostrarReabrir && <BotaoReabrir processoId={processoId} />}
    </div>
  )
}

function BotaoFinalizar({ processoId, bloqueado }: { processoId: string; bloqueado: boolean }) {
  const [pending, startTransition] = useTransition()

  function onClick() {
    startTransition(async () => {
      const resultado = await finalizarProcesso(processoId)
      if (resultado.ok) toast.success('Processo finalizado.')
      else toast.error(resultado.erro)
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <Button onClick={onClick} disabled={pending || bloqueado}>
        {pending ? 'Finalizando…' : 'Finalizar'}
      </Button>
      {bloqueado && (
        <p className="max-w-sm text-sm text-muted-foreground">
          Salve as alterações antes de finalizar.
        </p>
      )}
    </div>
  )
}

function BotaoReabrir({ processoId }: { processoId: string }) {
  const [pending, startTransition] = useTransition()

  function onClick() {
    startTransition(async () => {
      const resultado = await reabrirProcesso(processoId)
      if (resultado.ok) toast.success('Processo reaberto.')
      else toast.error(resultado.erro)
    })
  }

  return (
    <Button variant="outline" onClick={onClick} disabled={pending}>
      {pending ? 'Reabrindo…' : 'Reabrir'}
    </Button>
  )
}
