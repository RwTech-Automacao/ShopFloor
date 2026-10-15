'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import {
  diaBr,
  fimDaSemana,
  formatarNumero,
  formatarPercentual,
  percentual,
  rotuloFornecedor,
  type FornecedorDashboard,
  type SemanaDashboard,
  type Sinal,
} from '@/modules/recebimento/domain/dashboard'
import { geometriaSemanas } from '@/modules/recebimento/domain/dashboard-grafico'
import { Explica } from './explica'

// Cores das MARCAS (barras). Cada uma tem par claro/escuro; texto nunca usa estas cores — número e
// rótulo ficam na cor de texto do tema, e a identidade vem da barra ao lado.
//   sem justificativa / divergentes: o vinho da marca (o mesmo do dashboard do ShopFloor).
//   justificadas: ardósia — neutra, "resolvido", recua atrás do vinho na pilha.
//   positivas (a mais) × negativas (a menos): âmbar × azul, luminosidades diferentes entre si.
const COR_SEM = 'bg-[#8D2033] dark:bg-[#d2566c]'
const COR_SEM_SVG = 'fill-[#8D2033] dark:fill-[#d2566c]'
const COR_JUST = 'bg-[#64748b] dark:bg-[#94a3b8]'
const COR_JUST_SVG = 'fill-[#64748b] dark:fill-[#94a3b8]'
const COR_POSITIVA = 'bg-[#b45309] dark:bg-[#f59e0b]'
const COR_NEGATIVA = 'bg-[#1d4ed8] dark:bg-[#60a5fa]'

/** Linha clicável de um gráfico de barras horizontais: a linha inteira é o alvo. */
const LINHA = 'grid w-full grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] items-center gap-3 rounded px-1 py-0.5 text-left text-sm'
const LINHA_CLICAVEL = 'hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring'
const LINHA_ATIVA = 'bg-enterplak/10 dark:bg-enterplak/25'

