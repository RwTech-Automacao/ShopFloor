import { podeFazer, type Perfil, type Permissao } from '@/modules/auth/domain/perfil'

export interface NavItem {
  chave: string
  rotulo: string
  href: string
  permissao: Permissao
}

export const NAV_ITENS: NavItem[] = [
  { chave: 'home', rotulo: 'Home', href: '/home', permissao: 'visualizar' },
  { chave: 'recebimento', rotulo: 'Recebimento', href: '/recebimento/processos', permissao: 'visualizar' },
  { chave: 'configuracoes', rotulo: 'Configurações', href: '/configuracoes/usuarios', permissao: 'administrar' },
]

export function itensVisiveis(itens: NavItem[], perfil: Perfil | null): NavItem[] {
  return itens.filter((i) => podeFazer(perfil, i.permissao))
}
