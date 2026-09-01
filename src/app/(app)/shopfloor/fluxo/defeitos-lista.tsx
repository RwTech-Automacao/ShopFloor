'use client'

import { useEffect, useState, useTransition } from 'react'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { carregarDefeitosDaOp } from '@/modules/shopfloor/application/pesquisa-actions'
import type { DefeitoDaOp } from '@/modules/shopfloor/infra/pesquisa-repository'

// Data/hora compacta pro canto do "card de notificação" (dd/MM HH:mm); título mostra a completa.
const fmtCurto = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Sao_Paulo' })
const fmtLongo = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Sao_Paulo' })

/** Lista de defeitos de UMA OP (por pmo/op), mais recente primeiro, com lazy load (role pra carregar).
 *  Estilo "notificação de iPhone": cada defeito é um card com ícone, título (o defeito) e detalhe.
 *  Reusada: painel de Defeitos dentro do Fluxo e slide "defeitos" do modo apresentação. */
export function DefeitosLista({ pmo, op }: { pmo: string; op: string }) {
  const [linhas, setLinhas] = useState<DefeitoDaOp[]>([])
  const [buscou, setBuscou] = useState(false)
  const [temMais, setTemMais] = useState(false)
  const [carregando, startCarregar] = useTransition()
  const [carregandoMais, startMais] = useTransition()

  useEffect(() => {
    if (!pmo || !op) return
    let vivo = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset ao trocar de OP antes de recarregar
    setLinhas([]); setBuscou(false); setTemMais(false)
    startCarregar(async () => {
      const r = await carregarDefeitosDaOp(pmo, op, 0)
      if (!vivo) return
      if (!r.ok) { toast.error(r.erro); return }
      setLinhas(r.linhas); setTemMais(r.temMais); setBuscou(true)
    })
    return () => { vivo = false }
  }, [pmo, op])

  function carregarMais() {
    if (carregandoMais || !temMais) return
    startMais(async () => {
      const r = await carregarDefeitosDaOp(pmo, op, linhas.length)
      if (!r.ok) { toast.error(r.erro); return }
      setLinhas((prev) => [...prev, ...r.linhas]); setTemMais(r.temMais)
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="mb-1 shrink-0 text-sm font-medium text-muted-foreground">
        Defeitos {buscou && <>({linhas.length}{temMais ? '+' : ''})</>}
      </p>
      {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {buscou && !carregando && linhas.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum defeito registrado nesta OP.</p>
      )}
      {linhas.length > 0 && (
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) carregarMais()
          }}
        >
          {/* Pilha de "notificações" (estilo iPhone). */}
          <ul className="mx-auto flex w-full max-w-2xl flex-col gap-2 p-1">
            {linhas.map((l, i) => {
              const dt = l.dataHora ? new Date(l.dataHora) : null
              const detalhe = [
                l.posto,
                `SN ${l.sn}`,
                l.posicao ? `pos. ${l.posicao}` : '',
                l.tipo ? l.tipo : '',
              ].filter(Boolean).join(' · ')
              return (
                <li
                  key={i}
                  className="flex items-start gap-3 rounded-2xl border border-border bg-card/95 p-3 shadow-sm backdrop-blur"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400">
                    <AlertTriangle className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-semibold text-foreground">{l.codigo || 'Defeito'}</span>
                      <span className="shrink-0 text-xs text-muted-foreground" title={dt ? fmtLongo.format(dt) : ''}>
                        {dt ? fmtCurto.format(dt) : '—'}
                      </span>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">{detalhe}</p>
                    {l.colaborador && <p className="truncate text-xs text-muted-foreground">por {l.colaborador}</p>}
                  </div>
                </li>
              )
            })}
            {temMais && (
              <li className="py-2 text-center text-xs text-muted-foreground">
                {carregandoMais ? 'Carregando…' : 'Role para carregar mais'}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
