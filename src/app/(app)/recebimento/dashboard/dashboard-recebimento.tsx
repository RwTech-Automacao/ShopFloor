'use client'

import { useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  aplicarClique,
  fimDaSemana,
  urlDosFiltros,
  EXPLICA,
  type DadosDashboard,
  type FiltrosDashboard,
  type OpcoesDashboard,
} from '@/modules/recebimento/domain/dashboard'
import { CartoesDashboard } from './cartoes-dashboard'
import { FiltrosDashboardBarra } from './filtros-dashboard'
import {
  CartaoGrafico,
  GraficoSemanas,
  LegendaSemanas,
  PositivasNegativas,
  RankingFornecedores,
} from './graficos-dashboard'

interface DashboardRecebimentoProps {
  filtros: FiltrosDashboard
  /** null quando o banco falhou (a página mostra `erro`). */
  dados: DadosDashboard | null
  opcoes: OpcoesDashboard
  erro: string | null
}

/**
 * A tela do dashboard. O estado dos filtros mora na URL: aplicar um filtro (pelo formulário, por
 * uma etiqueta ou por um clique num gráfico) é navegar para a URL nova, e o servidor recalcula.
 * Assim o link compartilhado reproduz a tela.
 */
export function DashboardRecebimento({ filtros, dados, opcoes, erro }: DashboardRecebimentoProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [pendente, iniciar] = useTransition()

  function navegar(novos: FiltrosDashboard) {
    const query = urlDosFiltros(novos, new Date())
    iniciar(() => router.push(query ? `${pathname}?${query}` : pathname))
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* key: um clique num gráfico muda a URL, e o formulário tem que nascer de novo com ela. */}
      <FiltrosDashboardBarra key={JSON.stringify(filtros)} filtros={filtros} opcoes={opcoes} onAplicar={navegar} />

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      {dados && (
        // Recalculando: segura a foto anterior esmaecida, sem pular o layout nem piscar em branco.
        <div className={`flex min-w-0 flex-col gap-4 transition-opacity ${pendente ? 'opacity-60' : ''}`}>
          <CartoesDashboard totais={dados.totais} sinal={filtros.sinal} />
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <CartaoGrafico titulo="Ranking por fornecedor" explica={EXPLICA.fornecedores}>
              <RankingFornecedores fornecedores={dados.fornecedores} ativo={filtros.fornecedor}
                onClique={(fornecedor) => navegar(aplicarClique(filtros, { fornecedor }))} />
            </CartaoGrafico>
            <CartaoGrafico titulo="Positivas × negativas" explica={EXPLICA.sinal}>
              <PositivasNegativas positivas={dados.totais.positivas} negativas={dados.totais.negativas}
                ativo={filtros.sinal} onClique={(sinal) => navegar(aplicarClique(filtros, { sinal }))} />
            </CartaoGrafico>
          </div>
          <CartaoGrafico titulo="Divergências por semana" explica={EXPLICA.semanas} acao={<LegendaSemanas />}>
            <GraficoSemanas semanas={dados.semanas}
              ativo={filtros.de !== '' && filtros.ate === fimDaSemana(filtros.de) ? filtros.de : ''}
              onClique={(semana) => navegar(aplicarClique(filtros, { semana }))} />
          </CartaoGrafico>
        </div>
      )}
    </div>
  )
}
