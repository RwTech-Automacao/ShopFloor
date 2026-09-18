import { redirect } from 'next/navigation'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'

export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'setup', 'visualizar')) redirect('/home')
  return <>{children}</>
}
