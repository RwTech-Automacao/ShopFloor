import { listarOrdensParaLancamento, listarDefeitos } from '@/modules/shopfloor/infra/lancamento-repository'
import { LancamentoForm } from './lancamento-form'

export default async function LancamentoPage() {
  const [ordens, defeitos] = await Promise.all([listarOrdensParaLancamento(), listarDefeitos()])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Lançamento</h2>
        <p className="text-sm text-muted-foreground">Registro de peças por posto.</p>
      </div>
      <LancamentoForm ordens={ordens} defeitos={defeitos} />
    </div>
  )
}
