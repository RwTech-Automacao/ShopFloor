'use client'

import { useState, useTransition, type ChangeEvent } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import {
  aplicarClique,
  formatarNumero,
  formatarPercentual,
  percentual,
  rotuloFornecedor,
  type FiltrosDashboard,
} from '@/modules/recebimento/domain/dashboard'
import {
  EXPLICA_METRICAS,
  PARADOS_OPCOES,
  formatarDias,
  taxaPorItem,
  urlDosFiltrosComParado,
  type EstatisticaTempo,
  type MetricasDashboard,
} from '@/modules/recebimento/domain/dashboard-metricas'
import { BarrasRanking, ColunasVolume, FaixasPendencias, type LinhaRanking } from './graficos-metricas'
import { CartaoGrafico } from './graficos-dashboard'
import { Explica } from './explica'

interface SecaoMetricasProps {
  filtros: FiltrosDashboard
  /** null quando só as métricas falharam (aparece `erro`). */
  metricas: MetricasDashboard | null
  erro: string | null
  paradoDias: number
}

/** Fornecedor em branco aparece como "(sem fornecedor)" e não vira filtro. */
function linhaFornecedor(fornecedor: string, valor: number, texto: string, dica: string): LinhaRanking {
  const nome = rotuloFornecedor(fornecedor)
  return {
    chave: fornecedor, rotulo: nome, valor, texto, dica: `${nome}: ${dica}`,
    clicavel: fornecedor.trim() !== '', apagado: fornecedor === '',
  }
}

/**
 * Seção de métricas do dashboard: quatro números e cinco blocos. O estado mora na URL, como no
 * resto da tela: clicar num fornecedor ou material, ou trocar o "X dias", navega e o servidor
 * recalcula.
 */
