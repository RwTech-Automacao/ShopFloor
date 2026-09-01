'use client'

import { useEffect, useState, useTransition } from 'react'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { carregarDefeitosDaOp } from '@/modules/shopfloor/application/pesquisa-actions'
import type { DefeitoDaOp } from '@/modules/shopfloor/infra/pesquisa-repository'
import { iconePorRecurso } from './fluxo-node'

// Data/hora do "card de notificação" (dd/MM HH:mm:ss); título mostra a completa.
const fmtCurto = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Sao_Paulo' })
const fmtLongo = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Sao_Paulo' })

export interface PostoInfo { recurso: string; temStatus: boolean }

/** Lista de defeitos de UMA OP (por pmo/op), mais recente primeiro, com lazy load (role → +100 no banco).
 *  Cards GRANDES estilo "notificação" (poucos ocupam a tela toda), com o ícone do POSTO onde o defeito
 *  foi registrado e filtro por posto. Reusada: painel de Defeitos do Fluxo + slide do modo apresentação. */
export function DefeitosLista({
  pmo,
  op,
  postos,
  postoInfo,
}: {
  pmo: string
  op: string
  postos?: string[]
  postoInfo?: Record<string, PostoInfo>
}) {
  const [linhas, setLinhas] = useState<DefeitoDaOp[]>([])
  const [buscou, setBuscou] = useState(false)
  const [temMais, setTemMais] = useState(false)
  const [postoFiltro, setPostoFiltro] = useState('') // '' = todos
  const [carregando, startCarregar] = useTransition()
  const [carregandoMais, startMais] = useTransition()

  useEffect(() => {
    if (!pmo || !op) return
    let vivo = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset ao trocar de OP/posto antes de recarregar
    setLinhas([]); setBuscou(false); setTemMais(false)
    startCarregar(async () => {
      const r = await carregarDefeitosDaOp(pmo, op, 0, postoFiltro)
      if (!vivo) return
      if (!r.ok) { toast.error(r.erro); return }
      setLinhas(r.linhas); setTemMais(r.temMais); setBuscou(true)
    })
    return () => { vivo = false }
  }, [pmo, op, postoFiltro])

  function carregarMais() {
    if (carregandoMais || !temMais) return
    startMais(async () => {
      const r = await carregarDefeitosDaOp(pmo, op, linhas.length, postoFiltro)
      if (!r.ok) { toast.error(r.erro); return }
      setLinhas((prev) => [...prev, ...r.linhas]); setTemMais(r.temMais)
    })
  }

  // Ícone do posto onde o defeito foi registrado (recurso do perfil); cai na exclamação se desconhecido.
  function iconeDoPosto(posto: string, cls: string) {
    const info = postoInfo?.[posto]
    if (!info) return <AlertTriangle className={cls} />
    return iconePorRecurso(info.recurso, info.temStatus, cls)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-muted-foreground">
          Defeitos {buscou && <>({linhas.length}{temMais ? '+' : ''})</>}
        </p>
        {/* Filtro por posto (server-side) */}
        {postos && postos.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <button
              type="button"
              onClick={() => setPostoFiltro('')}
              className={`rounded-full border px-2.5 py-1 font-medium ${postoFiltro === '' ? 'border-enterplak bg-enterplak text-white' : 'border-border bg-card hover:bg-accent'}`}
            >
              Todos
            </button>
            {postos.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPostoFiltro(p)}
                className={`rounded-full border px-2.5 py-1 font-medium ${postoFiltro === p ? 'border-enterplak bg-enterplak text-white' : 'border-border bg-card hover:bg-accent'}`}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {buscou && !carregando && linhas.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum defeito {postoFiltro ? `no posto ${postoFiltro}` : 'registrado nesta OP'}.</p>
      )}
      {linhas.length > 0 && (
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) carregarMais()
          }}
        >
          {/* Pilha de "notificações" GRANDES — poucos cards ocupam a tela inteira, letra grande. */}
          <ul className="mx-auto flex w-full max-w-6xl flex-col gap-3 p-1">
            {linhas.map((l, i) => {
              const dt = l.dataHora ? new Date(l.dataHora) : null
              // Posto onde foi REPROVADO: usa posto_origem (ex.: reparo na Manutenção guarda o posto do teste).
              const postoReprova = l.postoOrigem || l.posto
              const detalhe = [
                `SN ${l.sn}`,
                l.posicao ? `pos. ${l.posicao}` : '',
                l.tipo ? l.tipo : '',
              ].filter(Boolean).join(' · ')
              return (
                <li
                  key={i}
                  className="flex min-h-[7.5rem] items-center gap-5 rounded-3xl border border-border bg-card/95 px-6 py-5 shadow-sm backdrop-blur"
                >
                  <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400">
                    {iconeDoPosto(postoReprova, 'size-9')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-2xl font-bold text-foreground">{l.codigo || 'Defeito'}</span>
                      <span className="shrink-0 text-base text-muted-foreground" title={dt ? fmtLongo.format(dt) : ''}>
                        {dt ? fmtCurto.format(dt) : '—'}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-lg font-medium text-foreground/80">{postoReprova}</p>
                    <p className="truncate text-base text-muted-foreground">{detalhe}</p>
                    {l.colaborador && <p className="truncate text-sm text-muted-foreground">por {l.colaborador}</p>}
                  </div>
                </li>
              )
            })}
            {temMais && (
              <li className="py-2 text-center text-sm text-muted-foreground">
                {carregandoMais ? 'Carregando…' : 'Role para carregar mais'}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
