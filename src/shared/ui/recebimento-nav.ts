import { podeFazer, type Perfil, type Permissao } from '@/modules/auth/domain/perfil'

export interface RecebimentoNavItem {
  chave: string
  rotulo: string
  href: string
  permissao: Permissao
}

export const RECEBIMENTO_NAV: RecebimentoNavItem[] = [
  { chave: 'importar', rotulo: 'Importar Planilha', href: '/recebimento/importar', permissao: 'importar' },
  { chave: 'processos', rotulo: 'Processos', href: '/recebimento/processos', permissao: 'visualizar' },
  { chave: 'importacoes', rotulo: 'Importações', href: '/recebimento/importacoes', permissao: 'visualizar' },
  { chave: 'etiquetas', rotulo: 'Etiquetas', href: '/recebimento/etiquetas', permissao: 'gerar_etiqueta' },
  { chave: 'exportar-fotos', rotulo: 'Exportar Fotos', href: '/recebimento/exportar-fotos', permissao: 'administrar' },
]

/** Sub-itens do Recebimento visíveis para o perfil (esconde o que ele não pode usar). */
export function itensRecebimentoVisiveis(
  itens: RecebimentoNavItem[],
  perfil: Perfil | null,
): RecebimentoNavItem[] {
  return itens.filter((i) => podeFazer(perfil, i.permissao))
}
