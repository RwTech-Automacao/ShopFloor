import { describe, it, expect } from 'vitest'
import { rotuloStatusProcesso } from '../status-processo'

describe('rotuloStatusProcesso', () => {
  it('mapeia "aberto" para rótulo e cor neutros', () => {
    expect(rotuloStatusProcesso('aberto')).toEqual({
      rotulo: 'Aberto',
      className: 'bg-gray-100 text-gray-700',
    })
  })

  it('mapeia "em_conferencia" para rótulo e cor âmbar', () => {
    expect(rotuloStatusProcesso('em_conferencia')).toEqual({
      rotulo: 'Em conferência',
      className: 'bg-amber-100 text-amber-800',
    })
  })

  it('mapeia "finalizado" para rótulo e cor verde', () => {
    expect(rotuloStatusProcesso('finalizado')).toEqual({
      rotulo: 'Finalizado',
      className: 'bg-green-100 text-green-800',
    })
  })

  it('mapeia "cancelado" para rótulo e cor vermelha', () => {
    expect(rotuloStatusProcesso('cancelado')).toEqual({
      rotulo: 'Cancelado',
      className: 'bg-red-100 text-red-800',
    })
  })

  it('para um status desconhecido, usa o próprio valor como rótulo e cor neutra', () => {
    expect(rotuloStatusProcesso('status_novo')).toEqual({
      rotulo: 'status_novo',
      className: 'bg-gray-100 text-gray-700',
    })
  })
})
