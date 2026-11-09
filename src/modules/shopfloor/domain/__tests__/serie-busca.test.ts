import { describe, expect, it } from 'vitest'
import { limparSerieParaBusca, serieContem } from '../serie'

// O SN é gravado SEM separadores ("0845801001 FNT" vira "0845801001FNT"); a busca tem de ignorar os mesmos.
const GRAVADO = '0845801001FNT'

describe('serieContem', () => {
  it('acha com o espaço que vem na etiqueta', () => {
    expect(serieContem(GRAVADO, '0845801001 FNT')).toBe(true)
  })

  it('ignora traço, ponto e maiúsculas/minúsculas', () => {
    expect(serieContem(GRAVADO, '0845801001-fnt')).toBe(true)
    expect(serieContem(GRAVADO, '0845.801001 fnt')).toBe(true)
  })

  it('aceita pedaço do SN (com ou sem o zero à esquerda)', () => {
    expect(serieContem(GRAVADO, '801001')).toBe(true)
    expect(serieContem(GRAVADO, '845801001 FNT')).toBe(true)
    expect(serieContem(GRAVADO, 'fnt')).toBe(true)
  })

  it('não acha o que não está lá', () => {
    expect(serieContem(GRAVADO, '0845801002 FNT')).toBe(false)
  })

  it('busca vazia ou só com separadores não filtra nada', () => {
    expect(serieContem(GRAVADO, '')).toBe(true)
    expect(serieContem(GRAVADO, '   ')).toBe(true)
    expect(serieContem(GRAVADO, ' - ')).toBe(true)
  })
})

describe('limparSerieParaBusca', () => {
  it('tira tudo que não é letra ou número e deixa minúsculo', () => {
    expect(limparSerieParaBusca(' 0845801001 FNT ')).toBe('0845801001fnt')
    expect(limparSerieParaBusca('A-1.b 2')).toBe('a1b2')
  })
})
