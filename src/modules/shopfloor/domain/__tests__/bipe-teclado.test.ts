import { describe, expect, it } from 'vitest'
import { codigoConfere } from '../almoxarifado'
import { canonicoDoBipe, resolverCodigoBipado } from '../bipe-teclado'

const CAIXA = 'CX[1][160]8682_F-PMOF52_F'

describe('canonicoDoBipe', () => {
  it('[ ] \\ e ´ viram o mesmo marcador, com o resto em maiúsculas', () => {
    expect(canonicoDoBipe(' cx[1][160]8682_f ')).toBe('CX|1||160|8682_F')
    expect(canonicoDoBipe('CX´1[´160[8682_F')).toBe('CX|1||160|8682_F')
    expect(canonicoDoBipe('CX]1\\]160\\8682_F')).toBe('CX|1||160|8682_F')
  })

  it('desfaz a letra que o acento fundiu (á é í ó ú ý ç)', () => {
    expect(canonicoDoBipe('LOTEá1')).toBe('LOTE|A1')
    expect(canonicoDoBipe('LOTEç1')).toBe('LOTE|C1')
    expect(canonicoDoBipe('LOTEÉ1')).toBe('LOTE|E1')
    expect(canonicoDoBipe('xíyóz')).toBe('X|IY|OZ')
  })
})

describe('codigoConfere com o teclado trocado', () => {
  it('a saída REAL do leitor no ABNT2 (print de 06/11) confere com a caixa', () => {
    expect(codigoConfere('CX´1[´160[8682_F-PMOF52_F', CAIXA)).toBe(true)
  })

  it('o código certo, em maiúsculas, minúsculas ou com espaços, continua conferindo', () => {
    expect(codigoConfere(CAIXA, CAIXA)).toBe(true)
    expect(codigoConfere(` ${CAIXA.toLowerCase()} `, CAIXA)).toBe(true)
  })

  it('um QR compensado para o layout americano, lido por um leitor já em modo Brasil, também confere', () => {
    expect(codigoConfere('CX]1\\]160\\8682_F-PMOF52_F', CAIXA)).toBe(true)
  })

  it('lote com a primeira letra do hash fundida pelo acento confere', () => {
    expect(codigoConfere('LOTEá1b2c3d4[´6[', 'LOTE[a1b2c3d4][6]')).toBe(true)
    expect(codigoConfere('LOTEç1d2e3f4[´6[', 'LOTE[c1d2e3f4][6]')).toBe(true)
  })

  it('a estrutura continua valendo: CX[11][60] NÃO confere com CX[1][160]', () => {
    expect(codigoConfere('CX´11[´60[8682_F-PMOF52_F', CAIXA)).toBe(false)
    expect(codigoConfere('CX[11][60]8682_F-PMOF52_F', CAIXA)).toBe(false)
  })

  it('outra caixa, outra OP ou vazio não conferem', () => {
    expect(codigoConfere('CX´2[´160[8682_F-PMOF52_F', CAIXA)).toBe(false)
    expect(codigoConfere('CX´1[´160[9999_F-PMOF52_F', CAIXA)).toBe(false)
    expect(codigoConfere('', CAIXA)).toBe(false)
  })
})

describe('resolverCodigoBipado', () => {
  const PENDENTES = ['CX[1][160]8682_F-PMOF52_F', 'CX[2][160]8682_F-PMOF52_F']

  it('devolve o código REAL da caixa quando o bipe mal traduzido bate com uma só', () => {
    expect(resolverCodigoBipado('CX´2[´160[8682_F-PMOF52_F', PENDENTES)).toBe('CX[2][160]8682_F-PMOF52_F')
  })

  it('bipe que não é de nenhuma caixa da lista (um Nº de série, por exemplo) sai como veio, sem espaços nas pontas', () => {
    expect(resolverCodigoBipado(' 845801153fnt ', PENDENTES)).toBe('845801153fnt')
    expect(resolverCodigoBipado('CX´9[´160[8682_F-PMOF52_F', PENDENTES)).toBe('CX´9[´160[8682_F-PMOF52_F')
  })

  it('código já certo volta igual', () => {
    expect(resolverCodigoBipado('CX[1][160]8682_F-PMOF52_F', PENDENTES)).toBe('CX[1][160]8682_F-PMOF52_F')
  })

  it('ambíguo (duas caixas com o mesmo canônico) não escolhe nenhuma: sai como veio', () => {
    expect(resolverCodigoBipado('CX´1[´1[1_F', ['CX[1][1]1_F', 'CX]1\\]1\\1_F'])).toBe('CX´1[´1[1_F')
  })

  it('lista vazia: sai como veio', () => {
    expect(resolverCodigoBipado('CX´1[´160[8682_F', [])).toBe('CX´1[´160[8682_F')
  })
})
