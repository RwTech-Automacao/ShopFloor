import { listarTodasOrdens } from '@/modules/shopfloor/infra/pesquisa-repository'
import { DashboardForm } from './dashboard-form'

export default async function DashboardPage() {
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
