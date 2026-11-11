import { faixaCoerente } from './serie'
import { totalFaixaSNs } from './grade'
import { faixasSobrepoem, type FaixaSN } from './faixas-sn'

export interface DadosOrdemValidacao {
  pmo: string
  op: string
  cliente: string
  snIni: string
  snFim: string
  qtd: number | null
  /** Placas que cada bipe de painel conta (0161). Ausente = 1. */
  placasPorPainel?: number
  /**
   * Faixas de SN da OP (0181). Presente, é ELA que vale (snIni/snFim são ignorados); ausente, a faixa
   * única de snIni/snFim. Regra: cada faixa coerente, nenhuma sobrepondo outra, soma = quantidade.
   */
  faixas?: FaixaSN[]
}

/** Validação de cadastro de OP. As faixas de SN são obrigatórias, coerentes, sem sobreposição e (se houver qtd) somam a quantidade. */
export function validarOrdem(d: DadosOrdemValidacao): { ok: true } | { ok: false; erro: string } {
  const n = d.placasPorPainel ?? 1
  if (!Number.isInteger(n) || n < 1) {
    return { ok: false, erro: 'Placas por painel deve ser um número inteiro maior ou igual a 1.' }
  }
  if (d.pmo.trim() === '') return { ok: false, erro: 'Informe o PMO.' }
  if (d.op.trim() === '') return { ok: false, erro: 'Informe o número da OP.' }
  if (d.cliente.trim() === '') return { ok: false, erro: 'Informe o cliente.' }
  const faixas = d.faixas ?? [{ sn_ini: d.snIni, sn_fim: d.snFim }]
  if (faixas.length === 0) return { ok: false, erro: 'Preencha o início e o fim da faixa de SN.' }
  // Com uma faixa só, as mensagens de sempre; com várias, a faixa é apontada pelo número.
  const varias = faixas.length > 1
  for (let i = 0; i < faixas.length; i++) {
    const f = faixas[i]!
    const qual = varias ? `faixa ${i + 1}` : 'faixa'
    if (f.sn_ini.trim() === '' || f.sn_fim.trim() === '') {
      return { ok: false, erro: `Preencha o início e o fim da ${qual} de SN.` }
    }
    if (!faixaCoerente(f.sn_ini, f.sn_fim)) {
      return {
        ok: false,
        erro: `${varias ? `Faixa ${i + 1}` : 'Faixa'} de SN inválida: início e fim devem ter o mesmo formato, e o início não pode ser maior que o fim.`,
      }
    }
  }
  for (let i = 0; i < faixas.length; i++) {
    for (let j = i + 1; j < faixas.length; j++) {
      if (faixasSobrepoem(faixas[i]!, faixas[j]!)) {
        return { ok: false, erro: `As faixas ${i + 1} e ${j + 1} de SN se sobrepõem.` }
      }
    }
  }
  // Quantidade × faixas: a soma (fim − início + 1 de cada) tem que bater EXATAMENTE com a qtd.
  // Pega faixa mal digitada (ex.: um dígito a mais no fim) e qtd errada. Faixa sem bloco numérico
  // (lexical) não tem como ser contada: aí a conferência não roda, como sempre foi.
  if (d.qtd !== null) {
    let total = 0
    let contavel = true
    for (const f of faixas) {
      const t = totalFaixaSNs(f.sn_ini, f.sn_fim)
      if (!t.ok) { contavel = false; break }
      total += t.total
    }
    // A faixa conta painéis (um SN por painel); a quantidade é em placas.
    const esperado = total * n
    if (contavel && esperado !== d.qtd) {
      const detalhe = n > 1 ? `${total} números × ${n} placas por painel = ${esperado}` : `${total} números`
      return {
        ok: false,
        erro: varias
          ? `A quantidade (${d.qtd}) não bate com as faixas de Nº de Série (${detalhe}). Confira as faixas e a quantidade.`
          : `A quantidade (${d.qtd}) não bate com a faixa de Nº de Série (${detalhe}). Confira o SN inicial/final e a quantidade.`,
      }
    }
  }
  return { ok: true }
}
