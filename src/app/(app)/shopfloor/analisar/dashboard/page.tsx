import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarTodasOrdens } from '@/modules/shopfloor/infra/pesquisa-repository'
import { listarPostos } from '@/modules/shopfloor/infra/postos-repository'
import { listarColaboradoresDashboard } from '@/modules/shopfloor/infra/dashboard-repository'
import { DashboardAbas } from './dashboard-abas'

export default async function DashboardPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para acessar o Dashboard." />
  }
  // Em paralelo: a lista de OPs alimenta os filtros e a de postos define a ORDEM das colunas.
  // Colaboradores falhando (ex.: ambiente sem a 0101) não derruba a página — o filtro só fica vazio,
  // e a própria aba Geral mostra o erro da migração.
  const [ordens, postos, colaboradores] = await Promise.all([
    listarTodasOrdens(),
    listarPostos(),
    listarColaboradoresDashboard().catch(() => [] as string[]),
  ])
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Dashboard</h2>
        <p className="text-sm text-muted-foreground">Produção por OP e por posto.</p>
      </div>
      <DashboardAbas ordens={ordens} postos={postos} colaboradores={colaboradores} />
    </div>
  )
}
