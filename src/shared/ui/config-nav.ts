export interface ConfigNavItem {
  chave: string
  rotulo: string
  href: string
}

export const CONFIG_NAV: ConfigNavItem[] = [
  { chave: 'usuarios', rotulo: 'Usuários', href: '/configuracoes/usuarios' },
  { chave: 'perfis', rotulo: 'Perfis', href: '/configuracoes/perfis' },
  { chave: 'listas', rotulo: 'Listas Suspensas', href: '/configuracoes/listas' },
  { chave: 'campos', rotulo: 'Campos', href: '/configuracoes/campos' },
  { chave: 'criticidade', rotulo: 'Criticidade por Fornecedor', href: '/configuracoes/criticidade' },
  { chave: 'nqa', rotulo: 'Tabela NQA', href: '/configuracoes/nqa' },
  { chave: 'logs', rotulo: 'Logs do Sistema', href: '/configuracoes/logs' },
  { chave: 'sobre', rotulo: 'Sobre o Sistema', href: '/configuracoes/sobre' },
]
