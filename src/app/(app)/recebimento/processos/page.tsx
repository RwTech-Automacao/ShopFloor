import { listarMesesProcessos } from '@/modules/recebimento/infra/processo-repository'
import { ProcessosFiltros } from './processos-filtros'
import { ProcessosPorMes } from './processos-por-mes'

interface ProcessosPageProps {
  searchParams: Promise<{ busca?: string; status?: string }>
}

export default async function ProcessosPage({ searchParams }: ProcessosPageProps) {
  const sp = await searchParams
  const filtros = { busca: sp.busca || undefined, status: sp.status || undefined }
  const grupos = await listarMesesProcessos(filtros)

  // Abrem por padrão: "Aguardando chegada" (se existir) + o mês mais recente.
  const abertosInicial: string[] = []
  if (grupos.some((g) => g.chave === 'sem_data')) abertosInicial.push('sem_data')
  const primeiroMes = grupos.find((g) => g.chave !== 'sem_data')
  if (primeiroMes) abertosInicial.push(primeiroMes.chave)

  return (
    <div className="flex flex-col gap-4">
      <ProcessosFiltros />
      <ProcessosPorMes
        key={`${filtros.busca ?? ''}|${filtros.status ?? ''}`}
        grupos={grupos}
        filtros={filtros}
        abertosInicial={abertosInicial}
      />
    </div>
  )
}
