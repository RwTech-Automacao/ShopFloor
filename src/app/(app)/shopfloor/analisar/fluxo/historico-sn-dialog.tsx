'use client'

import { useEffect, useState, useTransition } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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

/** Linha do tempo (história) de um produto pelo Nº de Série — reusa o histórico da Pesquisa. */
export function HistoricoSnDialog({ sn, onFechar }: { sn: string | null; onFechar: () => void }) {
  const [registros, setRegistros] = useState<RegistroHistorico[] | null>(null)
  const [carregando, startBusca] = useTransition()

  useEffect(() => {
    if (sn === null) return
    startBusca(async () => {
      const r = await buscarHistoricoSN(sn)
      setRegistros(r.ok ? r.registros : [])
    })
  }, [sn])

  return (
    <Dialog open={sn !== null} onOpenChange={(aberto) => { if (!aberto) onFechar() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Linha do tempo · <span className="font-mono text-base">{sn}</span>
          </DialogTitle>
        </DialogHeader>

        {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!carregando && registros !== null && registros.length === 0 && (
          <p className="text-sm text-muted-foreground">Sem registros para este Nº de Série.</p>
        )}
        {!carregando && registros !== null && registros.length > 0 && (
          <ol className="relative ml-1 flex flex-col gap-4 border-l border-border py-1 pl-5">
            {registros.map((r, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[1.6rem] top-1 size-3 rounded-full border-2 border-card bg-enterplak" />
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium">{r.posto || '—'}</span>
                  <span className={cn('text-xs font-medium', corStatus(r.status))}>{rotuloEvento(r)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {fmtData(r.dataHora)}
                  {r.colaborador ? ` · ${r.colaborador}` : ''}
                </p>
                {detalhes(r).map((d, j) => (
                  <p key={j} className="text-xs text-muted-foreground">{d}</p>
                ))}
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  )
}
