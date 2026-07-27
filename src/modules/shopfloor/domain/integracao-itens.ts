import { normalizarSerie } from './serie'

export interface PlacaIntegracao {
  pmo: string
  op: string
  sn: string
}

/**
 * Valida a lista de placas da integração. Linha **totalmente vazia** é ignorada
 * (permite linha em branco no fim), mas linha **iniciada** (qualquer campo preenchido)
 * precisa estar COMPLETA — PMO + OP + SN — senão barra (não deixa integrar pela metade).
 * Também barra SN repetido (normalizado) e o produto aparecendo como placa.
 */
export function validarItensIntegracao(
  produtoSn: string,
  placas: PlacaIntegracao[],
): { ok: true; placas: PlacaIntegracao[] } | { ok: false; erro: string } {
  const naoVazias = placas.filter(
    (x) => x.pmo.trim() !== '' || x.op.trim() !== '' || x.sn.trim() !== '',
  )
  if (naoVazias.length === 0) {
    return { ok: false, erro: 'Informe ao menos 1 placa com Nº de Série.' }
  }
  const produtoNorm = normalizarSerie(produtoSn)
  const vistos = new Set<string>()
  for (let i = 0; i < naoVazias.length; i++) {
    const placa = naoVazias[i]!
    if (placa.pmo.trim() === '' || placa.op.trim() === '') {
      return { ok: false, erro: `Selecione PMO e OP na placa ${i + 1}.` }
    }
    if (placa.sn.trim() === '') {
      return { ok: false, erro: `Bipe o Nº de Série da placa ${i + 1}.` }
    }
    const n = normalizarSerie(placa.sn)
    if (n === produtoNorm) {
      return { ok: false, erro: `A placa ${i + 1} tem o mesmo Nº de Série do produto final.` }
    }
    if (vistos.has(n)) {
      return { ok: false, erro: `Nº de Série de placa repetido (placa ${i + 1}).` }
    }
    vistos.add(n)
  }
  return { ok: true, placas: naoVazias }
}
