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
  it('o Faturamento NÃO liga nenhum pode_* (nem visualizar, nem baixar)', () => {
    const f = flagsLegadas([
      { modulo: 'faturamento', permissao: 'visualizar' },
      { modulo: 'faturamento', permissao: 'baixar' },
    ])
    expect(Object.values(f).every((v) => v === false)).toBe(true)
    expect(Object.keys(f)).not.toContain('pode_baixar')
  })
  it('o SAT NÃO liga nenhum pode_* (visualizar e administrar abririam as tabelas do ShopFloor/Recebimento)', () => {
    const f = flagsLegadas([
      { modulo: 'sat', permissao: 'visualizar' },
      { modulo: 'sat', permissao: 'registrar_entrada' },
      { modulo: 'sat', permissao: 'aprovar_nf' },
      { modulo: 'sat', permissao: 'administrar' },
    ])
    expect(Object.values(f).every((v) => v === false)).toBe(true)
    expect(Object.keys(f)).not.toContain('pode_registrar_entrada')
    expect(Object.keys(f)).not.toContain('pode_aprovar_nf')
  })
  it('administrar no SAT junto com visualizar no ShopFloor liga só pode_visualizar', () => {
    const f = flagsLegadas([
      { modulo: 'sat', permissao: 'administrar' },
      { modulo: 'shopfloor', permissao: 'visualizar' },
    ])
    expect(f.pode_visualizar).toBe(true)
    expect(f.pode_administrar).toBe(false)
  })
})
