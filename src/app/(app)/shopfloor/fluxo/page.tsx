import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarOrdens } from '@/modules/shopfloor/infra/fluxo-repository'
import { listarTodasOrdens } from '@/modules/shopfloor/infra/pesquisa-repository'
import { FluxoForm } from './fluxo-form'

export default async function FluxoPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver o fluxo das OPs." />
  }
  const [ops, ordensDashboard] = await Promise.all([listarOrdens(), listarTodasOrdens()])
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Fluxo da OP</h2>
        <p className="text-sm text-muted-foreground">Escolha a OP para ver o fluxo de postos e onde as peças estão.</p>
      </div>
      <FluxoForm ops={ops} ordensDashboard={ordensDashboard} />
    </div>
  )
}
