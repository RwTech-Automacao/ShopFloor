import type { SituacaoNf } from './entrada'

/** Avisos do SAT no canal do Discord: um por nota (spec 2026-11-17-sat-entrada-por-nf-design.md, decisão 9). */
const situacaoNf = (s: SituacaoNf, motivos: string[]) =>
  s === 'aprovada' ? 'aprovada ✅' : `reprovada ❌${motivos.length > 0 ? ` (${motivos.join('; ')})` : ''}`

/** "EMPRESA (cnpj)"; sem empresa, só o CNPJ. */
const quem = (empresa: string, cnpj: string) => {
  const e = (empresa ?? '').trim()
  return e ? `${e} (${cnpj})` : cnpj
}

export function mensagemNota(n: {
  numero: string; empresa: string; cnpj: string; situacao: SituacaoNf; motivos: string[]; ns: string[]
}): string {
  const relogios = `${n.ns.length} ${n.ns.length === 1 ? 'relógio' : 'relógios'}: ${n.ns.join(', ')}`
  return `📦 Chegou no SAT: NF ${n.numero} — ${quem(n.empresa, n.cnpj)} — ${situacaoNf(n.situacao, n.motivos)} — ${relogios}`
}

export function mensagemMudancaNf(m: {
  tipo: 'correcao' | 'troca'; numeroDe: string; numeroPara: string; empresa: string; cnpj: string
  situacaoDe: SituacaoNf; situacaoPara: SituacaoNf; motivos: string[]; ns: string[]
}): string {
  const nova = situacaoNf(m.situacaoPara, m.motivos)
  const relogios = `relógios: ${m.ns.join(', ')}`
  return m.tipo === 'correcao'
    ? `🧾 NF do SAT corrigida: NF ${m.numeroPara} — ${quem(m.empresa, m.cnpj)} — ${m.situacaoDe} → ${nova} — ${relogios}`
    : `🧾 NF do SAT trocada: NF ${m.numeroDe} (${m.situacaoDe}) substituída pela NF ${m.numeroPara} — ` +
      `${quem(m.empresa, m.cnpj)} ${nova} — ${relogios}`
}
