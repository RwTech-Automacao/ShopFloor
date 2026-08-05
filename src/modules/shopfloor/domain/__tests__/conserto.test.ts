import { describe, it, expect } from 'vitest'
import { normalizarCodigoConserto, validarConserto } from '../conserto'

describe('normalizarCodigoConserto', () => {
  it('trim + colapsa espaços + MAIÚSCULAS', () => {
    expect(normalizarCodigoConserto('  2001   ressolda  de   componente ')).toBe('2001 RESSOLDA DE COMPONENTE')
  })
})

describe('validarConserto', () => {
  it('vazio → erro', () => {
    expect(validarConserto({ codigo: '   ' })).toEqual({ ok: false, erro: 'Informe o código do conserto.' })
  })
  it('ok → normaliza', () => {
    expect(validarConserto({ codigo: '2001 ressolda' })).toEqual({ ok: true, valor: { codigo: '2001 RESSOLDA' } })
  })
})
