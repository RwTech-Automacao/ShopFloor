'use client'

import { useEffect, useState } from 'react'
import { detalharPendenciaAlmoxarifado } from '@/modules/shopfloor/application/almoxarifado-actions'
import type { DetalheAlmoxarifado, PendenciaAlmoxarifado } from '@/modules/shopfloor/domain/almoxarifado'

/** Carregando | erro | ok: a falha de leitura é estado próprio, nunca um detalhe vazio. */
export type EstadoDetalhe =
  | { tipo: 'carregando' }
  | { tipo: 'erro'; erro: string }
  | { tipo: 'ok'; detalhe: DetalheAlmoxarifado }

const FALHA = 'Não foi possível carregar os detalhes.'

/** Carrega o detalhe do cartão aberto, uma vez por montagem. */
export function useDetalhe(item: PendenciaAlmoxarifado): EstadoDetalhe {
  const [estado, setEstado] = useState<EstadoDetalhe>({ tipo: 'carregando' })
  useEffect(() => {
    let vivo = true
    void (async () => {
      let novo: EstadoDetalhe
      try {
        const r = await detalharPendenciaAlmoxarifado({
          pmo: item.pmo, op: item.op, tipo: item.tipo, codigo: item.codigo, loteId: item.loteId,
        })
        novo = r.ok ? { tipo: 'ok', detalhe: r.detalhe } : { tipo: 'erro', erro: r.erro }
      } catch {
        novo = { tipo: 'erro', erro: FALHA }
      }
      if (vivo) setEstado(novo)
    })()
    return () => { vivo = false }
  }, [item.pmo, item.op, item.tipo, item.codigo, item.loteId])
  return estado
}
