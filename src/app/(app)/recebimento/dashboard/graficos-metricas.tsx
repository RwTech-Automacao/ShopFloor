'use client'

import { useEffect, useRef } from 'react'
import { diaBr, formatarNumero } from '@/modules/recebimento/domain/dashboard'
import {
  faixasPendencias,
  type FaixasPendencias,
  type PeriodoVolume,
} from '@/modules/recebimento/domain/dashboard-metricas'

// Cores das MARCAS (barras), com par claro/escuro. Texto nunca usa estas cores.
// Mesmas famílias do graficos-dashboard.tsx: vinho da marca, ardósia, âmbar.
const COR = {
  vinho: 'bg-[#8D2033] dark:bg-[#d2566c]',
  ardosia: 'bg-[#64748b] dark:bg-[#94a3b8]',
  ambar: 'bg-[#b45309] dark:bg-[#f59e0b]',
  azul: 'bg-[#1d4ed8] dark:bg-[#60a5fa]',
} as const
export type CorBarra = keyof typeof COR

const LINHA = 'grid w-full grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] items-center gap-3 rounded px-1 py-0.5 text-left text-sm'
const LINHA_CLICAVEL = 'hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring'
const LINHA_ATIVA = 'bg-enterplak/10 dark:bg-enterplak/25'

export interface LinhaRanking {
  /** Identifica a linha (e é o que `ativo` compara e `onClique` devolve). */
  chave: string
  rotulo: string
  valor: number
  /** Texto à direita, sob o número (ex.: "3 de 20 · 15%"). */
  texto: string
  /** Dica completa (title). */
  dica?: string
  /** false = a linha não vira filtro (ex.: fornecedor em branco). Padrão: true quando há onClique. */
  clicavel?: boolean
  /** Rótulo em itálico/apagado (ex.: "(sem fornecedor)"). */
  apagado?: boolean
}

/**
 * Ranking em barras horizontais (HTML), escala = valor ÷ o maior. Mesmo molde do
 * RankingFornecedores. Sem `onClique`, as linhas são só leitura.
 */
