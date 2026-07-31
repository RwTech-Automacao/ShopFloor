import { serieDentroDaFaixa } from './serie'
import { receitaPermite } from './receita'

export interface FaixaOp {
  pmo: string
  op: string
  sn_ini: string
  sn_fim: string
}

export interface CandidatoPlaca {
  pmo: string
  op: string
}

export type ResolucaoPlaca =
  | { ok: true; pmo: string; op: string }
  | { ok: false; erro: 'SEM_OP' | 'FORA_RECEITA' }
  | { ok: false; erro: 'AMBIGUO'; candidatos: CandidatoPlaca[] }

/**
 * Acha a OP/PMO de uma placa pelo SN bipado: dentro da faixa E com a PMO na receita do produto.
 * Se mais de uma OP da receita contém o SN → AMBIGUO + a lista de candidatos (o operador escolhe).
 */
export function resolverPlaca(receita: string[], faixas: FaixaOp[], sn: string): ResolucaoPlaca {
  const comFaixa = faixas.filter(
    (f) => f.sn_ini.trim() !== '' && f.sn_fim.trim() !== '' && serieDentroDaFaixa(f.sn_ini, f.sn_fim, sn),
  )
  if (comFaixa.length === 0) return { ok: false, erro: 'SEM_OP' }
  const naReceita = comFaixa.filter((f) => receitaPermite(receita, f.pmo))
  if (naReceita.length === 0) return { ok: false, erro: 'FORA_RECEITA' }
  if (naReceita.length > 1) {
    return { ok: false, erro: 'AMBIGUO', candidatos: naReceita.map((f) => ({ pmo: f.pmo, op: f.op })) }
  }
  return { ok: true, pmo: naReceita[0]!.pmo, op: naReceita[0]!.op }
}
