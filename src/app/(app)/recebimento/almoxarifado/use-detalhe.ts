'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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

/**
 * Como o useDetalhe, mas com `recarregar`: o cartão de peças avulsas muda a cada bipe aceito (o número
 * esperando cai). A recarga NÃO volta ao "carregando" (o campo de bipe não pode piscar); só a última vale.
 */
export function useDetalheRecarregavel(item: PendenciaAlmoxarifado): { estado: EstadoDetalhe; recarregar: () => Promise<void> } {
  const [estado, setEstado] = useState<EstadoDetalhe>({ tipo: 'carregando' })
  const seq = useRef(0)
  const vivo = useRef(true)
  const { pmo, op, tipo, codigo, loteId } = item
  const recarregar = useCallback(async () => {
    const minha = ++seq.current
    let novo: EstadoDetalhe
    try {
      const r = await detalharPendenciaAlmoxarifado({ pmo, op, tipo, codigo, loteId })
      novo = r.ok ? { tipo: 'ok', detalhe: r.detalhe } : { tipo: 'erro', erro: r.erro }
    } catch {
      novo = { tipo: 'erro', erro: FALHA }
    }
    if (vivo.current && minha === seq.current) setEstado(novo)
  }, [pmo, op, tipo, codigo, loteId])
  useEffect(() => {
    vivo.current = true
    void recarregar()
    return () => { vivo.current = false }
  }, [recarregar])
  return { estado, recarregar }
}
