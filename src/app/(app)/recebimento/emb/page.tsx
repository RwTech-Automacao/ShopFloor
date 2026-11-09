import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarValoresDistintos } from '@/modules/recebimento/infra/registros-repository'
import { IrParaEmb } from './ir-para-emb'

export const dynamic = 'force-dynamic'

/**
 * Índice do Relatório de EMB (item do menu do Recebimento): escolhe a EMB — as mesmas do Fluxo — e abre
 * /recebimento/emb/<emb>, a mesma tela do link da mensagem do alerta "Fim de EMB".
 */
export default async function EmbIndicePage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver o relatório da EMB." />
  }

  const embs = await listarValoresDistintos('numero_emb')

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Relatório de EMB</h2>
        <p className="text-sm text-muted-foreground">
          Escolha a EMB para ver o Nº da PO, quando fechou e as divergências de quantidade com a justificativa.
        </p>
      </div>
      <IrParaEmb embs={embs} />
    </div>
  )
}
