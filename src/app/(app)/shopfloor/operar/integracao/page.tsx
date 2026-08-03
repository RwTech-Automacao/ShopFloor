import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { ConsultaIntegracaoForm } from './consulta-integracao-form'

export default async function ConsultarIntegracaoPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) {
    return <SemPermissao descricao="Você não tem permissão para consultar integrações." />
  }
  const podeCancelar = podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Consultar Integração</h2>
        <p className="text-sm text-muted-foreground">
          Bipe o Nº de Série de um produto ou de uma placa para ver a integração.
        </p>
      </div>
      <ConsultaIntegracaoForm podeCancelar={podeCancelar} />
    </div>
  )
}
