import { describe, it, expect } from 'vitest'
import { campoCsv } from '../csv'

describe('campoCsv', () => {
  it('neutraliza fórmula no começo do texto', () => {
    expect(campoCsv('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`)
    expect(campoCsv('+1')).toBe("'+1")
    expect(campoCsv('-2')).toBe("'-2")
    expect(campoCsv('@SUM(A1)')).toBe("'@SUM(A1)")
  })

  it('texto comum passa igual; separador, vírgula e aspas vão entre aspas', () => {
    expect(campoCsv('Andreia')).toBe('Andreia')
    expect(campoCsv('a;b')).toBe('"a;b"')
    expect(campoCsv('a,b')).toBe('"a,b"')
    expect(campoCsv('diz "oi"')).toBe('"diz ""oi"""')
  })

  it('número e vazio', () => {
    expect(campoCsv(12)).toBe('12')
    expect(campoCsv(null)).toBe('')
  })
})