export function BarrasRanking({ linhas, ativo = '', onClique, vazio, cor = 'vinho', rotuloLista }: {
  linhas: LinhaRanking[]
  ativo?: string
  onClique?: (chave: string) => void
  vazio: string
  cor?: CorBarra
  rotuloLista?: string
}) {
  if (linhas.length === 0) return <p className="text-sm text-muted-foreground">{vazio}</p>
  const maior = Math.max(...linhas.map((l) => l.valor), 1)
  return (
    <ul className="flex flex-col gap-0.5" aria-label={rotuloLista}>
      {linhas.map((l) => {
        const conteudo = (
          <>
            <span className={`truncate ${l.apagado ? 'italic text-muted-foreground' : 'text-foreground'}`} title={l.rotulo}>{l.rotulo}</span>
            <div className="h-3.5 min-w-0">
              {l.valor > 0 && (
                <div className={`h-full rounded-r-[4px] ${COR[cor]}`} style={{ width: `max(2px, ${(l.valor / maior) * 100}%)` }} />
              )}
            </div>
            <span className="flex flex-col items-end leading-tight sm:flex-row sm:items-baseline sm:gap-1.5">
              <span className="tabular-nums font-medium text-foreground">{formatarNumero(l.valor)}</span>
              <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">{l.texto}</span>
            </span>
          </>
        )
        const dica = l.dica ?? `${l.rotulo}: ${formatarNumero(l.valor)} (${l.texto})`
        const clicavel = !!onClique && l.clicavel !== false
        const estaAtivo = clicavel && ativo !== '' && ativo === l.chave
        return (
          <li key={l.chave || '__vazio__'}>
            {clicavel ? (
              <button type="button" onClick={() => onClique!(l.chave)} aria-pressed={estaAtivo}
                title={`${dica} — clique para filtrar`}
                className={`${LINHA} ${LINHA_CLICAVEL} ${estaAtivo ? LINHA_ATIVA : ''}`}>
                {conteudo}
              </button>
            ) : (
              <div className={LINHA} title={dica}>{conteudo}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Volume — colunas de itens por período (semana ou mês), do mais antigo para o mais novo.
// ---------------------------------------------------------------------------

const ALTURA_COLUNAS = 112 // px da área das barras

function rotuloPeriodo(inicio: string, tipo: 'semana' | 'mes'): string {
  const [a, m, d] = inicio.split('-')
  return tipo === 'semana' ? `${d}/${m}` : `${m}/${a!.slice(2)}`
}

function nomePeriodo(inicio: string, tipo: 'semana' | 'mes'): string {
  const [a, m] = inicio.split('-')
  return tipo === 'semana' ? `Semana de ${diaBr(inicio)}` : `Mês ${m}/${a}`
}

export function ColunasVolume({ periodos, tipo }: { periodos: PeriodoVolume[]; tipo: 'semana' | 'mes' }) {
  const rolagem = useRef<HTMLDivElement>(null)
  // O mais novo fica à direita: a rolagem começa no fim.
  useEffect(() => {
    const el = rolagem.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [periodos, tipo])

  const total = periodos.reduce((n, p) => n + p.itens, 0)
  if (periodos.length === 0 || total === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum item no período.</p>
  }
  const maior = Math.max(...periodos.map((p) => p.itens), 1)
  return (
    <div ref={rolagem} className="w-full min-w-0 overflow-x-auto pb-1" tabIndex={0}
      aria-label={`Itens por ${tipo === 'semana' ? 'semana' : 'mês'} de chegada`} role="group">
      <ul className="flex w-max min-w-full items-end gap-1">
        {periodos.map((p) => {
          const embs = `${formatarNumero(p.embs)} ${p.embs === 1 ? 'EMB' : 'EMBs'}`
          const itens = `${formatarNumero(p.itens)} ${p.itens === 1 ? 'item' : 'itens'}`
          const dica = `${nomePeriodo(p.inicio, tipo)}: ${itens} em ${embs}`
          return (
            <li key={p.inicio} className="flex w-9 shrink-0 flex-col items-center gap-1" title={dica} aria-label={dica}>
              <span className="text-[10px] tabular-nums text-muted-foreground">{p.itens > 0 ? formatarNumero(p.itens) : ''}</span>
              <div className="flex items-end" style={{ height: ALTURA_COLUNAS }}>
                {/* Zero não ganha altura mínima: período sem chegada é coluna nenhuma. */}
                {p.itens > 0 && (
                  <div className={`w-5 rounded-t-[3px] ${COR.vinho}`}
                    style={{ height: `max(2px, ${(p.itens / maior) * 100}%)` }} />
                )}
              </div>
              <span className="text-[10px] tabular-nums text-muted-foreground">{rotuloPeriodo(p.inicio, tipo)}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pendências — cinco barras horizontais, uma por faixa de atraso.
// ---------------------------------------------------------------------------

const COR_FAIXA: Record<keyof FaixasPendencias, CorBarra> = {
  noPrazo: 'ardosia',
  d1a7: 'ambar',
  d8a30: 'ambar',
  d30mais: 'vinho',
  semPrevista: 'azul',
}

export function FaixasPendencias({ faixas }: { faixas: FaixasPendencias }) {
  const linhas = faixasPendencias(faixas)
  const total = linhas.reduce((n, l) => n + l.valor, 0)
  if (total === 0) return <p className="text-sm text-muted-foreground">Nenhuma pendência de chegada.</p>
  const maior = Math.max(...linhas.map((l) => l.valor), 1)
  return (
    <ul className="flex flex-col gap-0.5" aria-label="Pendências por faixa de atraso">
      {linhas.map((l) => (
        <li key={l.chave} className={LINHA} title={`${l.rotulo}: ${formatarNumero(l.valor)}`}>
          <span className="truncate text-foreground">{l.rotulo}</span>
          <div className="h-3.5 min-w-0">
            {l.valor > 0 && (
              <div className={`h-full rounded-r-[4px] ${COR[COR_FAIXA[l.chave]]}`}
                style={{ width: `max(2px, ${(l.valor / maior) * 100}%)` }} />
            )}
          </div>
          <span className="tabular-nums font-medium text-foreground">{formatarNumero(l.valor)}</span>
        </li>
      ))}
    </ul>
  )
}
