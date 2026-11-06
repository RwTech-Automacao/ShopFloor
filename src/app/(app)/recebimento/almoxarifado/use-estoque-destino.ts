'use client'

import { useCallback, useEffect, useState } from 'react'
import { ESTOQUE_PADRAO, type EstoqueDestino } from '@/modules/compels/domain/estoque-destino'
import { estoqueDestinoDaOp } from '@/modules/shopfloor/application/almoxarifado-actions'

export interface EstoqueEscolhido {
  /** A escolha só é oferecida quando o EINTER está configurado neste ambiente; senão tudo segue como sempre (PA). */
  disponivel: boolean
  /** O estoque selecionado: a escolha da pessoa, ou o padrão (o último estoque lançado nesta OP; PA na primeira vez). */
  valor: EstoqueDestino
  escolher: (e: EstoqueDestino) => void
  /** O que mandar à action: `undefined` quando a escolha não é oferecida (a chamada fica igual à de antes). */
  paraEnvio: EstoqueDestino | undefined
  aviso?: string
}

interface Info { einterDisponivel: boolean; padrao: EstoqueDestino; aviso?: string }

/**
 * A escolha PA × EINTER (0175) de quem confirma no Almoxarifado, por OP. Pré-selecionada com o último estoque
 * lançado na OP (a action consulta o banco). Falha ao consultar = a escolha não é oferecida (só PA, como
 * sempre): nunca trava a confirmação. A resposta vale para a OP a que pertence; trocar de OP descarta a
 * escolha anterior.
 */
export function useEstoqueDestino(pmo: string, op: string): EstoqueEscolhido {
  const chave = `${pmo}/${op}`
  const [resposta, setResposta] = useState<{ chave: string; info: Info } | null>(null)
  const [escolha, setEscolha] = useState<{ chave: string; valor: EstoqueDestino } | null>(null)

  useEffect(() => {
    if (pmo.trim() === '' || op.trim() === '') return
    let vivo = true
    void (async () => {
      try {
        const r = await estoqueDestinoDaOp(pmo, op)
        if (vivo && r.ok) setResposta({ chave: `${pmo}/${op}`, info: r })
      } catch {
        // sem resposta, sem escolha: segue PA
      }
    })()
    return () => { vivo = false }
  }, [pmo, op])

  const info = resposta && resposta.chave === chave ? resposta.info : null
  const disponivel = info?.einterDisponivel === true
  const valor: EstoqueDestino = !disponivel
    ? ESTOQUE_PADRAO
    : escolha && escolha.chave === chave
      ? escolha.valor
      : info.padrao
  const escolher = useCallback((e: EstoqueDestino) => setEscolha({ chave, valor: e }), [chave])
  return { disponivel, valor, escolher, paraEnvio: disponivel ? valor : undefined, aviso: info?.aviso }
}
