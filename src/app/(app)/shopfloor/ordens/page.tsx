import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarOrdens, listarPostos, listarFluxos } from '@/modules/shopfloor/infra/ordem-repository'
import { OrdemForm, type OrdemView } from './ordem-form'
import { OrdensLista } from './ordens-lista'

export default async function OrdensPage() {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return <SemPermissao descricao="Você não tem permissão para gerenciar ordens de produção." />
  }

  const [ordens, postos, fluxos] = await Promise.all([listarOrdens(), listarPostos(), listarFluxos()])
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
    componentes: o.sf_ordem_componentes.map((c) => c.pmo_componente),
  }))
  const pmosExistentes = [...new Set(ordens.map((o) => o.pmo))].sort()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-tinta">Ordens de Produção</h2>
          <p className="text-sm text-muted-foreground">{views.length} OP(s) cadastrada(s)</p>
        </div>
        <OrdemForm postos={chavesPostos} fluxosExistentes={fluxos} pmosExistentes={pmosExistentes} />
      </div>

      <OrdensLista views={views} chavesPostos={chavesPostos} fluxos={fluxos} pmosExistentes={pmosExistentes} />
    </div>
  )
}
