import { serieNasFaixas, type FaixaSN } from './faixas-sn'
import { receitaPermite } from './receita'

export interface FaixaOp {
  pmo: string
  op: string
  sn_ini: string
  sn_fim: string
  /** Todas as faixas da OP (0181); ausente = só sn_ini/sn_fim. */
  faixas?: FaixaSN[]
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
 * As PRTs de série própria da OP do produto (0195), cada uma com as faixas do trecho dela. Um item da receita com o
 * código de uma delas vale SÓ pela regra da PRT: a placa da própria OP (`op`) com o SN numa faixa do trecho. A
 * sf_integrar confere depois se ela terminou o trecho.
 */
export interface PrtsDaOp {
  op: string
  prts: { codigo: string; faixas: FaixaSN[] }[]
}

const chave = (s: string) => s.trim().toLowerCase()

/**
 * Acha a OP/PMO de uma placa pelo SN bipado: dentro de uma faixa da OP E com a PMO na receita do produto.
 * Se mais de uma OP da receita contém o SN → AMBIGUO + a lista de candidatos (o operador escolhe).
 * Com `daOp` (0195): item da receita que é PRT de série própria da OP do produto encaixa a placa com o SN numa faixa
 * do trecho dela, como {pmo: código da PRT, op: a OP do produto}; esse item não vale pela regra da PMO. Receita sem
 * PRT da OP: exatamente o comportamento de antes.
 */
export function resolverPlaca(receita: string[], faixas: FaixaOp[], sn: string, daOp?: PrtsDaOp): ResolucaoPlaca {
  const prtsDaOp = new Set((daOp?.prts ?? []).map((p) => chave(p.codigo)))
  const receitaPrt = receita.filter((c) => prtsDaOp.has(chave(c)))
  if (receitaPrt.length === 0) return resolverPorPmo(receita, faixas, sn)

  const receitaPmo = receita.filter((c) => !prtsDaOp.has(chave(c)))
  const naPrt = daOp!.prts.filter((p) =>
    receitaPrt.some((c) => chave(c) === chave(p.codigo)) && serieNasFaixas({ sn_ini: '', sn_fim: '', faixas: p.faixas }, sn))
  const comFaixa = faixas.filter((f) => serieNasFaixas(f, sn))
  // receita só de PRTs: nenhuma PMO vale (a receita vazia de PMO NÃO libera qualquer uma)
  const naReceita = receitaPmo.length === 0 ? [] : comFaixa.filter((f) => receitaPermite(receitaPmo, f.pmo))
  const candidatos: CandidatoPlaca[] = [
    ...naPrt.map((p) => ({ pmo: p.codigo, op: daOp!.op })),
    ...naReceita.map((f) => ({ pmo: f.pmo, op: f.op })),
  ]
  if (candidatos.length === 0) return { ok: false, erro: naPrt.length === 0 && comFaixa.length === 0 ? 'SEM_OP' : 'FORA_RECEITA' }
  if (candidatos.length > 1) return { ok: false, erro: 'AMBIGUO', candidatos }
  return { ok: true, ...candidatos[0]! }
}

/** A regra de sempre (só PMO). */
function resolverPorPmo(receita: string[], faixas: FaixaOp[], sn: string): ResolucaoPlaca {
  const comFaixa = faixas.filter((f) => serieNasFaixas(f, sn))
  if (comFaixa.length === 0) return { ok: false, erro: 'SEM_OP' }
  const naReceita = comFaixa.filter((f) => receitaPermite(receita, f.pmo))
  if (naReceita.length === 0) return { ok: false, erro: 'FORA_RECEITA' }
  if (naReceita.length > 1) {
    return { ok: false, erro: 'AMBIGUO', candidatos: naReceita.map((f) => ({ pmo: f.pmo, op: f.op })) }
  }
  return { ok: true, pmo: naReceita[0]!.pmo, op: naReceita[0]!.op }
}
