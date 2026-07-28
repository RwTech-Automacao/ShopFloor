import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { AbasFluxo } from '../abas-fluxo'

const ABAS = [
  { rotulo: 'Lançamento', href: '/shopfloor/operar/lancamento' },
  { rotulo: 'Integração', href: '/shopfloor/operar/integracao' },
  { rotulo: 'Manutenção', href: '/shopfloor/operar/manutencao' },
]

export default async function OperarLayout({ children }: { children: React.ReactNode }) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) {
    return <SemPermissao descricao="Você não tem permissão para operar o Fluxo de Processos." />
  }
  return (
    <div className="flex flex-col">
      <AbasFluxo tabs={ABAS} />
      {children}
    </div>
  )
}
