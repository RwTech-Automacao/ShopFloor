import { describe, it, expect } from 'vitest'
import { mapearPerfil } from '../../domain/mapear-perfil'
import { podeNoModulo } from '../../domain/perfil'

describe('mapearPerfil', () => {
  it('converte a linha do banco no tipo de domínio', () => {
    const perfil = mapearPerfil({
      id: 'p1',
      nome: 'Recebimento',
      pode_visualizar: true,
      pode_importar: true,
      pode_editar: true,
      pode_finalizar: true,
      pode_editar_finalizado: false,
      pode_excluir: false,
      pode_gerar_etiqueta: true,
      pode_administrar: false,
      pode_lancar: false,
      sistema: true,
    })
    expect(perfil.nome).toBe('Recebimento')
    expect(perfil.permissoes.visualizar).toBe(true)
    expect(perfil.permissoes.importar).toBe(true)
    expect(perfil.permissoes.editar).toBe(true)
    expect(perfil.permissoes.finalizar).toBe(true)
    expect(perfil.permissoes.editar_finalizado).toBe(false)
    expect(perfil.permissoes.excluir).toBe(false)
    expect(perfil.permissoes.gerar_etiqueta).toBe(true)
    expect(perfil.permissoes.administrar).toBe(false)
  })

  it('sem perfil_permissao, porModulo fica vazio para os 3 módulos', () => {
    const perfil = mapearPerfil({
      id: 'p1',
      nome: 'Recebimento',
      pode_visualizar: true,
      pode_importar: true,
      pode_editar: true,
      pode_finalizar: true,
      pode_editar_finalizado: false,
      pode_excluir: false,
      pode_gerar_etiqueta: true,
      pode_administrar: false,
      pode_lancar: false,
      sistema: true,
    })
    expect(perfil.porModulo).toEqual({ recebimento: {}, shopfloor: {}, sistema: {} })
    expect(podeNoModulo(perfil, 'recebimento', 'visualizar')).toBe(false)
  })

  it('grants de perfil_permissao alimentam porModulo por módulo', () => {
    const perfil = mapearPerfil({
      id: 'p2',
      nome: 'Operador ShopFloor',
      pode_visualizar: false,
      pode_importar: false,
      pode_editar: false,
      pode_finalizar: false,
      pode_editar_finalizado: false,
      pode_excluir: false,
      pode_gerar_etiqueta: false,
      pode_administrar: false,
      pode_lancar: false,
      sistema: false,
      perfil_permissao: [
        { modulo: 'shopfloor', permissao: 'visualizar' },
        { modulo: 'shopfloor', permissao: 'lancar' },
        { modulo: 'recebimento', permissao: 'visualizar' },
      ],
    })

    expect(perfil.porModulo.shopfloor.visualizar).toBe(true)
    expect(perfil.porModulo.shopfloor.lancar).toBe(true)
    expect(perfil.porModulo.recebimento.visualizar).toBe(true)
    expect(perfil.porModulo.sistema).toEqual({})
  })

  it('podeNoModulo é true só onde há grant, mesmo com pode_* ligados globalmente', () => {
    const perfil = mapearPerfil({
      id: 'p3',
      nome: 'Operador ShopFloor',
      pode_visualizar: true,
      pode_importar: true,
      pode_editar: true,
      pode_finalizar: true,
      pode_editar_finalizado: true,
      pode_excluir: true,
      pode_gerar_etiqueta: true,
      pode_administrar: true,
      pode_lancar: true,
      sistema: false,
      perfil_permissao: [{ modulo: 'shopfloor', permissao: 'lancar' }],
    })

    expect(podeNoModulo(perfil, 'shopfloor', 'lancar')).toBe(true)
    expect(podeNoModulo(perfil, 'shopfloor', 'visualizar')).toBe(false)
    expect(podeNoModulo(perfil, 'recebimento', 'lancar')).toBe(false)
  })
})
