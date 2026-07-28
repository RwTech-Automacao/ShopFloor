import { listarReprovasOrigem, listarReparos } from '@/modules/shopfloor/infra/manutencao-repository'
import { agruparPendencias } from '@/modules/shopfloor/domain/manutencao-pendencias'
import { ManutencaoLista } from './manutencao-lista'

export default async function ManutencaoPage() {
  const [reprovas, reparos] = await Promise.all([listarReprovasOrigem(), listarReparos()])
  const ocorrencias = agruparPendencias(reprovas, reparos)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Manutenção</h2>
        <p className="text-sm text-muted-foreground">
          Pendências de reparo (reprovas em Teste, Burn-in e Teste Final) e registro de conserto.
        </p>
      </div>
      <ManutencaoLista ocorrencias={ocorrencias} />
    </div>
  )
}
