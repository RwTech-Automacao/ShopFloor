import { describe, it, expect } from 'vitest'
import { podeTransicionar, camposFaltantesFinalizacao } from '../ciclo-vida'

describe('podeTransicionar', () => {
  it('aberto → em_conferencia e aberto → cancelado', () => {
    expect(podeTransicionar('aberto', 'em_conferencia')).toBe(true)
    expect(podeTransicionar('aberto', 'cancelado')).toBe(true)
  })
  it('em_conferencia → finalizado e → cancelado', () => {
    expect(podeTransicionar('em_conferencia', 'finalizado')).toBe(true)
    expect(podeTransicionar('em_conferencia', 'cancelado')).toBe(true)
  })
  it('finalizado → em_conferencia (reabrir), mas não → cancelado', () => {
    expect(podeTransicionar('finalizado', 'em_conferencia')).toBe(true)
    expect(podeTransicionar('finalizado', 'cancelado')).toBe(false)
  })
  it('cancelado é terminal', () => {
    expect(podeTransicionar('cancelado', 'em_conferencia')).toBe(false)
  })
  it('aberto → finalizado é inválido (precisa passar por conferência)', () => {
    expect(podeTransicionar('aberto', 'finalizado')).toBe(false)
  })
})

describe('camposFaltantesFinalizacao', () => {
  const campos = [
    { campo: 'numero_nf', obrigatorioFinalizacao: true },
    { campo: 'observacao', obrigatorioFinalizacao: false },
  ]
  it('lista os obrigatórios de finalização vazios', () => {
    expect(camposFaltantesFinalizacao({ numero_nf: '', observacao: 'x' }, campos)).toEqual(['numero_nf'])
  })
  it('vazio quando todos os obrigatórios estão preenchidos', () => {
    expect(camposFaltantesFinalizacao({ numero_nf: '123', observacao: null }, campos)).toEqual([])
  })
})
