import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { lerRelatorioParados, listarRegrasParado } from '@/modules/alertas/infra/relatorio-parados-repository'
import { tituloParado } from '@/modules/alertas/domain/parados-texto'
import { opcoesDoSeletor, regraEscolhida } from '@/modules/alertas/domain/parados-relatorio'
import { ParadosRelatorio } from './parados-relatorio'
import { SeletorRegra } from './seletor-regra'

export const dynamic = 'force-dynamic'

const formatadorHora = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

/**
 * "Peças paradas" de UMA regra do alerta "Parado ou travado na produção": o estado de AGORA, com os mesmos
 * critérios da regra, e os números de série por OP. Abre pelo link da mensagem (`?regra=<id>`) ou pela aba da
 * Análise: sem `?regra=`, abre na primeira regra ativa, e o seletor troca a regra (muda o `?regra=`). O seletor
 * lista só as regras ATIVAS; a regra desativada aberta pelo link de uma mensagem antiga entra nele marcada.
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
  const pedida = (Array.isArray(bruto) ? bruto[0] : bruto) ?? ''
  const regras = await listarRegrasParado()
  const regraId = regraEscolhida(pedida, regras)

  if (regraId === null) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-tinta">Peças paradas</h2>
        <p className="text-sm text-muted-foreground">
          Nenhuma regra ativa do tipo &quot;Parado ou travado na produção&quot;. Este relatório usa os critérios de uma regra
          (postos, PMOs e tempo-limite) — ela é cadastrada em Ajustes ShopFloor › Alertas.
        </p>
      </div>
    )
  }

  const leitura = await lerRelatorioParados(regraId)

  if (!leitura.ok) {
    const opcoes = opcoesDoSeletor(regras, null)
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-tinta">Peças paradas</h2>
          <p className="text-sm text-muted-foreground">
            Regra não encontrada. Ela pode ter sido excluída, ou o link está incompleto.
            {opcoes.length > 0 ? ' Escolha outra regra abaixo.' : ''}
          </p>
        </div>
        {opcoes.length > 0 && <SeletorRegra opcoes={opcoes} atual={regraId} />}
      </div>
    )
  }

  const { regra, relatorio, agora } = leitura
  const opcoes = opcoesDoSeletor(regras, { id: regra.id, nome: regra.nome })
  return (
    <div className="flex flex-col gap-4">
      <SeletorRegra opcoes={opcoes} atual={regra.id} />
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
