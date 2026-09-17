import { describe, it, expect } from 'vitest'
import { MODULOS, PERMISSOES_POR_MODULO } from '../modulos'

describe('MODULOS', () => {
  it('contém os 4 módulos do catálogo', () => {
    const chaves = MODULOS.map((m) => m.chave)
    expect(chaves).toEqual(['recebimento', 'shopfloor', 'setup', 'sistema'])
  })
})

describe('PERMISSOES_POR_MODULO', () => {
  it('shopfloor expõe lancar', () => {
    expect(PERMISSOES_POR_MODULO.shopfloor).toContain('lancar')
  })

  it('setup expõe visualizar, lançar e administrar', () => {
    expect(PERMISSOES_POR_MODULO.setup).toEqual(['visualizar', 'lancar', 'administrar'])
  })

  it('sistema expõe só administrar', () => {
    expect(PERMISSOES_POR_MODULO.sistema).toEqual(['administrar'])
  })

  it('recebimento expõe o conjunto completo de permissões', () => {
    expect(PERMISSOES_POR_MODULO.recebimento).toEqual([
      'visualizar', 'importar', 'editar', 'finalizar',
      'editar_finalizado', 'excluir', 'gerar_etiqueta', 'administrar',
    ])
  })
})
