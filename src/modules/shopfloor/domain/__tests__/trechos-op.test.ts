import { describe, expect, it } from 'vitest'
import { moldurasDosTrechos, progressoDosTrechos, realceDoTrecho, rotuloTrechoDaOp, type TrechoDaOp } from '../trechos-op'

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

describe('progresso por trecho', () => {
  const postos = new Map([
    ['SPI', { passou: 300, reprovadas: 2 }],
    ['Inspeção AOI TOP', { passou: 152, reprovadas: 1 }],
    ['Teste', { passou: 90, reprovadas: 4 }],
  ])
  it('concluídas no posto que conclui o trecho (do Compels), reprovadas somadas; PMO sem Compels', () => {
    const r = progressoDosTrechos(T, postos, [{ posto: 'Inspeção AOI TOP', codigo: 'PRT410', apontadas: 0, naFila: 152 }], 500)
    expect(r.get(1)).toEqual({ concluidas: 152, quantidade: 500, reprovadas: 3, apontadas: 0, naFila: 152 })
    // PMO: último posto do trecho que está no desenho (o Almoxarifado vive em Finalizadas)
    expect(r.get(2)).toEqual({ concluidas: 90, quantidade: 500, reprovadas: 4, apontadas: null, naFila: null })
  })
  it('sem o resumo do Compels: último posto do trecho e fila zero; OP sem quantidade', () => {
    const r = progressoDosTrechos(T, postos, [], null)
    expect(r.get(1)).toEqual({ concluidas: 152, quantidade: null, reprovadas: 3, apontadas: 0, naFila: 0 })
  })
})

describe('molduras dos trechos', () => {
  const caixas = [
    { id: 'SPI', x: 0, y: 0, largura: 240, altura: 100 },
    { id: 'Inspeção AOI TOP', x: 300, y: 0, largura: 240, altura: 120 },
    { id: 'Teste', x: 0, y: 300 },
    { id: '__saida__', x: 300, y: 300 },
  ]
  it('uma moldura por trecho em volta dos postos dele, com folga e espaço do rótulo', () => {
    const m = moldurasDosTrechos(T, caixas, new Set(['__saida__']))
    expect(m.map((x) => x.rotulo)).toEqual(['PRT410 · OP 8500', 'PMOC14'])
    expect(m[0]).toMatchObject({ seq: 1, x: -20, y: -46, largura: 580, altura: 186 })
    expect(m[1]).toMatchObject({ seq: 2, x: -20, y: 254 }) // sem medida: tamanho padrão do card
  })
  it('com um trecho só não há moldura', () => {
    expect(moldurasDosTrechos(T.slice(0, 1), caixas, new Set())).toEqual([])
  })
})