/** Cartão de um gráfico: título, ⓘ e (opcional) a legenda à direita. */
export function CartaoGrafico({ titulo, explica, acao, children }: {
  titulo: string; explica: string; acao?: ReactNode; children: ReactNode
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="flex min-w-0 flex-col gap-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-foreground">{titulo}</p>
            <Explica texto={explica} />
          </div>
          {acao}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

export function LegendaSemanas() {
  return (
    <ul className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <li className="inline-flex items-center gap-1.5"><span className={`size-2.5 rounded-sm ${COR_JUST}`} aria-hidden />Justificadas</li>
      <li className="inline-flex items-center gap-1.5"><span className={`size-2.5 rounded-sm ${COR_SEM}`} aria-hidden />Sem justificativa</li>
    </ul>
  )
}

// ---------------------------------------------------------------------------
// 1. Ranking por fornecedor — barras horizontais em HTML (escala: divergentes ÷ o maior).
// ---------------------------------------------------------------------------

export function RankingFornecedores({ fornecedores, ativo, onClique }: {
  fornecedores: FornecedorDashboard[]
  /** Fornecedor do filtro aplicado ('' = nenhum): a barra dele fica marcada. */
  ativo: string
  onClique: (fornecedor: string) => void
}) {
  if (fornecedores.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum fornecedor com item divergente neste recorte.</p>
  }
  const maior = Math.max(...fornecedores.map((f) => f.divergentes))
  return (
    <ul className="flex flex-col gap-0.5">
      {fornecedores.map((f) => {
        const nome = rotuloFornecedor(f.fornecedor)
        const pct = formatarPercentual(percentual(f.divergentes, f.itens))
        const emBranco = f.fornecedor === ''
        const estaAtivo = !emBranco && ativo === f.fornecedor
        const conteudo = (
          <>
            {/* Nome longo corta com reticências; o nome inteiro fica no title. */}
            <span className={`truncate ${emBranco ? 'italic text-muted-foreground' : 'text-foreground'}`} title={nome}>{nome}</span>
            <div className="h-3.5 min-w-0">
              <div className={`h-full rounded-r-[4px] ${COR_SEM}`} style={{ width: `max(2px, ${(f.divergentes / maior) * 100}%)` }} />
            </div>
            <span className="flex flex-col items-end leading-tight sm:flex-row sm:items-baseline sm:gap-1.5">
              <span className="tabular-nums font-medium text-foreground">{formatarNumero(f.divergentes)}</span>
              <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">{pct} dos itens dele</span>
            </span>
          </>
        )
        const dica = `${nome}: ${formatarNumero(f.divergentes)} de ${formatarNumero(f.itens)} itens com divergência (${pct})`
        return (
          <li key={f.fornecedor || '__sem__'}>
            {emBranco ? (
              // Texto vazio, no banco, é "sem filtro": fornecedor em branco não tem como virar filtro.
              <div className={LINHA} title={`${dica} — fornecedor em branco não filtra`}>{conteudo}</div>
            ) : (
              <button type="button" onClick={() => onClique(f.fornecedor)} aria-pressed={estaAtivo}
                title={`${dica} — clique para filtrar`}
                className={`${LINHA} ${LINHA_CLICAVEL} ${estaAtivo ? LINHA_ATIVA : ''}`}>
                {conteudo}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// 2. Divergências por semana — SVG à mão, UMA escala (dashboard-grafico.ts).
// ---------------------------------------------------------------------------

/** Largura real do container, para desenhar 1:1 com pixels. Sem ResizeObserver (testes): 640. */
function useLarguraContainer(padrao = 640) {
  const ref = useRef<HTMLDivElement>(null)
  const [largura, setLargura] = useState(padrao)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entradas) => {
      for (const e of entradas) setLargura(Math.round(e.contentRect.width))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, largura] as const
}

export function GraficoSemanas({ semanas, ativo, onClique }: {
  semanas: SemanaDashboard[]
  /** Segunda-feira da semana que está filtrada ('' = nenhuma). */
  ativo: string
  onClique: (inicio: string) => void
}) {
  const [ref, largura] = useLarguraContainer()
  const total = semanas.reduce((n, s) => n + s.justificadas + s.semJustificativa, 0)

  // O div medido existe SEMPRE: o ResizeObserver é ligado uma vez só, na montagem.
  let corpo: ReactNode
  if (semanas.length === 0) {
    corpo = <p className="text-sm text-muted-foreground">Nenhum item com data de chegada neste recorte.</p>
  } else if (total === 0) {
    corpo = <p className="text-sm text-muted-foreground">Nenhum item divergente neste recorte.</p>
  } else {
    const g = geometriaSemanas(semanas, largura)
    corpo = (
      // h-auto + max-w-full: num container menor que 280 px o SVG encolhe junto (viewBox), em vez
      // de criar rolagem horizontal na página.
      <svg width={g.largura} height={g.altura} viewBox={`0 0 ${g.largura} ${g.altura}`}
        className="block h-auto max-w-full" role="group" aria-label="Itens divergentes por semana de chegada">
        {g.marcas.map((m) => (
          <g key={m.valor}>
            <line x1={g.esquerda} x2={g.direita} y1={m.y} y2={m.y} className="stroke-border" strokeWidth={1} />
            <text x={g.esquerda - 6} y={m.y} textAnchor="end" dominantBaseline="middle"
              className="fill-muted-foreground" style={{ fontSize: 11 }}>{formatarNumero(m.valor)}</text>
          </g>
        ))}
        {g.barras.map((b, i) => {
          const s = semanas[i]!
          const estaAtivo = ativo === b.inicio
          const titulo = `Semana de ${diaBr(b.inicio)} a ${diaBr(fimDaSemana(b.inicio))}: ` +
            `${formatarNumero(s.justificadas)} justificada(s), ${formatarNumero(s.semJustificativa)} sem justificativa — ` +
            'clique para filtrar por esta semana'
          const aoTeclar = (e: KeyboardEvent<SVGGElement>) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClique(b.inicio) }
          }
          return (
            <g key={b.inicio} role="button" tabIndex={0} aria-label={titulo} aria-pressed={estaAtivo}
              onClick={() => onClique(b.inicio)} onKeyDown={aoTeclar}
              className="group cursor-pointer outline-none">
              <title>{titulo}</title>
              {/* A coluna inteira é o alvo do clique — fill explícito (transparente), senão o
                  navegador não entrega o clique na área vazia. */}
              <rect x={b.xFaixa} y={g.topoPlot} width={b.larguraFaixa} height={g.basePlot - g.topoPlot}
                className={estaAtivo ? 'fill-enterplak/10' : 'fill-transparent group-hover:fill-muted/60 group-focus-visible:fill-muted'} />
              {b.alturaJustificadas > 0 && (
                <rect data-serie="justificadas" x={b.x} y={b.yJustificadas} width={b.largura} height={b.alturaJustificadas} className={COR_JUST_SVG} />
              )}
              {b.alturaSem > 0 && (
                <rect data-serie="sem-justificativa" x={b.x} y={b.ySem} width={b.largura} height={b.alturaSem} className={COR_SEM_SVG} />
              )}
              {b.rotulo && (
                <text x={b.centro} y={g.altura - 8} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 10 }}>{b.rotulo}</text>
              )}
            </g>
          )
        })}
        <line x1={g.esquerda} x2={g.direita} y1={g.basePlot} y2={g.basePlot} className="stroke-muted-foreground/60" strokeWidth={1} />
      </svg>
    )
  }

  return <div ref={ref} className="w-full min-w-0">{corpo}</div>
}

// ---------------------------------------------------------------------------
// 3. Positivas × negativas — duas barras horizontais em HTML, mesma escala (÷ a maior das duas).
// ---------------------------------------------------------------------------

export function PositivasNegativas({ positivas, negativas, ativo, onClique }: {
  positivas: number
  negativas: number
  ativo: Sinal | ''
  onClique: (sinal: Sinal) => void
}) {
  const total = positivas + negativas
  if (total === 0) return <p className="text-sm text-muted-foreground">Nenhum item divergente neste recorte.</p>
  const maior = Math.max(positivas, negativas)
  const linhas: { sinal: Sinal; rotulo: string; valor: number; cor: string }[] = [
    { sinal: 'positiva', rotulo: 'Positivas (a mais)', valor: positivas, cor: COR_POSITIVA },
    { sinal: 'negativa', rotulo: 'Negativas (a menos)', valor: negativas, cor: COR_NEGATIVA },
  ]
  return (
    <ul className="flex flex-col gap-1">
      {linhas.map((l) => {
        const estaAtivo = ativo === l.sinal
        const pct = formatarPercentual(percentual(l.valor, total))
        return (
          <li key={l.sinal}>
            <button type="button" onClick={() => onClique(l.sinal)} aria-pressed={estaAtivo}
              title={`${l.rotulo}: ${formatarNumero(l.valor)} (${pct} das divergentes) — clique para ver só estas`}
              className={`${LINHA} ${LINHA_CLICAVEL} ${estaAtivo ? LINHA_ATIVA : ''}`}>
              <span className="truncate text-foreground">{l.rotulo}</span>
              <div className="h-3.5 min-w-0">
                {/* Zero não ganha o mínimo de 2 px: barra de zero é barra nenhuma. */}
                {l.valor > 0 && (
                  <div className={`h-full rounded-r-[4px] ${l.cor}`} style={{ width: `max(2px, ${(l.valor / maior) * 100}%)` }} />
                )}
              </div>
              <span className="flex flex-col items-end leading-tight sm:flex-row sm:items-baseline sm:gap-1.5">
                <span className="tabular-nums font-medium text-foreground">{formatarNumero(l.valor)}</span>
                <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">{pct}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
