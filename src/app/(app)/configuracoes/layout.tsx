import { redirect } from 'next/navigation'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'

export default async function ConfiguracoesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) redirect('/home')

  // A navegação de Configurações vive no menu lateral (AppShell). Aqui só o guard.
  return <>{children}</>
}
