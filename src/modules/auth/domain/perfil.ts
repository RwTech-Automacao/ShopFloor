export type Permissao =
  | 'visualizar'
  | 'importar'
  | 'editar'
  | 'finalizar'
  | 'editar_finalizado'
  | 'excluir'
  | 'gerar_etiqueta'
  | 'administrar'
  | 'lancar'

export type Modulo = 'recebimento' | 'shopfloor' | 'sistema'

export interface Perfil {
  id: string
  nome: string
  permissoes: Record<Permissao, boolean>       // OR global (compat)
  porModulo: Record<Modulo, Partial<Record<Permissao, boolean>>>
  sistema: boolean
}

export function podeFazer(perfil: Perfil | null, acao: Permissao): boolean {
  if (!perfil) return false
  return perfil.permissoes[acao] === true
}

export function podeNoModulo(perfil: Perfil | null, modulo: Modulo, acao: Permissao): boolean {
  if (!perfil) return false
  return perfil.porModulo[modulo]?.[acao] === true
}
