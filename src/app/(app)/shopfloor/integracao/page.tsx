import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarOrdensParaLancamento } from '@/modules/shopfloor/infra/lancamento-repository'
import { IntegracaoForm } from './integracao-form'

export default async function IntegracaoPage() {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'lancar')) {
    return <SemPermissao descricao="Você não tem permissão para acessar a Integração." />
  }

  const ordens = await listarOrdensParaLancamento()
  const podeCancelar = podeFazer(sessao.perfil, 'administrar')

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
