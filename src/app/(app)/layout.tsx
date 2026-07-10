import { redirect } from 'next/navigation'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { AppShell } from '@/shared/ui/app-shell'
import { NAV_ITENS, itensVisiveis } from '@/shared/ui/nav-config'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sessao = await getSessao()
  if (!sessao) redirect('/login')

  const chavesVisiveis = itensVisiveis(NAV_ITENS, sessao.perfil).map((i) => i.chave)

  return (
    <AppShell
      nome={sessao.nome}
      email={sessao.email}
      perfilNome={sessao.perfil.nome}
      chavesVisiveis={chavesVisiveis}
    >
      {children}
    </AppShell>
  )
}
