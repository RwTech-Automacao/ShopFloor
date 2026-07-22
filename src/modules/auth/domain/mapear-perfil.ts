import type { Perfil } from './perfil'

export interface PerfilRow {
  id: string
  nome: string
  pode_visualizar: boolean
  pode_importar: boolean
  pode_editar: boolean
  pode_finalizar: boolean
  pode_editar_finalizado: boolean
  pode_excluir: boolean
  pode_gerar_etiqueta: boolean
  pode_administrar: boolean
  pode_lancar: boolean
  sistema: boolean
}

export function mapearPerfil(row: PerfilRow): Perfil {
  return {
    id: row.id,
    nome: row.nome,
    sistema: row.sistema,
    permissoes: {
      visualizar: row.pode_visualizar,
      importar: row.pode_importar,
      editar: row.pode_editar,
      finalizar: row.pode_finalizar,
      editar_finalizado: row.pode_editar_finalizado,
      excluir: row.pode_excluir,
      gerar_etiqueta: row.pode_gerar_etiqueta,
      administrar: row.pode_administrar,
      lancar: row.pode_lancar,
    },
  }
}
