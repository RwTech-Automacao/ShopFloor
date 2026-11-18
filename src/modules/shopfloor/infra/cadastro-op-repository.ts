import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { CadastroOp, UltimaOp } from '../domain/cadastro-op'

/** Cria a OP nova numa transação (sf_cadastrar_op, 0184). Erro do banco sobe como veio ({ code, message }). */
export async function cadastrarOp(c: CadastroOp): Promise<string> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('sf_cadastrar_op', { p: {
    ordem: {
      pmo: c.pmo.trim(), op: c.op.trim(), cliente: c.cliente.trim(), qtd: c.qtd, descricao: c.descricao.trim(),
      acp: c.acp.trim(), embalagem_individual: c.embalagemIndividual, placas_por_painel: c.placasPorPainel,
    },
    trechos: c.trechos.map((t) => ({
      seq: t.seq, codigo: t.codigo, tipo: t.tipo, compels_op: t.compelsOp, sn_modo: t.snModo,
      // o banco grava os postos como vierem (a validação compara aparado): manda aparado e sem os vazios
      postos: t.postos.map((p) => p.trim()).filter((p) => p !== ''),
      faixas: t.faixas.map((f) => ({ sn_ini: f.sn_ini.trim(), sn_fim: f.sn_fim.trim() })),
    })),
    componentes: c.componentes,
    burnin: c.burnin,
  } })
  if (error) throw error
  return data as string
}

interface UltimaOpBanco {
  op: string; cliente: string; descricao: string; placas_por_painel: number; embalagem_individual: boolean
  postos: { posto: string; trecho_codigo: string | null }[]
  componentes: { posto: string; pmo: string }[]
  burnin: { posto: string; tempo_min: number }[]
}

/** A última OP da PMO no ShopFloor (sf_ultima_op_da_pmo, 0184), para a OP nova copiar os postos. */
export async function ultimaOpDaPmo(pmo: string): Promise<UltimaOp | null> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('sf_ultima_op_da_pmo', { p_pmo: pmo })
  if (error) throw new Error(`sf_ultima_op_da_pmo: ${error.message}`)
  if (!data) return null
  const d = data as UltimaOpBanco
  return {
    op: d.op, cliente: d.cliente, descricao: d.descricao, placasPorPainel: d.placas_por_painel,
    embalagemIndividual: d.embalagem_individual,
    postos: d.postos.map((p) => ({ posto: p.posto, trechoCodigo: p.trecho_codigo })),
    componentes: d.componentes, burnin: d.burnin,
  }
}
