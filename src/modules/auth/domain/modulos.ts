import type { Modulo, Permissao } from './perfil'

export const MODULOS: { chave: Modulo; rotulo: string }[] = [
  { chave: 'recebimento', rotulo: 'Recebimento' },
  { chave: 'shopfloor', rotulo: 'Fluxo de Processos' },
  { chave: 'setup', rotulo: 'Setup' },
  { chave: 'sistema', rotulo: 'Sistema' },
  // Vitrine do marketing: o Fluxo da OP com dados fictícios fixos (sem banco). Só se vê, nada se faz.
  { chave: 'vitrine', rotulo: 'Vitrine (marketing)' },
  // Faturamento: baixa de NF de saída no Compels (tela /faturamento/baixa-nf). Não liga flag `pode_*`.
  { chave: 'faturamento', rotulo: 'Faturamento' },
]

/** Permissões que cada módulo expõe (define os accordions e a migração). */
export const PERMISSOES_POR_MODULO: Record<Modulo, Permissao[]> = {
  // `lancar` no Recebimento = dar entrada de produto acabado na tela do Almoxarifado (bipe).
  recebimento: ['visualizar', 'importar', 'editar', 'finalizar', 'editar_finalizado', 'excluir', 'gerar_etiqueta', 'administrar', 'lancar'],
  shopfloor: ['visualizar', 'lancar', 'administrar'],
  setup: ['visualizar', 'lancar', 'administrar'],
  sistema: ['administrar'],
  vitrine: ['visualizar'],
  // `baixar` = selecionar notas, confirmar a baixa e tirar da fila.
  faturamento: ['visualizar', 'baixar'],
}
