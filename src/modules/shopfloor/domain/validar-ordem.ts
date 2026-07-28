import { faixaCoerente } from './serie'

export interface DadosOrdemValidacao {
  pmo: string
  op: string
  cliente: string
  snIni: string
  snFim: string
}

/** Validação de cadastro de OP. A faixa de SN é obrigatória e deve ser coerente. */
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
  return { ok: true }
}
