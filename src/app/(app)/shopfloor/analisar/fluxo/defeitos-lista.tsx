'use client'

import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { carregarDefeitosDaOp } from '@/modules/shopfloor/application/pesquisa-actions'
import type { DefeitoDaOp } from '@/modules/shopfloor/infra/pesquisa-repository'

const fmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Sao_Paulo' })
function fmtData(iso: string): string { return iso ? fmt.format(new Date(iso)) : '—' }

/** Lista de defeitos de UMA OP (por pmo/op), mais recente primeiro, com lazy load (role pra carregar).
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
          className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-card"
          onScroll={(e) => {
            const el = e.currentTarget
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) carregarMais()
          }}
        >
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Data/hora</th>
                <th className="px-3 py-2 text-left font-medium">Defeito</th>
                <th className="px-3 py-2 text-left font-medium">Posição</th>
                <th className="px-3 py-2 text-left font-medium">Tipo</th>
                <th className="px-3 py-2 text-left font-medium">Posto</th>
                <th className="px-3 py-2 text-left font-medium">Nº de Série</th>
                <th className="px-3 py-2 text-left font-medium">Colaborador</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{fmtData(l.dataHora)}</td>
                  <td className="px-3 py-1.5 font-medium">{l.codigo || '—'}</td>
                  <td className="px-3 py-1.5">{l.posicao || '—'}</td>
                  <td className="px-3 py-1.5">{l.tipo || '—'}</td>
                  <td className="px-3 py-1.5">{l.posto}</td>
                  <td className="px-3 py-1.5 font-mono">{l.sn}</td>
                  <td className="px-3 py-1.5">{l.colaborador || '—'}</td>
                </tr>
              ))}
              {temMais && (
                <tr><td colSpan={7} className="px-3 py-2 text-center text-xs text-muted-foreground">
                  {carregandoMais ? 'Carregando…' : 'Role para carregar mais'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
