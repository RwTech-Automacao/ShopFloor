import Link from 'next/link'
import { PlusIcon } from 'lucide-react'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { Button } from '@/components/ui/button'
import { listarValoresStatus } from '@/modules/recebimento/infra/processo-detalhe-repository'
import { listarMesesProcessos } from '@/modules/recebimento/infra/processo-repository'
import { ProcessosFiltros } from './processos-filtros'
import { ProcessosPorMes } from './processos-por-mes'

interface ProcessosPageProps {
  searchParams: Promise<{ busca?: string; status?: string }>
}

export default async function ProcessosPage({ searchParams }: ProcessosPageProps) {
  const sp = await searchParams
  const filtros = { busca: sp.busca || undefined, status: sp.status || undefined }
  const [grupos, statusOpcoes, sessao] = await Promise.all([
    listarMesesProcessos(filtros),
    listarValoresStatus(),
    getSessao(),
  ])
  const podeCriar = podeFazer(sessao?.perfil ?? null, 'editar')

  // Abrem por padrão: "Aguardando chegada" (se existir) + o mês mais recente.
  const abertosInicial: string[] = []
  if (grupos.some((g) => g.chave === 'sem_data')) abertosInicial.push('sem_data')
  const primeiroMes = grupos.find((g) => g.chave !== 'sem_data')
  if (primeiroMes) abertosInicial.push(primeiroMes.chave)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Processos</h1>
        {podeCriar && (
          <Button
            className="bg-enterplak hover:bg-enterplak-700"
            render={<Link href="/recebimento/processos/novo" />}
          >
            <PlusIcon />
            Adicionar processo
          </Button>
        )}
      </div>
      <ProcessosFiltros statusOpcoes={statusOpcoes} />
      <ProcessosPorMes
        key={`${filtros.busca ?? ''}|${filtros.status ?? ''}`}
        grupos={grupos}
        filtros={filtros}
        abertosInicial={abertosInicial}
      />
    </div>
  )
}
