import { describe, it, expect } from 'vitest'
import { validarEdicaoPerfil } from '../regras-perfil'

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
