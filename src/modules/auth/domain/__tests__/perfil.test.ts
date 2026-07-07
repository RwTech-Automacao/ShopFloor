import { describe, it, expect } from 'vitest'
import { podeFazer, type Perfil } from '../perfil'

const consulta: Perfil = {
  id: '1',
  nome: 'Consulta',
  sistema: true,
  permissoes: {
    visualizar: true, importar: false, editar: false, finalizar: false,
    editar_finalizado: false, excluir: false, gerar_etiqueta: false, administrar: false,
  },
}

describe('podeFazer', () => {
  it('retorna true para permissão concedida', () => {
    expect(podeFazer(consulta, 'visualizar')).toBe(true)
  })
  it('retorna false para permissão negada', () => {
    expect(podeFazer(consulta, 'importar')).toBe(false)
  })
  it('retorna false quando o perfil é nulo', () => {
    expect(podeFazer(null, 'visualizar')).toBe(false)
  })
})
