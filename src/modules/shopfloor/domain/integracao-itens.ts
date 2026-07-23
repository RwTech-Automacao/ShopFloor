import { normalizarSerie } from './serie'

export interface PlacaIntegracao {
  pmo: string
  op: string
  sn: string
}

/**
 * Valida a lista de placas da integração: considera só linhas com SN; cada uma
 * exige PMO/OP; barra SN repetido (normalizado) e o produto aparecendo como placa.
 */
export function validarItensIntegracao(
  produtoSn: string,
  placas: PlacaIntegracao[],
): { ok: true; placas: PlacaIntegracao[] } | { ok: false; erro: string } {
  const preenchidas = placas.filter((x) => x.sn.trim() !== '')
  if (preenchidas.length === 0) {
    return { ok: false, erro: 'Informe ao menos 1 placa com Nº de Série.' }
  }
  const produtoNorm = normalizarSerie(produtoSn)
  const vistos = new Set<string>()
  for (let i = 0; i < preenchidas.length; i++) {
    const placa = preenchidas[i]!
    if (placa.pmo.trim() === '' || placa.op.trim() === '') {
      return { ok: false, erro: `Selecione PMO e OP na placa ${i + 1}.` }
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
  return { ok: true, placas: preenchidas }
}
