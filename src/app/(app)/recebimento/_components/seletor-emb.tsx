'use client'

import { useMemo, useState } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { filtrarEmbs } from '@/modules/recebimento/domain/emb-relatorio'
import { cn } from '@/lib/utils'

/**
 * Combobox de EMB (Popover + campo de filtro), como o seletor de OP do Fluxo do ShopFloor: o Select sequestra
 * as teclas e a lista de EMBs é longa. Usado no Fluxo do Recebimento e no Relatório de EMB.
 */
export function SeletorEmb({
  embs,
  valor,
  onEscolher,
}: {
  embs: readonly string[]
  valor: string
  onEscolher: (emb: string) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [filtro, setFiltro] = useState('')
  const filtradas = useMemo(() => filtrarEmbs(embs, filtro), [embs, filtro])

  function escolher(e: string) {
    setAberto(false)
    setFiltro('')
    onEscolher(e)
  }

  return (
    <Popover open={aberto} onOpenChange={(o) => { setAberto(o); if (!o) setFiltro('') }}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <span className={valor ? 'truncate' : 'truncate text-muted-foreground'}>
              {valor || 'Selecione a EMB'}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </button>
        }
      />
      <PopoverContent side="bottom" align="start" sideOffset={4} className="w-[22rem] max-w-[calc(100vw-2rem)] gap-0 p-0">
        <div className="border-b border-border p-1.5">
          <input
            autoFocus
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Filtrar EMB…"
            className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {filtradas.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">Nenhuma EMB encontrada.</p>
          ) : (
            filtradas.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => escolher(e)}
                className={cn(
                  'flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                  valor === e && 'bg-accent font-medium',
                )}
              >
                {e}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
