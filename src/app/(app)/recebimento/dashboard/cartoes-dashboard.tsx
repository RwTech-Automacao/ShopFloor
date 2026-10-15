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
import { Explica } from './explica'

/** Os três números grandes e o rodapé da contagem. */
export function CartoesDashboard({ totais, sinal }: { totais: TotaisDashboard; sinal: Sinal | '' }) {
  const sufixo = sinal === 'positiva' ? ' (só positivas)' : sinal === 'negativa' ? ' (só negativas)' : ''
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3 sm:grid-cols-3">
        <Cartao rotulo="Itens" valor={totais.itens} explica={EXPLICA.itens} />
        <Cartao
          rotulo={`Com divergência${sufixo}`}
          valor={totais.comDivergencia}
          detalhe={`${formatarPercentual(percentual(totais.comDivergencia, totais.itens))} dos itens`}
          explica={EXPLICA.comDivergencia}
        />
        <Cartao
          rotulo="Sem justificativa"
          valor={totais.semJustificativa}
          detalhe={`de ${formatarNumero(totais.comDivergencia)} com divergência`}
          explica={EXPLICA.semJustificativa}
        />
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

function Cartao({ rotulo, valor, detalhe, explica }: {
  rotulo: string; valor: number; detalhe?: string; explica: string
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-4">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-muted-foreground">{rotulo}</p>
          <Explica texto={explica} />
        </div>
        <p className="text-3xl font-bold tabular-nums text-foreground">{formatarNumero(valor)}</p>
        {detalhe && <p className="text-xs text-muted-foreground">{detalhe}</p>}
      </CardContent>
    </Card>
  )
}
