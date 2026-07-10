import { describe, it, expect } from 'vitest'
import { rotuloStatusProcesso } from '../status-processo'

describe('rotuloStatusProcesso', () => {
  // A regra de negócio é o rótulo em pt-BR. O `className` é detalhe visual, então
  // apenas verificamos que existe (evita acoplar o teste às classes CSS exatas).
  it.each([
    ['aberto', 'Aberto'],
    ['em_conferencia', 'Em conferência'],
    ['finalizado', 'Finalizado'],
    ['cancelado', 'Cancelado'],
  ])('mapeia "%s" para o rótulo "%s" e retorna um className', (status, rotulo) => {
    const info = rotuloStatusProcesso(status)
    expect(info.rotulo).toBe(rotulo)
    expect(info.className).toBeTruthy()
  })

  it('para um status desconhecido, usa o próprio valor como rótulo', () => {
    const info = rotuloStatusProcesso('status_novo')
    expect(info.rotulo).toBe('status_novo')
    expect(info.className).toBeTruthy()
  })
})
