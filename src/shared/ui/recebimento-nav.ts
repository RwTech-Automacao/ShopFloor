export interface RecebimentoNavItem {
  chave: string
  rotulo: string
  href: string
}

export const RECEBIMENTO_NAV: RecebimentoNavItem[] = [
  { chave: 'importar', rotulo: 'Importar Planilha', href: '/recebimento/importar' },
  { chave: 'processos', rotulo: 'Processos', href: '/recebimento/processos' },
  { chave: 'importacoes', rotulo: 'Importações', href: '/recebimento/importacoes' },
  { chave: 'etiquetas', rotulo: 'Etiquetas', href: '/recebimento/etiquetas' },
]
