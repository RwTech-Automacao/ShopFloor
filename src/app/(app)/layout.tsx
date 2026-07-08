import { redirect } from 'next/navigation'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { Sidebar } from '@/shared/ui/sidebar'
import { UserMenu } from '@/shared/ui/user-menu'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sessao = await getSessao()
  if (!sessao) redirect('/login')

  return (
    <div className="flex min-h-screen">
      <Sidebar perfil={sessao.perfil} />
      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-end border-b bg-white px-6">
          <UserMenu nome={sessao.nome} perfil={sessao.perfil.nome} />
        </header>
        <main className="flex-1 bg-gray-50 p-8">{children}</main>
      </div>
    </div>
  )
}
