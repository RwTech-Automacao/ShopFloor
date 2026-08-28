import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarCancelamentos } from '@/modules/shopfloor/infra/cancelamento-repository'
import { CancelamentosTabela } from './cancelamentos-tabela'

export const dynamic = 'force-dynamic'

export default async function CancelamentosPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver os cancelamentos." />
  }

  const linhas = await listarCancelamentos()

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Cancelamentos</h2>
        <p className="text-sm text-muted-foreground">
          {linhas.length} lançamento{linhas.length === 1 ? '' : 's'} cancelado{linhas.length === 1 ? '' : 's'} (auditoria — só leitura).
        </p>
      </div>
      <CancelamentosTabela linhas={linhas} />
    </div>
  )
}
