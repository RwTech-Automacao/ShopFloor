'use client'

import { useState } from 'react'
import type { StatusProcesso } from '@/modules/recebimento/domain/ciclo-vida'
import type { CampoFormulario } from '@/modules/recebimento/infra/processo-detalhe-repository'
import { AcoesProcesso } from './acoes-processo'
import { ProcessoForm } from './processo-form'

interface ProcessoDetalheProps {
  processoId: string
  status: StatusProcesso
  campos: CampoFormulario[]
  itensPorLista: Record<string, string[]>
  valoresIniciais: Record<string, string | number | null>
  somenteLeitura: boolean
  podeFinalizar: boolean
  podeExcluir: boolean
  podeEditarFinalizado: boolean
}

/**
 * Compõe o formulário e os botões de ação, coordenando os dois: enquanto o
 * formulário tem alterações não salvas (`dirty`), o botão Finalizar fica
 * bloqueado — `finalizarProcesso` valida os campos obrigatórios a partir dos
 * valores já salvos no banco, então finalizar com o formulário "sujo"
 * levaria a uma mensagem de erro confusa (ou, pior, finalizaria valores
 * desatualizados sem avisar o usuário).
 */
export function ProcessoDetalhe({
  processoId,
  status,
  campos,
  itensPorLista,
  valoresIniciais,
  somenteLeitura,
  podeFinalizar,
  podeExcluir,
  podeEditarFinalizado,
}: ProcessoDetalheProps) {
  const [dirty, setDirty] = useState(false)

  return (
    <>
      <ProcessoForm
        processoId={processoId}
        campos={campos}
        itensPorLista={itensPorLista}
        valoresIniciais={valoresIniciais}
        somenteLeitura={somenteLeitura}
        onDirtyChange={setDirty}
      />

      <AcoesProcesso
        processoId={processoId}
        status={status}
        podeFinalizar={podeFinalizar}
        podeExcluir={podeExcluir}
        podeEditarFinalizado={podeEditarFinalizado}
        finalizarBloqueado={dirty}
      />
    </>
  )
}
