'use client'

import { Card, CardContent } from '@/components/ui/card'
import {
  EXPLICA,
  formatarNumero,
  formatarPercentual,
  percentual,
  textoRodape,
  type Sinal,
  type TotaisDashboard,
} from '@/modules/recebimento/domain/dashboard'
import {
  EXPLICA_METRICAS,
  taxaPorItem,
  type MetricasDashboard,
} from '@/modules/recebimento/domain/dashboard-metricas'
import { Explica } from './explica'

type TotaisQualidade = MetricasDashboard['qualidade']['totais']

/**
 * Os números grandes e o rodapé da contagem. A taxa de reprovação vem das métricas (outra
 * consulta): sem ela (ausente ou falhou), a fileira fica só com os três de divergência.
 */
export function CartoesDashboard({ totais, sinal, reprovacao }: {
  totais: TotaisDashboard; sinal: Sinal | ''; reprovacao?: TotaisQualidade | null
}) {
  const sufixo = sinal === 'positiva' ? ' (só positivas)' : sinal === 'negativa' ? ' (só negativas)' : ''
  return (
    <div className="flex flex-col gap-2">
      <div className={`grid gap-3 ${reprovacao ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'}`}>
        <Cartao rotulo="Itens" valor={formatarNumero(totais.itens)} explica={EXPLICA.itens} />
        <Cartao
          rotulo={`Com divergência${sufixo}`}
          valor={formatarNumero(totais.comDivergencia)}
          detalhe={`${formatarPercentual(percentual(totais.comDivergencia, totais.itens))} dos itens`}
          explica={EXPLICA.comDivergencia}
        />
        <Cartao
          rotulo={`Sem justificativa${sufixo}`}
          valor={formatarNumero(totais.semJustificativa)}
          detalhe={`de ${formatarNumero(totais.comDivergencia)} com divergência`}
          explica={EXPLICA.semJustificativa}
        />
        {reprovacao && (
          <Cartao
            rotulo="Taxa de reprovação"
            valor={formatarPercentual(taxaPorItem(reprovacao.reprovados, reprovacao.comResultado))}
            detalhe={`${formatarNumero(reprovacao.reprovados)} de ${formatarNumero(reprovacao.comResultado)} itens com resultado`}
            detalhe2={`${formatarNumero(reprovacao.pecasReprovadas)} de ${formatarNumero(reprovacao.pecasRecebidas)} peças reprovadas`}
            explica={EXPLICA_METRICAS.reprovacao}
          />
        )}
      </div>
      {/* Frase corrida num <p> comum: com flex, cada pedaço de texto viraria um item e a quebra de
          linha cairia no meio da frase. */}
      <p className="text-xs text-muted-foreground">
        <span data-testid="rodape-contagem">{textoRodape(totais)}</span>{' '}
        <Explica texto={EXPLICA.embs} rotulo="O que conta como EMB" />
      </p>
    </div>
  )
}

function Cartao({ rotulo, valor, detalhe, detalhe2, explica }: {
  rotulo: string; valor: string; detalhe?: string; detalhe2?: string; explica: string
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-4">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-muted-foreground">{rotulo}</p>
          <Explica texto={explica} />
        </div>
        <p className="text-3xl font-bold tabular-nums text-foreground">{valor}</p>
        {detalhe && <p className="text-xs text-muted-foreground">{detalhe}</p>}
        {detalhe2 && <p className="text-xs text-muted-foreground">{detalhe2}</p>}
      </CardContent>
    </Card>
  )
}
