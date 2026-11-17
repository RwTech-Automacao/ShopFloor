import { describe, expect, it } from 'vitest'
import { lerCsv } from '../csv'

describe('lerCsv', () => {
  it('campos simples, CRLF e linha final sem quebra', () => {
    expect(lerCsv('a,b,c\r\n1,2,3\n4,,6')).toEqual([['a', 'b', 'c'], ['1', '2', '3'], ['4', '', '6']])
  })

  it('aspas: vírgula, aspas dobradas e quebra de linha dentro do campo', () => {
    expect(lerCsv('"GARANTIA\nSEM GARANTIA","diz ""oi"", tchau",x\n')).toEqual([
      ['GARANTIA\nSEM GARANTIA', 'diz "oi", tchau', 'x'],
    ])
  })

  it('texto vazio = nenhuma linha', () => {
    expect(lerCsv('')).toEqual([])
  })

  it('ignora o BOM do começo', () => {
    expect(lerCsv('﻿a,b')).toEqual([['a', 'b']])
  })
})
