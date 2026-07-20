import { describe, it, expect } from 'vitest'
import { gerarSenhaTemporaria, validarForcaSenha } from '../senha'

describe('gerarSenhaTemporaria', () => {
  it('tem o tamanho pedido (padrão 10)', () => {
    expect(gerarSenhaTemporaria()).toHaveLength(10)
    expect(gerarSenhaTemporaria(14)).toHaveLength(14)
  })

  it('usa só o alfabeto seguro (sem 0 O 1 l I)', () => {
    const s = gerarSenhaTemporaria(200)
    expect(s).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789]+$/)
  })

  it('duas chamadas diferem (aleatória)', () => {
    expect(gerarSenhaTemporaria()).not.toBe(gerarSenhaTemporaria())
  })
})

describe('validarForcaSenha', () => {
  it('rejeita menos de 8 caracteres', () => {
    expect(validarForcaSenha('1234567').ok).toBe(false)
  })

  it('aceita 8 ou mais', () => {
    expect(validarForcaSenha('12345678')).toEqual({ ok: true })
  })
})
