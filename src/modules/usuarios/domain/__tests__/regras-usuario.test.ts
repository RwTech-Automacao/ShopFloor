import { describe, it, expect } from 'vitest'
import { validarAcaoUsuario } from '../regras-usuario'

describe('validarAcaoUsuario', () => {
  it('bloqueia o usuário de desativar a si mesmo', () => {
    const r = validarAcaoUsuario({
      usuarioAlvoId: 'u1', usuarioLogadoId: 'u1',
      novoAtivo: false, perfilAlvoTemAdministrar: true,
    })
    expect(r.ok).toBe(false)
  })
  it('bloqueia o usuário de rebaixar o próprio perfil (perder administrar)', () => {
    const r = validarAcaoUsuario({
      usuarioAlvoId: 'u1', usuarioLogadoId: 'u1',
      novoAtivo: true, perfilAlvoTemAdministrar: false,
    })
    expect(r.ok).toBe(false)
  })
  it('permite editar outro usuário livremente', () => {
    const r = validarAcaoUsuario({
      usuarioAlvoId: 'u2', usuarioLogadoId: 'u1',
      novoAtivo: false, perfilAlvoTemAdministrar: false,
    })
    expect(r.ok).toBe(true)
  })
})
