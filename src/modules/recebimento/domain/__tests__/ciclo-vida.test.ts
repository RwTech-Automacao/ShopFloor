import { describe, it, expect } from 'vitest'
import {
  ehTerminal,
  podePromoverParaConferencia,
  podeFinalizar,
  podeReabrir,
  camposFaltantesFinalizacao,
} from '../ciclo-vida'

describe('ehTerminal', () => {
  it('aberto/em_conferencia não são terminais', () => {
    expect(ehTerminal('aberto')).toBe(false)
    expect(ehTerminal('em_conferencia')).toBe(false)
  })
  it('qualquer outro valor (valor do Resultado) é terminal', () => {
    expect(ehTerminal('Aprovado')).toBe(true)
    expect(ehTerminal('Reprovado')).toBe(true)
    expect(ehTerminal('Aprovado condicional')).toBe(true)
  })
})

describe('transições', () => {
  it('promove só a partir de aberto', () => {
    expect(podePromoverParaConferencia('aberto')).toBe(true)
    expect(podePromoverParaConferencia('em_conferencia')).toBe(false)
    expect(podePromoverParaConferencia('Aprovado')).toBe(false)
  })
  it('finaliza só a partir de em_conferencia', () => {
    expect(podeFinalizar('em_conferencia')).toBe(true)
    expect(podeFinalizar('aberto')).toBe(false)
    expect(podeFinalizar('Aprovado')).toBe(false)
  })
  it('reabre só a partir de um terminal', () => {
    expect(podeReabrir('Aprovado')).toBe(true)
    expect(podeReabrir('Reprovado')).toBe(true)
    expect(podeReabrir('em_conferencia')).toBe(false)
    expect(podeReabrir('aberto')).toBe(false)
  })
})

describe('camposFaltantesFinalizacao', () => {
  it('lista os obrigatórios vazios', () => {
    const campos = [
      { campo: 'resultado', obrigatorioFinalizacao: true },
      { campo: 'observacao', obrigatorioFinalizacao: false },
    ]
    expect(camposFaltantesFinalizacao({ resultado: '', observacao: 'x' }, campos)).toEqual(['resultado'])
    expect(camposFaltantesFinalizacao({ resultado: 'Aprovado' }, campos)).toEqual([])
  })
})
