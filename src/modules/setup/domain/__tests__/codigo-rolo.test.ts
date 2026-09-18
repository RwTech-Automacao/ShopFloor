import { describe, it, expect } from 'vitest'
import { separarRolo, normalizarTexto } from '../codigo-rolo'

describe('separarRolo', () => {
  it('separa código do ERP e lote/número do rolo no primeiro hífen', () => {
    expect(separarRolo('CAPJ41-8521556004')).toEqual({
      valido: true, prefixo: 'CAPJ41', sequencial: '8521556004', normalizado: 'CAPJ41-8521556004',
    })
  })
  it('aceita outros separadores e normaliza maiúsculas e espaços nas pontas', () => {
    expect(separarRolo('  capj41_00012 ')).toMatchObject({ valido: true, prefixo: 'CAPJ41', sequencial: '00012', normalizado: 'CAPJ41_00012' })
    expect(separarRolo('RESR85 7788')).toMatchObject({ valido: true, prefixo: 'RESR85', sequencial: '7788' })
    expect(separarRolo('LED131/1')).toMatchObject({ valido: true, prefixo: 'LED131' })
    expect(separarRolo('LED131–1')).toMatchObject({ valido: true, prefixo: 'LED131' })
  })
  it('só o primeiro separador divide; o resto fica no sequencial', () => {
    expect(separarRolo('CON578-0061-2626')).toMatchObject({ prefixo: 'CON578', sequencial: '0061-2626' })
  })
  it('é inválido sem separador ou sem sequencial', () => {
    expect(separarRolo('CAPJ41').valido).toBe(false)
    expect(separarRolo('CAPJ41-').valido).toBe(false)
    expect(separarRolo('-123').valido).toBe(false)
    expect(separarRolo('').valido).toBe(false)
  })
})

describe('normalizarTexto', () => {
  it('maiúsculas, sem espaços nas pontas, mantém zeros', () => {
    expect(normalizarTexto('  zsy-008-01 ')).toBe('ZSY-008-01')
    expect(normalizarTexto('01')).toBe('01')
  })
})
