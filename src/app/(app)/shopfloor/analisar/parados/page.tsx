import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { lerRelatorioParados } from '@/modules/alertas/infra/relatorio-parados-repository'
import { tituloParado } from '@/modules/alertas/domain/parados-texto'
import { ParadosRelatorio } from './parados-relatorio'

export const dynamic = 'force-dynamic'

const formatadorHora = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

/**
 * "Peças paradas" de UMA regra do alerta "Parado ou travado na produção". Aberta pelo link da mensagem
 * (sem item de menu): o estado de AGORA, com os mesmos critérios da regra, e os números de série por OP.
 */
export default async function ParadosPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>
}) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver as peças paradas." />
  }

  const bruto = (await searchParams).regra
  const regraId = (Array.isArray(bruto) ? bruto[0] : bruto)?.trim() ?? ''
  const leitura = await lerRelatorioParados(regraId)

  if (!leitura.ok) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-tinta">Peças paradas</h2>
        <p className="text-sm text-muted-foreground">
          Regra não encontrada. Ela pode ter sido excluída, ou o link está incompleto.
        </p>
      </div>
    )
  }

  const { regra, relatorio, agora } = leitura
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-tinta">Peças paradas</h2>
        <p className="text-base font-medium text-tinta">
          {relatorio.ops.length === 0
            ? 'Nenhuma peça parada agora.'
            : tituloParado(relatorio.totalPecas, relatorio.ops.length, regra.limiteHoras, relatorio.expediente)}
        </p>
        <p className="text-sm text-muted-foreground">
          Regra: {regra.nome} · postos: {regra.postos.join(', ') || '—'}
          {regra.pmos.length > 0 ? ` · PMOs: ${regra.pmos.join(', ')}` : ''}
          {regra.soOpsAtivas ? ' · só OPs ativas' : ' · inclui OPs finalizadas'}
          {regra.incluirManutencao ? ' · inclui reprovadas aguardando conserto' : ''}
          {regra.ativa ? '' : ' · regra desativada'}
        </p>
        <p className="text-xs text-muted-foreground">
          Situação de agora ({formatadorHora.format(agora)}), calculada com os critérios da regra
          {relatorio.expediente ? ' em horas de expediente' : ''}. A mensagem do alerta é uma foto do momento em que saiu.
        </p>
      </div>
      <ParadosRelatorio ops={relatorio.ops} expediente={relatorio.expediente} />
    </div>
  )
}
