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
import { paradoDaUrl, type MetricasDashboard } from '@/modules/recebimento/domain/dashboard-metricas'
import { carregarMetricas } from '@/modules/recebimento/infra/dashboard-metricas-repository'
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
  const params = await searchParams
  const filtros = filtrosDaUrl(params, new Date())
  const paradoDias = paradoDaUrl(params)

  // Sem isto, um erro do banco derrubaria a rota inteira — e o link ficaria quebrado, já que o
  // estado mora na URL. Degrada para a mensagem, com os filtros ainda na tela.
  // Dispara já, em paralelo com o resto; o erro é tratado só mais abaixo (catch próprio).
  const metricasPromise = carregarMetricas(filtros, paradoDias)
  metricasPromise.catch(() => {})
  let dados: DadosDashboard | null = null
  let opcoes: OpcoesDashboard = { fornecedores: [], compradores: [] }
  let erro: string | null = null
  try {
    ;[dados, opcoes] = await Promise.all([carregarDashboard(filtros), carregarOpcoesDashboard()])
  } catch {
    erro = 'Não foi possível carregar o dashboard. Tente de novo ou limpe os filtros.'
  }

  // As métricas falham SEPARADO: se só elas caírem, os blocos antigos continuam e o aviso fica na
  // seção nova. Nunca zeros no lugar de uma falha.
  let metricas: MetricasDashboard | null = null
  let erroMetricas: string | null = null
  try {
    metricas = await metricasPromise
  } catch {
    erroMetricas = 'Não foi possível carregar as métricas. Os números acima continuam valendo.'
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
      <DashboardRecebimento filtros={filtros} dados={dados} opcoes={opcoes} erro={erro}
        metricas={metricas} erroMetricas={erroMetricas} paradoDias={paradoDias} />
    </div>
  )
}