export function SecaoMetricas({ filtros, metricas, erro, paradoDias }: SecaoMetricasProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [pendente, iniciar] = useTransition()
  const [periodo, setPeriodo] = useState<'semana' | 'mes'>('semana')

  function navegar(novos: FiltrosDashboard, parado: number) {
    const query = urlDosFiltrosComParado(novos, parado, new Date())
    iniciar(() => router.push(query ? `${pathname}?${query}` : pathname))
  }

  if (!metricas) {
    return (
      <section aria-labelledby="titulo-metricas" className="flex min-w-0 flex-col gap-2">
        <h3 id="titulo-metricas" className="text-base font-semibold text-tinta">Métricas</h3>
        <p role="alert" className="text-sm text-destructive">
          {erro ?? 'Não foi possível carregar as métricas.'}
        </p>
      </section>
    )
  }

  const { volume, qualidade, atraso, tempo, pendencias } = metricas
  const pctAtrasados = percentual(atraso.totais.atrasados, atraso.totais.comPrazo)
  const taxa = taxaPorItem(qualidade.totais.reprovados, qualidade.totais.comResultado)
  const parados = tempo.parados.recebimento + tempo.parados.qualidade
  const periodos = periodo === 'semana' ? volume.semanas : volume.meses

  const aoTrocarX = (e: ChangeEvent<HTMLSelectElement>) => navegar(filtros, Number(e.target.value))
  const filtrarFornecedor = (fornecedor: string) => navegar(aplicarClique(filtros, { fornecedor }), paradoDias)
  const filtrarCodigo = (codigo: string) => navegar({ ...filtros, codigo }, paradoDias)

  return (
    <section aria-labelledby="titulo-metricas" className="flex min-w-0 flex-col gap-4">
      <h3 id="titulo-metricas" className="text-base font-semibold text-tinta">Métricas</h3>

      <div className={`flex min-w-0 flex-col gap-4 transition-opacity ${pendente ? 'opacity-60' : ''}`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Numero rotulo="Itens atrasados" valor={formatarPercentual(pctAtrasados)}
            detalhe={`${formatarNumero(atraso.totais.atrasados)} de ${formatarNumero(atraso.totais.comPrazo)} com data prevista`}
            explica={EXPLICA_METRICAS.atrasados} />
          <Numero rotulo="Taxa de reprovação" valor={formatarPercentual(taxa)}
            detalhe={`${formatarNumero(qualidade.totais.reprovados)} de ${formatarNumero(qualidade.totais.comResultado)} itens com resultado`}
            dica={`${formatarNumero(qualidade.totais.pecasReprovadas)} de ${formatarNumero(qualidade.totais.pecasRecebidas)} peças reprovadas`}
            explica={EXPLICA_METRICAS.reprovacao} />
          <Numero rotulo="Mediana na Qualidade" valor={formatarDias(tempo.qualidade.medianaDias)}
            detalhe={`${formatarNumero(tempo.qualidade.n)} itens finalizados`}
            explica={EXPLICA_METRICAS.medianaQualidade} />
          <Numero rotulo={`Parados há mais de ${tempo.parados.dias} dias`} valor={formatarNumero(parados)}
            detalhe={`${formatarNumero(tempo.parados.recebimento)} no Recebimento · ${formatarNumero(tempo.parados.qualidade)} na Qualidade`}
            explica={EXPLICA_METRICAS.parados} />
        </div>

        <CartaoGrafico titulo="Volume de chegadas" explica={EXPLICA_METRICAS.volume}
          acao={
            <div role="group" aria-label="Agrupar volume por" className="inline-flex overflow-hidden rounded-md border border-border text-xs">
              {(['semana', 'mes'] as const).map((p) => (
                <button key={p} type="button" aria-pressed={periodo === p} onClick={() => setPeriodo(p)}
                  className={`px-2.5 py-1 focus-visible:outline-2 focus-visible:outline-ring ${periodo === p ? 'bg-enterplak/10 font-semibold text-foreground dark:bg-enterplak/25' : 'text-muted-foreground hover:bg-muted/60'}`}>
                  {p === 'semana' ? 'Semana' : 'Mês'}
                </button>
              ))}
            </div>
          }>
          <ColunasVolume periodos={periodos} tipo={periodo} />
        </CartaoGrafico>

        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <CartaoGrafico titulo="Qualidade: reprovados por fornecedor" explica={EXPLICA_METRICAS.qualidade}>
            <BarrasRanking rotuloLista="Reprovados por fornecedor" ativo={filtros.fornecedor} onClique={filtrarFornecedor}
              vazio="Nenhum fornecedor com item reprovado neste recorte."
              linhas={qualidade.fornecedores.map((f) => linhaFornecedor(
                f.fornecedor, f.reprovados,
                `de ${formatarNumero(f.comResultado)} · ${formatarPercentual(taxaPorItem(f.reprovados, f.comResultado))}`,
                `${formatarNumero(f.reprovados)} reprovado(s) de ${formatarNumero(f.comResultado)} itens com resultado`,
              ))} />
          </CartaoGrafico>
          <CartaoGrafico titulo="Qualidade: reprovados por material" explica={EXPLICA_METRICAS.qualidade}>
            <BarrasRanking rotuloLista="Reprovados por material" ativo={filtros.codigo} onClique={filtrarCodigo}
              vazio="Nenhum material com item reprovado neste recorte."
              linhas={qualidade.materiais.map((m) => ({
                chave: m.codigo,
                rotulo: m.descricao ? `${m.codigo} · ${m.descricao}` : m.codigo,
                valor: m.reprovados,
                texto: `de ${formatarNumero(m.comResultado)} · ${formatarPercentual(taxaPorItem(m.reprovados, m.comResultado))}`,
                dica: `${m.codigo}${m.descricao ? ` (${m.descricao})` : ''}: ${formatarNumero(m.reprovados)} reprovado(s) de ${formatarNumero(m.comResultado)} itens com resultado`,
              }))} />
          </CartaoGrafico>
        </div>

        <CartaoGrafico titulo="Qualidade: principais motivos de reprovação" explica={EXPLICA_METRICAS.qualidade}>
          <BarrasRanking rotuloLista="Motivos de reprovação" cor="ardosia"
            vazio="Nenhum motivo de reprovação registrado neste recorte."
            linhas={qualidade.motivos.map((m) => ({
              chave: m.motivo, rotulo: m.motivo, valor: m.itens,
              texto: m.itens === 1 ? 'item' : 'itens',
            }))} />
        </CartaoGrafico>

        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <CartaoGrafico titulo="Atraso na chegada" explica={EXPLICA_METRICAS.atraso}>
            <p className="text-sm text-muted-foreground">
              {atraso.totais.comPrazo === 0
                ? 'Nenhum item com data prevista e data de chegada neste recorte.'
                : `${formatarNumero(atraso.totais.atrasados)} de ${formatarNumero(atraso.totais.comPrazo)} itens chegaram depois do prazo. Atraso médio dos atrasados: ${formatarDias(atraso.totais.mediaDiasAtraso)}.`}
            </p>
            <BarrasRanking rotuloLista="Atrasos por fornecedor" ativo={filtros.fornecedor} onClique={filtrarFornecedor}
              cor="ambar" vazio="Nenhum fornecedor com atraso neste recorte."
              linhas={atraso.fornecedores.map((f) => linhaFornecedor(
                f.fornecedor, f.atrasados,
                `de ${formatarNumero(f.comPrazo)} · média ${formatarDias(f.mediaDias)}`,
                `${formatarNumero(f.atrasados)} atrasado(s) de ${formatarNumero(f.comPrazo)}, atraso médio ${formatarDias(f.mediaDias)}`,
              ))} />
          </CartaoGrafico>

          <CartaoGrafico titulo="Tempo nas etapas" explica={EXPLICA_METRICAS.tempo}
            acao={
              <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                Parado há mais de
                <select value={paradoDias} onChange={aoTrocarX}
                  className="rounded-md border border-border bg-background px-1.5 py-1 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                  {PARADOS_OPCOES.map((n) => <option key={n} value={n}>{n} dias</option>)}
                </select>
              </label>
            }>
            <div className="grid gap-3 sm:grid-cols-2">
              <BlocoTempo titulo="Recebimento" t={tempo.recebimento} parados={tempo.parados.recebimento} dias={tempo.parados.dias} />
              <BlocoTempo titulo="Qualidade" t={tempo.qualidade} parados={tempo.parados.qualidade} dias={tempo.parados.dias} />
            </div>
            {tempo.semTempo > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatarNumero(tempo.semTempo)} {tempo.semTempo === 1 ? 'item' : 'itens'} sem registro de entrada na Qualidade ficaram fora do tempo.
              </p>
            )}
          </CartaoGrafico>
        </div>

        <CartaoGrafico titulo="Pendências de chegada" explica={EXPLICA_METRICAS.pendencias}>
          <p className="text-sm text-muted-foreground">
            {formatarNumero(pendencias.total)} {pendencias.total === 1 ? 'item aberto ainda não chegou' : 'itens abertos ainda não chegaram'}.
          </p>
          <FaixasPendencias faixas={pendencias.faixas} />
          <BarrasRanking rotuloLista="Pendências por fornecedor" ativo={filtros.fornecedor} onClique={filtrarFornecedor}
            cor="ambar" vazio="Nenhum fornecedor com pendência atrasada."
            linhas={pendencias.fornecedores.map((f) => linhaFornecedor(
              f.fornecedor, f.atrasados,
              `atrasados, de ${formatarNumero(f.pendentes)} pendentes`,
              `${formatarNumero(f.atrasados)} atrasado(s) de ${formatarNumero(f.pendentes)} pendentes`,
            ))} />
        </CartaoGrafico>
      </div>
    </section>
  )
}

