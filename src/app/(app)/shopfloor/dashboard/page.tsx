import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarTodasOrdens } from '@/modules/shopfloor/infra/pesquisa-repository'
import { DashboardForm } from './dashboard-form'

export default async function DashboardPage() {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para acessar o Dashboard." />
  }
  const ordens = await listarTodasOrdens()
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Dashboard</h2>
        <p className="text-sm text-muted-foreground">Progresso da OP por posto.</p>
      </div>
      <DashboardForm ordens={ordens} />
    </div>
  )
}
