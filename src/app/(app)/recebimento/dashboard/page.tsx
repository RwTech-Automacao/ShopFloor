import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import {
  filtrosDaUrl,
  type DadosDashboard,
  type OpcoesDashboard,
} from '@/modules/recebimento/domain/dashboard'
import {
  carregarDashboard,
  carregarOpcoesDashboard,
} from '@/modules/recebimento/infra/dashboard-repository'
import { DashboardRecebimento } from './dashboard-recebimento'

export const dynamic = 'force-dynamic'

interface DashboardPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function DashboardRecebimentoPage({ searchParams }: DashboardPageProps) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver o dashboard do Recebimento." />
  }

  // Estado vem da URL e é validado no domínio (nada dele é confiável). Sem datas na URL = 90 dias.
  const filtros = filtrosDaUrl(await searchParams, new Date())

  // Sem isto, um erro do banco derrubaria a rota inteira — e o link ficaria quebrado, já que o
  // estado mora na URL. Degrada para a mensagem, com os filtros ainda na tela.
  let dados: DadosDashboard | null = null
  let opcoes: OpcoesDashboard = { fornecedores: [], compradores: [] }
  let erro: string | null = null
  try {
    ;[dados, opcoes] = await Promise.all([carregarDashboard(filtros), carregarOpcoesDashboard()])
  } catch {
    erro = 'Não foi possível carregar o dashboard. Tente de novo ou limpe os filtros.'
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Dashboard de divergências</h2>
        <p className="text-sm text-muted-foreground">
          Quanto do que chegou veio com divergência de quantidade, de quem, quando — e quanto ainda
          ninguém explicou. Clique num gráfico para filtrar a tela.
        </p>
      </div>
      <DashboardRecebimento filtros={filtros} dados={dados} opcoes={opcoes} erro={erro} />
    </div>
  )
}
