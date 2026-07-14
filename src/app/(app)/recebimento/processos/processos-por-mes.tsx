'use client'

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { carregarProcessosDoMes } from '@/modules/recebimento/application/carregar-processos-mes'
import type { GrupoMes } from '@/modules/recebimento/domain/agrupamento-mes'
import type { FiltrosProcessos, ProcessoResumoRow } from '@/modules/recebimento/infra/processo-repository'
import { LinhasProcessos } from './linhas-processos'

type Carga =
  | { fase: 'carregando' }
  | { fase: 'pronto'; linhas: ProcessoResumoRow[] }
  | { fase: 'erro'; erro: string }

interface Props {
  grupos: GrupoMes[]
  filtros: FiltrosProcessos
  abertosInicial: string[]
}

export function ProcessosPorMes({ grupos, filtros, abertosInicial }: Props) {
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set(abertosInicial))
  const [cargas, setCargas] = useState<Record<string, Carga>>({})

  async function carregar(chave: string) {
    setCargas((c) => ({ ...c, [chave]: { fase: 'carregando' } }))
    const r = await carregarProcessosDoMes(filtros, chave)
    setCargas((c) => ({
      ...c,
      [chave]: r.ok ? { fase: 'pronto', linhas: r.linhas } : { fase: 'erro', erro: r.erro },
    }))
  }

  // Carrega os grupos abertos por padrão ao montar. `carregar` chama
  // setState (para marcar 'carregando' e depois o resultado), o que é
  // intencional aqui: é o efeito de busca inicial dos grupos abertos por
  // padrão, então desabilitamos os dois alertas do eslint-plugin-react-hooks
  // (exhaustive-deps, por rodar só na montagem; set-state-in-effect, por
  // ser justamente um fetch-on-mount que atualiza estado com o resultado).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    for (const chave of abertosInicial) carregar(chave)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggle(chave: string) {
    const estaAberto = abertos.has(chave)
    setAbertos((prev) => {
      const next = new Set(prev)
      if (estaAberto) next.delete(chave)
      else next.add(chave)
      return next
    })
    if (!estaAberto && !cargas[chave]) carregar(chave)
  }

  if (grupos.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
        {filtros.busca || filtros.status
          ? 'Nenhum processo encontrado para os filtros selecionados.'
          : 'Nenhum processo encontrado.'}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {grupos.map((g) => {
        const aberto = abertos.has(g.chave)
        const carga = cargas[g.chave]
        return (
          <div key={g.chave} className="overflow-hidden rounded-lg border border-border bg-card">
            <button
              type="button"
              onClick={() => toggle(g.chave)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-accent/50"
            >
              <span className="flex items-center gap-2 font-medium">
                {g.rotulo}
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {g.total}
                </span>
              </span>
              <ChevronDown className={cn('size-4 shrink-0 transition-transform', aberto && 'rotate-180')} />
            </button>
            {aberto && (
              <div className="border-t border-border p-3">
                {(!carga || carga.fase === 'carregando') && (
                  <p className="py-4 text-center text-sm text-muted-foreground">Carregando…</p>
                )}
                {carga?.fase === 'erro' && (
                  <div className="py-4 text-center text-sm">
                    <p className="text-destructive">{carga.erro}</p>
                    <button
                      type="button"
                      onClick={() => carregar(g.chave)}
                      className="mt-2 text-primary underline"
                    >
                      Tentar de novo
                    </button>
                  </div>
                )}
                {carga?.fase === 'pronto' && <LinhasProcessos linhas={carga.linhas} filtros={filtros} />}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
