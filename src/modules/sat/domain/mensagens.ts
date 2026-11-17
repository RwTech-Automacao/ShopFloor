import type { SituacaoNf } from './entrada'

/** Avisos do SAT no canal do Discord (spec 2026-11-17-sat-entrada-design.md, decisão 10). */
const situacaoNf = (s: SituacaoNf, motivos: string[]) =>
  s === 'aprovada' ? 'aprovada ✅' : `reprovada ❌${motivos.length > 0 ? ` (${motivos.join('; ')})` : ''}`

const contexto = (cliente: string, os: string) => {
  const partes = [cliente.trim(), os.trim() ? `OS ${os.trim()}` : ''].filter(Boolean)
  return partes.length > 0 ? ` (${partes.join(', ')})` : ''
}

export function mensagemEntrada(e: {
  ns: string; cliente: string; os: string; nf: string; situacao: SituacaoNf; motivos: string[]
}): string {
  return `📦 Chegou no SAT: ${e.ns}${contexto(e.cliente, e.os)} — NF ${e.nf} ${situacaoNf(e.situacao, e.motivos)}`
}

export function mensagemMudancaNf(m: {
  tipo: 'correcao' | 'troca'; ns: string; cliente: string; os: string; nfDe: string; nfPara: string
  situacaoDe: SituacaoNf; situacaoPara: SituacaoNf; motivos: string[]
}): string {
  const cab = `🧾 NF do SAT ${m.tipo === 'correcao' ? 'corrigida' : 'trocada'}: ${m.ns}${contexto(m.cliente, m.os)}`
  const nova = situacaoNf(m.situacaoPara, m.motivos)
  return m.tipo === 'correcao'
    ? `${cab} — NF ${m.nfPara} ${m.situacaoDe} → ${nova}`
    : `${cab} — NF ${m.nfDe} (${m.situacaoDe}) substituída pela NF ${m.nfPara} ${nova}`
}
