import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { listarOrdensParaIntegracao } from '@/modules/shopfloor/infra/lancamento-repository'
import { IntegracaoForm } from './integracao-form'

export default async function IntegracaoPage() {
  const sessao = await getSessao()
  if (!sessao) return null
  const ordens = await listarOrdensParaIntegracao()
  const podeCancelar = podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Integração de Placas</h2>
        <p className="text-sm text-muted-foreground">Vincula o produto final às placas que o compõem.</p>
      </div>
      <IntegracaoForm ordens={ordens} podeCancelar={podeCancelar} />
    </div>
  )
}
