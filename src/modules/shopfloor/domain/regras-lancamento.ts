export interface DadosLancamento {
  colaborador?: string
  posto?: string
  pmo?: string
  op?: string
  numeroSerie?: string
  status?: string
  numeroCaixa?: string
  limiteCaixa?: string
  nqaVisual?: string
  nqaFuncional?: string
  cod?: string
  pos?: string
  tipo?: string
}

export type ResultadoRegra = { ok: true } | { ok: false; erro: string }

const vazio = (v: string | undefined) => !v || String(v).trim() === ''

/** Obrigatórios por posto — portado do Código.gs `_enviarFormularioComContagem_`. */
export function obrigatoriosPorPosto(posto: string, d: DadosLancamento): ResultadoRegra {
  const p = (posto || '').toLowerCase()
  const base = !vazio(d.colaborador) && !vazio(d.pmo) && !vazio(d.op) && !vazio(d.numeroSerie)

  if (p === 'inicial' || p === 'montagem pth') {
    return base ? { ok: true } : { ok: false, erro: 'Preencha Colaborador, PMO, OP e Nº de Série.' }
  }
  if (p === 'embalagem') {
    return base && !vazio(d.numeroCaixa) && !vazio(d.limiteCaixa)
      ? { ok: true }
      : { ok: false, erro: 'Para Embalagem, preencha Colaborador, PMO, OP, Nº da Caixa, QTD por caixa e Nº de Série.' }
  }
  if (p === 'inspeção nqa') {
    return base && !vazio(d.nqaVisual) && !vazio(d.nqaFuncional)
      ? { ok: true }
      : { ok: false, erro: 'Para Inspeção NQA, preencha Nº de Série, Inspeção Visual e Funcional.' }
  }
  if (p === 'inspeção spi') {
    if (!base || vazio(d.status)) return { ok: false, erro: 'Para Inspeção SPI, preencha Nº de Série e Status.' }
    if (d.status!.toLowerCase() === 'reprovado' && vazio(d.pos)) {
      return { ok: false, erro: 'Para Inspeção SPI reprovada, informe ao menos uma posição.' }
    }
    return { ok: true }
  }
  // Demais postos
  if (!base || vazio(d.status)) return { ok: false, erro: 'Preencha Colaborador, PMO, OP, Nº de Série e Status.' }
  if (d.status!.toLowerCase() === 'reprovado' && (vazio(d.cod) || vazio(d.pos) || vazio(d.tipo))) {
    return { ok: false, erro: 'Para reprovado, preencha código, posição e tipo do defeito.' }
  }
  return { ok: true }
}

/** A caixa está cheia? (count = peças já na caixa; limite null = sem limite). */
export function caixaCheia(count: number, limite: number | null): boolean {
  if (limite === null || Number.isNaN(limite)) return false
  return count >= limite
}
