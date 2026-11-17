import { describe, expect, it } from 'vitest'
import { chaveDoNs, normalizarNs, nsDaCelula } from '../numero-serie'

describe('normalizarNs', () => {
  it('17 dígitos (00043 + modelo + sequência), como o repinmetro', () => {
    expect(normalizarNs('00043005620019177')).toEqual({ escrito: '00043005620019177', modelo: '562', sequencia: '19177' })
    expect(normalizarNs('00043005620008006')).toEqual({ escrito: '00043005620008006', modelo: '562', sequencia: '8006' })
  })

  it('compacto sem os zeros (43 + modelo de 5 + sequência)', () => {
    expect(normalizarNs('430056219725')).toMatchObject({ modelo: '562', sequencia: '19725' })
    expect(normalizarNs('43005620019725')).toMatchObject({ modelo: '562', sequencia: '19725' })
  })

  it('modelo e sequência separados por traço (com ou sem espaço)', () => {
    expect(normalizarNs('562 -19177')).toEqual({ escrito: '562 -19177', modelo: '562', sequencia: '19177' })
    expect(normalizarNs('562-15382')).toMatchObject({ modelo: '562', sequencia: '15382' })
    expect(normalizarNs('00562 - 0018276')).toMatchObject({ modelo: '562', sequencia: '18276' })
  })

  it('só a sequência (sem o prefixo 43): sem modelo', () => {
    expect(normalizarNs('0019177')).toEqual({ escrito: '0019177', modelo: null, sequencia: '19177' })
  })

  it('ilegível não tem par', () => {
    expect(normalizarNs('-')).toEqual({ escrito: '-', modelo: null, sequencia: null })
    expect(normalizarNs('')).toEqual({ escrito: '', modelo: null, sequencia: null })
    expect(normalizarNs('sem etiqueta')).toEqual({ escrito: 'sem etiqueta', modelo: null, sequencia: null })
    expect(normalizarNs('000')).toEqual({ escrito: '000', modelo: null, sequencia: null })
  })

  it('apara espaços do que foi escrito', () => {
    expect(normalizarNs('  562-15382 \n')).toMatchObject({ escrito: '562-15382', modelo: '562' })
  })
})

describe('modelo e sequência separados por espaço ou ponto (visto na planilha real)', () => {
  it('"562 19177" e "562.19177" são um NS só, modelo 562 / sequência 19177', () => {
    expect(normalizarNs('562 19177')).toEqual({ escrito: '562 19177', modelo: '562', sequencia: '19177' })
    expect(normalizarNs('562.19177')).toEqual({ escrito: '562.19177', modelo: '562', sequencia: '19177' })
    expect(nsDaCelula('562 19177')).toEqual(['562 19177'])
    expect(nsDaCelula('562.19177 562-15382')).toEqual(['562.19177', '562-15382'])
  })

  it('duas sequências soltas separadas por espaço continuam sendo dois NS', () => {
    expect(nsDaCelula('19177 19725')).toEqual(['19177', '19725'])
  })
})

describe('nsDaCelula', () => {
  it('vários NS numa célula (espaço, quebra de linha, vírgula, ponto e vírgula)', () => {
    expect(nsDaCelula('00043005620019177 00043005620019178\n430056219725; 562-15382, 562 -19177'))
      .toEqual(['00043005620019177', '00043005620019178', '430056219725', '562-15382', '562 -19177'])
  })

  it('descarta rótulos sem dígito quando há NS na célula', () => {
    expect(nsDaCelula('NS: 562-15382 e 562-15383')).toEqual(['562-15382', '562-15383'])
  })

  it('célula só com texto ou traço vira um NS ilegível (a linha é gravada assim mesmo)', () => {
    expect(nsDaCelula('-')).toEqual(['-'])
    expect(nsDaCelula('não informado')).toEqual(['não informado'])
  })

  it('célula vazia: nenhum NS', () => {
    expect(nsDaCelula('')).toEqual([])
    expect(nsDaCelula('  \n ')).toEqual([])
  })
})

describe('chaveDoNs', () => {
  it('o par quando há modelo; a sequência sozinha; senão o texto', () => {
    expect(chaveDoNs(normalizarNs('00043005620019177'))).toBe('562/19177')
    expect(chaveDoNs(normalizarNs('562 -19177'))).toBe('562/19177')
    expect(chaveDoNs(normalizarNs('0019177'))).toBe('seq:19177')
    expect(chaveDoNs(normalizarNs(' - '))).toBe('txt:-')
    expect(chaveDoNs(normalizarNs(''))).toBe('txt:')
  })
})
