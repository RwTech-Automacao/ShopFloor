import { describe, expect, it } from 'vitest'
import { realceDoTrecho, rotuloTrechoDaOp, type TrechoDaOp } from '../trechos-op'

const T: TrechoDaOp[] = [
  { seq: 1, codigo: 'PRT410', tipo: 'prt', compelsOp: '8500', postos: ['SPI', 'Inspeção AOI TOP'] },
  { seq: 2, codigo: 'PMOC14', tipo: 'pmo', compelsOp: null, postos: ['Teste', 'Almoxarifado'] },
]

describe('trechos da OP no Fluxo', () => {
  it('rótulo com a OP do Compels quando há', () => {
    expect(T.map(rotuloTrechoDaOp)).toEqual(['PRT410 (8500)', 'PMOC14'])
  })
  it('realce: os postos do trecho; Todos (null) ou trecho inexistente = sem realce', () => {
    expect(realceDoTrecho(T, 1)).toEqual(new Set(['SPI', 'Inspeção AOI TOP']))
    expect(realceDoTrecho(T, null)).toBeNull()
    expect(realceDoTrecho(T, 9)).toBeNull()
  })
})
