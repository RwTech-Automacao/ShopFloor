import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarValoresDistintos } from '@/modules/recebimento/infra/registros-repository'
import { FluxoForm } from './fluxo-form'

export const dynamic = 'force-dynamic'

export default async function FluxoRecebimentoPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver o fluxo do Recebimento." />
  }

  const embs = await listarValoresDistintos('numero_emb')

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Fluxo do Recebimento</h2>
        <p className="text-sm text-muted-foreground">
          Escolha a EMB para ver onde estão os itens dela e há quanto tempo estão parados.
        </p>
      </div>
      <FluxoForm embs={embs} />
    </div>
  )
}
