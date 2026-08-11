import { faixaCoerente } from './serie'
import { totalFaixaSNs } from './grade'

export interface DadosOrdemValidacao {
  pmo: string
  op: string
  cliente: string
  snIni: string
  snFim: string
  qtd: number | null
}

/** Validação de cadastro de OP. A faixa de SN é obrigatória e deve ser coerente, e (se houver qtd) bater com ela. */
export function validarOrdem(d: DadosOrdemValidacao): { ok: true } | { ok: false; erro: string } {
  if (d.pmo.trim() === '') return { ok: false, erro: 'Informe o PMO.' }
  if (d.op.trim() === '') return { ok: false, erro: 'Informe o número da OP.' }
  if (d.cliente.trim() === '') return { ok: false, erro: 'Informe o cliente.' }
  if (d.snIni.trim() === '' || d.snFim.trim() === '') {
    return { ok: false, erro: 'Preencha o início e o fim da faixa de SN.' }
  }
  if (!faixaCoerente(d.snIni, d.snFim)) {
    return {
      ok: false,
      erro: 'Faixa de SN inválida: início e fim devem ter o mesmo formato, e o início não pode ser maior que o fim.',
    }
  }
  // Quantidade × faixa: a faixa (fim − início + 1) tem que bater com a qtd informada.
  // Pega faixa mal digitada (ex.: um dígito a mais no fim) e qtd errada.
  if (d.qtd !== null) {
    const t = totalFaixaSNs(d.snIni, d.snFim)
    if (t.ok && t.total !== d.qtd) {
      return {
        ok: false,
        erro: `A quantidade (${d.qtd}) não bate com a faixa de Nº de Série (${t.total} números). Confira o SN inicial/final e a quantidade.`,
      }
    }
  }
  return { ok: true }
}
