import { describe, it, expect } from 'vitest'
import { mapearPerfil } from '../../domain/mapear-perfil'

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
      sistema: true,
    })
    expect(perfil.nome).toBe('Recebimento')
    expect(perfil.permissoes.finalizar).toBe(true)
    expect(perfil.permissoes.administrar).toBe(false)
  })
})
