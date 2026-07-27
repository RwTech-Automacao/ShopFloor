import type { Modulo, Permissao } from './perfil'

export const MODULOS: { chave: Modulo; rotulo: string }[] = [
  { chave: 'recebimento', rotulo: 'Recebimento' },
  { chave: 'shopfloor', rotulo: 'Fluxo de Processos' },
  { chave: 'sistema', rotulo: 'Sistema' },
]

/** Permissões que cada módulo expõe (define os accordions e a migração). */
export const PERMISSOES_POR_MODULO: Record<Modulo, Permissao[]> = {
  recebimento: ['visualizar', 'importar', 'editar', 'finalizar', 'editar_finalizado', 'excluir', 'gerar_etiqueta', 'administrar'],
  shopfloor: ['visualizar', 'lancar', 'administrar'],
  sistema: ['administrar'],
}
