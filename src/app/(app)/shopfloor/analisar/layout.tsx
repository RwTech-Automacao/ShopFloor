import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { AbasFluxo } from '../abas-fluxo'

const ABAS = [
  { rotulo: 'Dashboard', href: '/shopfloor/analisar/dashboard' },
  { rotulo: 'Pesquisa', href: '/shopfloor/analisar/pesquisa' },
  { rotulo: 'Burn-in', href: '/shopfloor/analisar/burn-in' },
]

export default async function AnalisarLayout({ children }: { children: React.ReactNode }) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver a Análise do Fluxo de Processos." />
  }
  return (
    <div className="flex flex-col">
      <AbasFluxo tabs={ABAS} />
      {children}
    </div>
  )
}
