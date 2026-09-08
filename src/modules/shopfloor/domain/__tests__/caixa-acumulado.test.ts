import { describe, expect, it } from 'vitest'
import { pecasAntesDaCaixa } from '../caixa'

const cx = (posto: string, seq: number, qtd: number) => ({ posto, seq, qtd })

describe('pecasAntesDaCaixa', () => {
  it('soma as caixas anteriores do mesmo posto (o caso da folha: caixa 6 começa em 61)', () => {
    const caixas = [1, 2, 3, 4, 5, 6].map((seq) => cx('Embalagem', seq, 12))
    expect(pecasAntesDaCaixa(caixas, { posto: 'Embalagem', seq: 6 })).toBe(60)
  })

  it('a primeira caixa não tem nada antes', () => {
    expect(pecasAntesDaCaixa([cx('Embalagem', 1, 12)], { posto: 'Embalagem', seq: 1 })).toBe(0)
  })

  it('conta cada posto separado', () => {
    const caixas = [cx('Embalagem', 1, 10), cx('Embalagem', 2, 10), cx('Embalagem 2', 1, 99)]
    expect(pecasAntesDaCaixa(caixas, { posto: 'Embalagem', seq: 2 })).toBe(10)
    expect(pecasAntesDaCaixa(caixas, { posto: 'Embalagem 2', seq: 1 })).toBe(0)
  })

  it('aceita caixas de tamanhos diferentes e sequência com furo', () => {
    const caixas = [cx('Embalagem', 1, 12), cx('Embalagem', 2, 7), cx('Embalagem', 4, 5)]
    expect(pecasAntesDaCaixa(caixas, { posto: 'Embalagem', seq: 4 })).toBe(19)
  })
})