function Numero({ rotulo, valor, detalhe, dica, explica }: {
  rotulo: string; valor: string; detalhe: string; dica?: string; explica: string
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-4" title={dica}>
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-muted-foreground">{rotulo}</p>
          <Explica texto={explica} />
        </div>
        <p className="text-3xl font-bold tabular-nums text-foreground">{valor}</p>
        <p className="text-xs text-muted-foreground">{detalhe}</p>
        {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
      </CardContent>
    </Card>
  )
}

function BlocoTempo({ titulo, t, parados, dias }: {
  titulo: string; t: EstatisticaTempo; parados: number; dias: number
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border p-3">
      <p className="text-sm font-semibold text-foreground">{titulo}</p>
      <p className="text-xs text-muted-foreground">Média: <span className="tabular-nums font-medium text-foreground">{formatarDias(t.mediaDias)}</span></p>
      <p className="text-xs text-muted-foreground">Mediana: <span className="tabular-nums font-medium text-foreground">{formatarDias(t.medianaDias)}</span></p>
      <p className="text-xs text-muted-foreground">{formatarNumero(t.n)} {t.n === 1 ? 'item' : 'itens'} na amostra</p>
      <p className="text-xs text-muted-foreground">
        <span className="tabular-nums font-medium text-foreground">{formatarNumero(parados)}</span> parado(s) há mais de {dias} dias
      </p>
    </div>
  )
}
