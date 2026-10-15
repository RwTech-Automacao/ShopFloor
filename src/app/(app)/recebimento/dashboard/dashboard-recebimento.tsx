'use client'

import { useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  urlDosFiltros,
  type DadosDashboard,
  type FiltrosDashboard,
  type OpcoesDashboard,
} from '@/modules/recebimento/domain/dashboard'
import { CartoesDashboard } from './cartoes-dashboard'
import { FiltrosDashboardBarra } from './filtros-dashboard'

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
          {/* Os três gráficos entram aqui (Task 5). */}
        </div>
      )}
    </div>
  )
}
