'use client'

import { useState } from 'react'
import type { StatusProcesso } from '@/modules/recebimento/domain/ciclo-vida'
import type { CampoFormulario } from '@/modules/recebimento/infra/processo-detalhe-repository'
import type { FaixaNqa } from '@/modules/recebimento/domain/calculos'
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
  podeEditarFinalizado: boolean
  fornecedoresCriticos: string[]
  nqa: FaixaNqa[]
  usuarioAtual: string
  /** Nome de quem salvou por último a seção Recebimento, ou `null` se ainda não salva. */
  responsavelRecebimento: string | null
  /** Nome de quem salvou por último a seção Qualidade, ou `null` se ainda não salva. */
  responsavelQualidade: string | null
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
  podeEditarFinalizado,
  fornecedoresCriticos,
  nqa,
  usuarioAtual,
  responsavelRecebimento,
  responsavelQualidade,
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
        fornecedoresCriticos={fornecedoresCriticos}
        nqa={nqa}
        usuarioAtual={usuarioAtual}
        responsavelRecebimento={responsavelRecebimento}
        responsavelQualidade={responsavelQualidade}
      />

      <AcoesProcesso
        processoId={processoId}
        status={status}
        podeFinalizar={podeFinalizar}
        podeEditarFinalizado={podeEditarFinalizado}
        finalizarBloqueado={dirty}
      />
    </>
  )
}
