'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { buscarHistoricoSN } from '@/modules/shopfloor/application/pesquisa-actions'
import type { RegistroHistorico } from '@/modules/shopfloor/infra/pesquisa-repository'
import { cn } from '@/lib/utils'

function fmtData(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR')
}

function corStatus(s: string): string {
  const v = s.trim().toLowerCase()
  if (v === 'aprovado') return 'text-green-700 dark:text-green-400'
  if (v === 'reprovado') return 'text-red-600 dark:text-red-400'
  return 'text-muted-foreground'
}

/** Rótulo do evento: para Burn-in a entrada (status vazio) vira "Entrada"; passagem vira "Registrado". */
function rotuloEvento(r: RegistroHistorico): string {
  if (r.status.trim() !== '') return r.status
  if (r.posto.toLowerCase().includes('burn')) return 'Entrada'
  return 'Registrado'
}

/** Linhas de detalhe do evento (defeito, caixa, NQA, reparo, integração) — só as preenchidas. */
function detalhes(r: RegistroHistorico): string[] {
  const bits: string[] = []
  const def = [r.cod, r.pos, r.tipo].filter(Boolean).join(' · ')
  if (def) bits.push(`Defeito: ${def}`)
  if (r.numeroCaixa) bits.push(`Caixa: ${r.numeroCaixa}`)
  const nqa = [r.nqaVisual, r.nqaFuncional].filter(Boolean).join(' / ')
  if (nqa) bits.push(`NQA: ${nqa}`)
  const rep = [r.reparoConserto, r.reparoPosicao].filter(Boolean).join(' · ')
  if (rep) bits.push(`Reparo: ${rep}`)
  if (r.idIntegracao) bits.push(`Integração: ${r.idIntegracao}`)
  return bits
}

/** Um passo da trilha: um evento real do produto OU um posto futuro (ainda não alcançado). */
interface Passo {
  posto: string
  rotulo: string
  status: string
  quando: string
  colaborador: string
  detalhes: string[]
  feito: boolean // pinta bolinha/linha de vinho: todo posto por onde a peça PASSOU (inclui reprovado)
  futuro: boolean // posto que a peça ainda não alcançou (cinza esmaecido)
}

/**
 * Linha do tempo (trilha) de um produto pelo Nº de Série. Overlay próprio (portal via React) — não
 * usa o Dialog base-ui porque, dentro do Modo TV (fullscreen), o portal/dismiss dele fica instável.
 * `container` = destino do portal: em Modo TV passa o canvas (`absolute`, dentro da tela cheia); fora
 * do TV fica no `body` (`fixed`, cobre a viewport). Fecha no X e no clique fora — `onClick` direto.
 */
export function HistoricoSnDialog({
  sn,
  postosOP,
  onFechar,
  container,
}: {
  sn: string | null
  postosOP: string[]
  onFechar: () => void
  container?: HTMLElement | null
}) {
  const [registros, setRegistros] = useState<RegistroHistorico[] | null>(null)
  const [carregando, startBusca] = useTransition()

  useEffect(() => {
    if (sn === null) return
    startBusca(async () => {
      const r = await buscarHistoricoSN(sn)
      setRegistros(r.ok ? r.registros : [])
    })
  }, [sn])

  const passos = useMemo<Passo[]>(() => {
    if (!registros) return []
    const eventos: Passo[] = registros.map((r) => ({
      posto: r.posto || '—',
      rotulo: rotuloEvento(r),
      status: r.status,
      quando: fmtData(r.dataHora),
      colaborador: r.colaborador,
      detalhes: detalhes(r),
      feito: true, // todo posto por onde a peça PASSOU fica vinho (inclui reprovado); só o futuro é cinza
      futuro: false,
    }))
    const alcancados = new Set(registros.map((r) => r.posto.toLowerCase()))
    const futuros: Passo[] = postosOP
      .filter((p) => !alcancados.has(p.toLowerCase()))
      .map((p) => ({ posto: p, rotulo: 'Pendente', status: '', quando: '', colaborador: '', detalhes: [], feito: false, futuro: true }))
    return [...eventos, ...futuros]
  }, [registros, postosOP])

  if (sn === null) return null
  const alvo = container ?? (typeof document !== 'undefined' ? document.body : null)
  if (!alvo) return null
  // TV: portal no canvas → `absolute` (o canvas é relative e preenche a tela cheia).
  // Normal: portal no body → `fixed` (cobre a viewport).
  const posicao = container ? 'absolute' : 'fixed'

  return createPortal(
    <div className={cn(posicao, 'inset-0 z-50 flex items-center justify-center bg-black/20 p-4')} onClick={onFechar}>
      <div
        className="max-h-[calc(100%-2rem)] w-full max-w-3xl overflow-y-auto rounded-xl bg-popover p-4 text-popover-foreground shadow-lg ring-1 ring-foreground/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <h2 className="font-heading text-base font-medium leading-none">
            Linha do tempo · <span className="font-mono text-base">{sn}</span>
          </h2>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="-mt-1 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!carregando && registros !== null && registros.length === 0 && (
          <p className="text-sm text-muted-foreground">Sem registros para este Nº de Série.</p>
        )}
        {!carregando && passos.length > 0 && (
          <div className="overflow-x-auto pb-2">
            {/* Horizontal: trilha completa. Vinho nos concluídos (inclui entrada de burn-in); cinza nos
                reprovados e nos postos futuros (ainda não alcançados). */}
            <ol className="flex min-w-max items-start pt-1">
              {passos.map((p, i) => {
                const ok = p.feito
                const okProx = passos[i + 1]?.feito ?? false
                return (
                  <li key={i} className={cn('flex w-36 shrink-0 flex-col items-center', p.futuro && 'opacity-60')}>
                    <div className="flex w-full items-center">
                      <span className={cn('h-0.5 flex-1', ok ? 'bg-enterplak' : 'bg-border', i === 0 && 'opacity-0')} />
                      <span
                        className={cn(
                          'size-3.5 shrink-0 rounded-full border-2 border-card',
                          ok ? 'bg-enterplak' : 'bg-muted-foreground/40',
                        )}
                      />
                      <span
                        className={cn(
                          'h-0.5 flex-1',
                          okProx ? 'bg-enterplak' : 'bg-border',
                          i === passos.length - 1 && 'opacity-0',
                        )}
                      />
                    </div>
                    <div className="mt-2 px-1.5 text-center">
                      <p className="text-xs font-medium leading-tight">{p.posto}</p>
                      <p className={cn('text-xs font-medium', p.futuro ? 'text-muted-foreground' : corStatus(p.status))}>{p.rotulo}</p>
                      {p.quando && <p className="text-[10px] text-muted-foreground">{p.quando}</p>}
                      {p.colaborador && <p className="text-[10px] text-muted-foreground">{p.colaborador}</p>}
                      {p.detalhes.map((d, j) => (
                        <p key={j} className="text-[10px] text-muted-foreground">{d}</p>
                      ))}
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        )}
      </div>
    </div>,
    alvo,
  )
}
