import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarOpsComCaixas } from '@/modules/shopfloor/infra/caixa-repository'
import { CaixasForm } from './caixas-form'

export default async function CaixasPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para consultar caixas." />
  }
  const ops = await listarOpsComCaixas()
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Consultar Caixa</h2>
        <p className="text-sm text-muted-foreground">Escolha a OP para ver as caixas e as peças dentro de cada uma.</p>
      </div>
      <CaixasForm ops={ops} />
    </div>
  )
}
