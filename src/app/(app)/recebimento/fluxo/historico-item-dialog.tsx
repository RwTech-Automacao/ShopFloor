'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, X } from 'lucide-react'
import { carregarHistoricoItemAction } from '@/modules/recebimento/application/fluxo-actions'
import { rotuloPassagem } from '@/modules/recebimento/domain/etapa-processo'
import type { RegistroRecebimento } from '@/modules/recebimento/infra/registros-repository'

/**
 * Trilha de UM item do Recebimento — o que abre ao clicar numa linha do histórico da etapa.
 *
 * É o gêmeo do "Histórico do SN" do Fluxo do ShopFloor: mesma moldura, mesma leitura de cima para
 * baixo, do mais recente para o mais antigo. Aqui mostra só as PASSAGENS; o que mudou campo a campo
 * fica na tela de Registros, que é onde esse detalhe já vive.
 *
 * O item é identificado pelo `processoId`, nunca pelo código: o mesmo material pode ter dois
 * processos na mesma EMB (na EMB390CA existem `CON445 #382` e `#383`).
 */
export interface ItemDoHistorico {
  processoId: string
  numero: number
  item: string
  descricao: string
}

function fmtDataHora(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR')
}

/** Verde para aprovado, vermelho para reprovado, neutro para o resto (igual ao diálogo do SN). */
function corResultado(resultado: string | null): string {
  const v = (resultado ?? '').trim().toLowerCase()
  if (v.startsWith('aprovado')) return 'text-green-700 dark:text-green-400'
  if (v.startsWith('reprovado')) return 'text-red-600 dark:text-red-400'
  return 'text-foreground'
}

export function HistoricoItemDialog({
  emb,
  alvo,
  onFechar,
}: {
  emb: string
  alvo: ItemDoHistorico
  onFechar: () => void
}) {
  const [linhas, setLinhas] = useState<RegistroRecebimento[] | null>(null)
  const [erro, setErro] = useState('')
  const [carregando, start] = useTransition()

  // Esc fecha, como em todo diálogo do sistema.
  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') onFechar()
    }
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [onFechar])

  useEffect(() => {
    start(async () => {
      const r = await carregarHistoricoItemAction(emb, alvo.item, alvo.processoId)
      if (!r.ok) { setErro(r.erro); setLinhas([]); return }
      setErro(''); setLinhas(r.linhas)
    })
  }, [emb, alvo.item, alvo.processoId])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onFechar}
      role="presentation"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Histórico do item ${alvo.item}`}
      >
        <div className="flex items-start gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-sm font-semibold">
              {alvo.item || '—'}
              <span className="ml-1 text-muted-foreground">#{alvo.numero}</span>
            </p>
            <p className="truncate text-xs text-muted-foreground" title={alvo.descricao}>
              {alvo.descricao || 'sem descrição'}
            </p>
          </div>
          <a
            href={`/recebimento/processos/${alvo.processoId}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-enterplak hover:underline"
          >
            Abrir processo
            <ExternalLink className="size-3.5" />
          </a>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3">
          {carregando && linhas === null && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}
          {linhas !== null && !erro && linhas.length === 0 && (
            <p className="text-sm text-muted-foreground">Este item não tem passagens registradas.</p>
          )}
          {linhas !== null && linhas.length > 0 && (
            <ol className="flex flex-col">
              {linhas.map((l, i) => (
                <li key={l.id} className="flex gap-3">
                  {/* Trilho: bolinha na linha do evento e um fio descendo até o próximo. */}
                  <div className="flex w-3 shrink-0 flex-col items-center pt-1.5">
                    <span
                      className={`size-2 shrink-0 rounded-full ${i === 0 ? 'bg-enterplak' : 'bg-border'}`}
                    />
                    {i < linhas.length - 1 && <span className="w-px flex-1 bg-border" />}
                  </div>
                  <div className="min-w-0 flex-1 pb-3">
                    <p className={`text-sm font-medium ${corResultado(l.passagem?.resultado ?? null)}`}>
                      {l.passagem ? rotuloPassagem(l.passagem) : 'sem movimento'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDataHora(l.dataHora)} · {l.colaborador || 'sem colaborador'}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
