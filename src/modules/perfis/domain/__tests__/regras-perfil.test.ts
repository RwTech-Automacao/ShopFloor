import { describe, it, expect } from 'vitest'
import { validarEdicaoPerfil, flagsLegadas } from '../regras-perfil'

describe('validarEdicaoPerfil', () => {
  it('bloqueia remover administrar do próprio perfil', () => {
    const r = validarEdicaoPerfil({
      perfilAlvoId: 'p1',
      perfilDoUsuarioId: 'p1',
      administrarNasNovasFlags: false,
    })
    expect(r.ok).toBe(false)
  })
  it('permite editar outro perfil sem administrar', () => {
    const r = validarEdicaoPerfil({
      perfilAlvoId: 'p2',
      perfilDoUsuarioId: 'p1',
      administrarNasNovasFlags: false,
    })
    expect(r.ok).toBe(true)
  })
  it('permite manter administrar no próprio perfil', () => {
    const r = validarEdicaoPerfil({
      perfilAlvoId: 'p1',
      perfilDoUsuarioId: 'p1',
      administrarNasNovasFlags: true,
    })
    expect(r.ok).toBe(true)
  })
})

describe('flagsLegadas', () => {
  it('visualizar em um módulo de negócio liga pode_visualizar', () => {
    expect(flagsLegadas([{ modulo: 'shopfloor', permissao: 'visualizar' }]).pode_visualizar).toBe(true)
  })
  it('a Vitrine NÃO liga pode_visualizar (o perfil do marketing não lê o banco)', () => {
    const f = flagsLegadas([{ modulo: 'vitrine', permissao: 'visualizar' }])
    expect(Object.values(f).every((v) => v === false)).toBe(true)
  })
})
