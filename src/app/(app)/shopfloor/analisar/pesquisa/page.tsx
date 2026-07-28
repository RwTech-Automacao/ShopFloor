import { listarTodasOrdens } from '@/modules/shopfloor/infra/pesquisa-repository'
import { PesquisaForm } from './pesquisa-form'

export default async function PesquisaPage() {
  const ordens = await listarTodasOrdens()
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Pesquisa</h2>
        <p className="text-sm text-muted-foreground">Histórico por Nº de Série e Grade Geral da OP.</p>
      </div>
      <PesquisaForm ordens={ordens} />
    </div>
  )
}
