import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarOrdens, listarPostos } from '@/modules/shopfloor/infra/ordem-repository'
import { mapaPostoPerfil } from '@/modules/shopfloor/infra/postos-repository'
import { listarPadroes } from '@/modules/shopfloor/infra/padroes-fluxo-repository'
import { agruparReceitaPorPosto } from '@/modules/shopfloor/domain/receita-posto'
import { agruparTempoBurninPorPosto } from '@/modules/shopfloor/domain/burnin-posto'
import { OrdemForm, type OrdemView } from './ordem-form'
import { OrdensLista } from './ordens-lista'

export default async function OrdensPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return <SemPermissao descricao="Você não tem permissão para gerenciar ordens de produção." />
  }

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
    postos: [...o.sf_ordem_postos].sort((a, b) => a.ordem - b.ordem).map((x) => x.posto),
    receitaPorPosto: agruparReceitaPorPosto(o.sf_ordem_componentes),
    tempoBurninPorPosto: agruparTempoBurninPorPosto(o.sf_ordem_burnin),
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
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-tinta">Ordens de Produção</h2>
          <p className="text-sm text-muted-foreground">{views.length} OP(s) cadastrada(s)</p>
        </div>
        <OrdemForm postos={chavesPostos} postosPerfil={postosPerfil} padroesExistentes={padroes} pmosExistentes={pmosExistentes} clientesExistentes={clientesExistentes} dadosPorPmo={dadosPorPmo} />
      </div>

      <OrdensLista views={views} chavesPostos={chavesPostos} postosPerfil={postosPerfil} padroes={padroes} pmosExistentes={pmosExistentes} clientesExistentes={clientesExistentes} dadosPorPmo={dadosPorPmo} />
    </div>
  )
}
