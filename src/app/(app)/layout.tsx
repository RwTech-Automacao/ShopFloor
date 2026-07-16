import { redirect } from 'next/navigation'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { AppShell } from '@/shared/ui/app-shell'
import { modoStorageFotos } from '@/modules/recebimento/infra/armazenamento'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sessao = await getSessao()
  if (!sessao) redirect('/login')

  return (
    <AppShell
      nome={sessao.nome}
      email={sessao.email}
      perfilNome={sessao.perfil.nome}
      permissoes={sessao.perfil.permissoes}
      exportarFotosVisivel={modoStorageFotos() === 'supabase'}
    >
      {children}
    </AppShell>
  )
}
