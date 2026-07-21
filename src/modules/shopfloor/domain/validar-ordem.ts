export interface DadosOrdemValidacao {
  pmo: string
  op: string
  cliente: string
  snIni: string
  snFim: string
}

/** Validação de cadastro de OP. A faixa de SN é opcional, mas se preenchida exige os dois limites. */
export function validarOrdem(d: DadosOrdemValidacao): { ok: true } | { ok: false; erro: string } {
  if (d.pmo.trim() === '') return { ok: false, erro: 'Informe o PMO.' }
  if (d.op.trim() === '') return { ok: false, erro: 'Informe o número da OP.' }
  if (d.cliente.trim() === '') return { ok: false, erro: 'Informe o cliente.' }
  const temIni = d.snIni.trim() !== ''
  const temFim = d.snFim.trim() !== ''
  if (temIni !== temFim) {
    return { ok: false, erro: 'Preencha o início e o fim da faixa de SN, ou deixe ambos vazios.' }
  }
  return { ok: true }
}
