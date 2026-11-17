/** As permissões que têm coluna `pode_*` no perfil (as de antes do controle por módulo). */
export type PermissaoLegada =
  | 'visualizar'
  | 'importar'
  | 'editar'
  | 'finalizar'
  | 'editar_finalizado'
  | 'excluir'
  | 'gerar_etiqueta'
  | 'administrar'
  | 'lancar'

/**
 * Só existem por módulo — não têm coluna `pode_*`: `baixar` (Faturamento: baixa de NF no Compels),
 * `registrar_entrada`, `aprovar_nf` e `associar_os` (SAT: entrada de equipamento, aprovação da NF de entrada e
 * troca da OS do relógio).
 */
export type Permissao = PermissaoLegada | 'baixar' | 'registrar_entrada' | 'aprovar_nf' | 'associar_os'

export type Modulo = 'recebimento' | 'shopfloor' | 'setup' | 'sistema' | 'vitrine' | 'faturamento' | 'sat'

export interface Perfil {
  id: string
  nome: string
  permissoes: Record<PermissaoLegada, boolean>       // OR global (compat)
  porModulo: Record<Modulo, Partial<Record<Permissao, boolean>>>
  sistema: boolean
}

export function podeFazer(perfil: Perfil | null, acao: PermissaoLegada): boolean {
  if (!perfil) return false
  return perfil.permissoes[acao] === true
}

export function podeNoModulo(perfil: Perfil | null, modulo: Modulo, acao: Permissao): boolean {
  if (!perfil) return false
  return perfil.porModulo[modulo]?.[acao] === true
}
