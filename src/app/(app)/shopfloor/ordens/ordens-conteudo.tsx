import { listarOrdens, listarPostos } from '@/modules/shopfloor/infra/ordem-repository'
import { mapaPostoPerfil } from '@/modules/shopfloor/infra/postos-repository'
import { listarPadroes } from '@/modules/shopfloor/infra/padroes-fluxo-repository'
import { agruparReceitaPorPosto } from '@/modules/shopfloor/domain/receita-posto'
import { agruparTempoBurninPorPosto } from '@/modules/shopfloor/domain/burnin-posto'
import { faixasDaPmoDoBanco } from '@/modules/shopfloor/domain/faixas-sn'
import type { OrdemView } from './ordem-form'
import { OrdensLista } from './ordens-lista'

/** PRTs da OP da mãe para as filhas: o trecho de maior seq vem primeiro (a PMO é o último trecho e fica de fora). */
function prtsDaCadeia(trechos: { seq: number; tipo: string; codigo?: string; compels_op?: string | null }[] | null | undefined) {
  return (trechos ?? [])
    .filter((t) => t.tipo === 'prt')
    .sort((a, b) => b.seq - a.seq)
    .map((t) => ({ codigo: t.codigo ?? '', compelsOp: t.compels_op ?? null }))
}

/**
 * Lista de OPs de /shopfloor/ordens-nova: "Nova OP" leva ao cadastro em passos e, com `editarTrechosBase`, a OP com
 * trechos é editada em `${editarTrechosBase}/<id>` (a sem trechos, no modal). A permissão é checada por quem chama.
 */
export async function OrdensConteudo({ editarTrechosBase, cadeiaPrt }: { editarTrechosBase?: string; cadeiaPrt?: boolean }) {
  const [ordens, postos, padroes, postosPerfil] = await Promise.all([listarOrdens(), listarPostos(), listarPadroes(), mapaPostoPerfil()])
  const chavesPostos = postos.map((p) => p.chave).filter((c) => c !== 'Manutenção')
  const views: OrdemView[] = ordens.map((o) => ({
    id: o.id,
    pmo: o.pmo,
    op: o.op,
    cliente: o.cliente,
    qtd: o.qtd,
    descricao: o.descricao,
    acp: o.acp,
    status: o.status,
    sn_ini: o.sn_ini,
    sn_fim: o.sn_fim,
    faixas: faixasDaPmoDoBanco(o.sf_ordem_faixas, o.sf_ordem_trechos),
    embalagem_individual: o.embalagem_individual,
    placas_por_painel: o.placas_por_painel,
    postos: [...o.sf_ordem_postos].sort((a, b) => a.ordem - b.ordem).map((x) => x.posto),
    receitaPorPosto: agruparReceitaPorPosto(o.sf_ordem_componentes),
    tempoBurninPorPosto: agruparTempoBurninPorPosto(o.sf_ordem_burnin),
    temTrechos: (o.sf_ordem_trechos?.length ?? 0) > 0,
    ...(cadeiaPrt ? { prts: prtsDaCadeia(o.sf_ordem_trechos) } : {}),
  }))
  const pmosExistentes = [...new Set(ordens.map((o) => o.pmo))].sort()
  const clientesExistentes = [...new Set(ordens.map((o) => o.cliente))].filter((c) => c.trim() !== '').sort()

  // Cliente + descrição da OP MAIS RECENTE de cada PMO (pra auto-preencher no form).
  const maisRecentePorPmo: Record<string, string> = {}
  const dadosPorPmo: Record<string, { cliente: string; descricao: string }> = {}
  for (const o of ordens) {
    if (!maisRecentePorPmo[o.pmo] || o.created_at > maisRecentePorPmo[o.pmo]!) {
      maisRecentePorPmo[o.pmo] = o.created_at
      dadosPorPmo[o.pmo] = { cliente: o.cliente, descricao: o.descricao }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Ordens de Produção</h2>
        <p className="text-sm text-muted-foreground">{views.length} OP(s) cadastrada(s)</p>
      </div>

      <OrdensLista cadeiaPrt={cadeiaPrt} editarTrechosBase={editarTrechosBase} views={views} chavesPostos={chavesPostos} postosPerfil={postosPerfil} padroes={padroes} pmosExistentes={pmosExistentes} clientesExistentes={clientesExistentes} dadosPorPmo={dadosPorPmo} />
    </div>
  )
}
