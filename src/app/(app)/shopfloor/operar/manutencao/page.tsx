import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarReprovasOrigem, listarReparos } from '@/modules/shopfloor/infra/manutencao-repository'
import { listarDefeitos } from '@/modules/shopfloor/infra/lancamento-repository'
import { listarConsertos } from '@/modules/shopfloor/infra/consertos-repository'
import { agruparPendencias } from '@/modules/shopfloor/domain/manutencao-pendencias'
import { ManutencaoLista } from './manutencao-lista'

export default async function ManutencaoPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) {
    return <SemPermissao descricao="Você não tem permissão para acessar a Manutenção." />
  }
  const [reprovas, reparos, defeitos, consertos] = await Promise.all([
    listarReprovasOrigem(),
    listarReparos(),
    listarDefeitos(),
    listarConsertos(),
  ])
  const ocorrencias = agruparPendencias(reprovas, reparos)
  const defeitosCatalogo = defeitos.map((d) => d.codigo)
  const consertosCatalogo = consertos.map((c) => c.codigo)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Manutenção</h2>
        <p className="text-sm text-muted-foreground">
          Pendências de reparo (reprovas em Teste, Burn-in e Teste Final) e registro de conserto.
        </p>
      </div>
      <ManutencaoLista ocorrencias={ocorrencias} defeitosCatalogo={defeitosCatalogo} consertosCatalogo={consertosCatalogo} />
    </div>
  )
}
