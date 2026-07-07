export type Permissao =
  | 'visualizar'
  | 'importar'
  | 'editar'
  | 'finalizar'
  | 'editar_finalizado'
  | 'excluir'
  | 'gerar_etiqueta'
  | 'administrar'

export interface Perfil {
  id: string
  nome: string
  permissoes: Record<Permissao, boolean>
  sistema: boolean
}

export function podeFazer(perfil: Perfil | null, acao: Permissao): boolean {
  if (!perfil) return false
  return perfil.permissoes[acao] === true
}
