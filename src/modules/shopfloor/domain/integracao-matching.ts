import { serieDentroDaFaixa } from './serie'
import { receitaPermite } from './receita'

export interface FaixaOp {
  pmo: string
  op: string
  sn_ini: string
  sn_fim: string
}

/** Acha a OP/PMO de uma placa pelo SN bipado: dentro da faixa E com a PMO na receita do produto. */
export function resolverPlaca(
  receita: string[],
  faixas: FaixaOp[],
  sn: string,
): { ok: true; pmo: string; op: string } | { ok: false; erro: 'SEM_OP' | 'FORA_RECEITA' | 'AMBIGUO' } {
  const comFaixa = faixas.filter(
    (f) => f.sn_ini.trim() !== '' && f.sn_fim.trim() !== '' && serieDentroDaFaixa(f.sn_ini, f.sn_fim, sn),
  )
  if (comFaixa.length === 0) return { ok: false, erro: 'SEM_OP' }
  const naReceita = comFaixa.filter((f) => receitaPermite(receita, f.pmo))
  if (naReceita.length === 0) return { ok: false, erro: 'FORA_RECEITA' }
  if (naReceita.length > 1) return { ok: false, erro: 'AMBIGUO' }
  return { ok: true, pmo: naReceita[0]!.pmo, op: naReceita[0]!.op }
}
