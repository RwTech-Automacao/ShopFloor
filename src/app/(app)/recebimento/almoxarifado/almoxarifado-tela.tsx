'use client'

import { useCallback, useEffect, useState } from 'react'
import { PainelResultado, type ResultadoAcao } from '@/components/ui/painel-resultado'
import { listarPendenciasAlmoxarifado } from '@/modules/shopfloor/application/almoxarifado-actions'
import type { PendenciaAlmoxarifado } from '@/modules/shopfloor/domain/almoxarifado'
import { CaixaAberta, type ConfirmacaoCartao } from './caixa-aberta'
import { ListaCartoes, type EstadoLista } from './lista-cartoes'
import { LoteAberto } from './lote-aberto'

const FALHA_LISTA = 'Não foi possível carregar o que está esperando confirmação.'

/**
 * Tela do Almoxarifado: a lista de pendências (cartões) e, ao escolher um, o cartão aberto para conferir
 * e bipar. O resultado da última ação fica no painel até a próxima — também com o cartão aberto, para a
 * recusa do banco aparecer sem fechar o cartão.
 */
export function AlmoxarifadoTela({ colaborador, posto }: { colaborador: string; posto: string }) {
  const [itens, setItens] = useState<EstadoLista>({ tipo: 'carregando' })
  const [selecionado, setSelecionado] = useState<PendenciaAlmoxarifado | null>(null)
  const [resultado, setResultado] = useState<ResultadoAcao | null>(null)

  const carregar = useCallback(async () => {
    let novo: EstadoLista
    try {
      const r = await listarPendenciasAlmoxarifado()
      novo = r.ok ? { tipo: 'ok', itens: r.pendencias } : { tipo: 'erro', erro: r.erro }
    } catch {
      novo = { tipo: 'erro', erro: FALHA_LISTA }
    }
    setItens(novo)
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  function onConfirmado(c: ConfirmacaoCartao) {
    const caixa = selecionado?.tipo === 'caixa'
    setResultado({
      tipo: 'ok',
      titulo: c.quantidade === 1 ? '1 peça' : `${c.quantidade} peças`,
      detalhe: c.divergencia,
      chips: [{ rotulo: caixa ? 'Caixa' : 'Lote', valor: c.codigo, mono: true }],
      dica: c.divergencia ? 'Confira a caixa física e avise o gestor: a diferença não deu entrada.' : undefined,
    })
    setSelecionado(null)
    void carregar()
  }

  function onVoltar() {
    setSelecionado(null)
    void carregar()
  }

  return (
    <div className="flex flex-col gap-4">
      <PainelResultado resultado={resultado} />
      {selecionado === null && (
        <ListaCartoes
          estado={itens}
          onEscolher={(i) => { setResultado(null); setSelecionado(i) }}
          onAtualizar={() => void carregar()}
        />
      )}
      {selecionado?.tipo === 'caixa' && (
        <CaixaAberta
          key={selecionado.codigo}
          item={selecionado}
          colaborador={colaborador}
          posto={posto}
          onResultado={setResultado}
          onConfirmado={onConfirmado}
          onVoltar={onVoltar}
        />
      )}
      {selecionado?.tipo === 'lote' && (
        <LoteAberto
          key={selecionado.codigo}
          item={selecionado}
          colaborador={colaborador}
          posto={posto}
          onResultado={setResultado}
          onConfirmado={onConfirmado}
          onVoltar={onVoltar}
        />
      )}
    </div>
  )
}
