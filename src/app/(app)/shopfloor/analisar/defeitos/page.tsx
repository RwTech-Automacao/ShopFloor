import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarOrdens } from '@/modules/shopfloor/infra/fluxo-repository'
import { DefeitosForm } from './defeitos-form'

export default async function DefeitosPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para consultar defeitos." />
  }
  const ops = await listarOrdens()
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Defeitos da OP</h2>
        <p className="text-sm text-muted-foreground">Escolha a OP para ver os defeitos registrados, do mais recente. Role para carregar mais.</p>
      </div>
      <DefeitosForm ops={ops} />
    </div>
  )
}
