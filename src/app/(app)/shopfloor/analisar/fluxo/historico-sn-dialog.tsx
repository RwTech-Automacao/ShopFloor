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

/** Posto concluído com sucesso? (aprovado, ou passagem registrada) — pinta a bolinha/linha de vinho.
 *  Reprovado, entrada de Burn-in (cozinhando) e pendente ficam cinza. */
function concluido(r: RegistroHistorico): boolean {
  const s = r.status.trim().toLowerCase()
  if (s === 'aprovado') return true
  if (s === 'reprovado') return false
  return !r.posto.toLowerCase().includes('burn') // status vazio: passagem = concluído; entrada burn-in = não
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
      <DialogContent className="sm:max-w-3xl">
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
          <div className="overflow-x-auto pb-2">
            {/* Horizontal: bolinha + linha em vinho nos postos concluídos (aprovados); cinza nos demais. */}
            <ol className="flex min-w-max items-start pt-1">
              {registros.map((r, i) => {
                const ok = concluido(r)
                const proximo = registros[i + 1]
                const okProx = proximo !== undefined && concluido(proximo)
                return (
                  <li key={i} className="flex w-36 shrink-0 flex-col items-center">
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
                          i === registros.length - 1 && 'opacity-0',
                        )}
                      />
                    </div>
                    <div className="mt-2 px-1.5 text-center">
                      <p className="text-xs font-medium leading-tight">{r.posto || '—'}</p>
                      <p className={cn('text-xs font-medium', corStatus(r.status))}>{rotuloEvento(r)}</p>
                      <p className="text-[10px] text-muted-foreground">{fmtData(r.dataHora)}</p>
                      {r.colaborador && <p className="text-[10px] text-muted-foreground">{r.colaborador}</p>}
                      {detalhes(r).map((d, j) => (
                        <p key={j} className="text-[10px] text-muted-foreground">{d}</p>
                      ))}
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
