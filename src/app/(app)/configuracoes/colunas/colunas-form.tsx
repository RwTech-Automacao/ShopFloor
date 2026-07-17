'use client'

import { useState, useTransition } from 'react'
import { ChevronDownIcon, ChevronUpIcon, LockIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { salvarLayoutColunas } from '@/modules/recebimento/application/colunas-lista-actions'
import { COLUNAS_FIXAS } from '@/modules/recebimento/domain/layout-colunas'

export interface ColunaItem {
  campo: string
  rotulo: string
}

/**
 * Duas listas: "Visíveis" (na ordem do grid, com setas ↑↓) e "Disponíveis" (ocultas).
 * Edita em memória; o botão "Salvar alterações" manda ao servidor só a lista ordenada
 * dos campos visíveis — o servidor deriva o resto.
 */
export function ColunasForm({
  visiveisIniciais,
  disponiveisIniciais,
}: {
  visiveisIniciais: ColunaItem[]
  disponiveisIniciais: ColunaItem[]
}) {
  const [visiveis, setVisiveis] = useState<ColunaItem[]>(visiveisIniciais)
  const [disponiveis, setDisponiveis] = useState<ColunaItem[]>(disponiveisIniciais)
  const [sujo, setSujo] = useState(false)
  const [salvando, startSalvar] = useTransition()

  function mover(i: number, delta: number) {
    const j = i + delta
    if (j < 0 || j >= visiveis.length) return
    setVisiveis((atual) => {
      const copia = [...atual]
      const a = copia[i]
      const b = copia[j]
      if (!a || !b) return atual
      copia[i] = b
      copia[j] = a
      return copia
    })
    setSujo(true)
  }

  function ocultar(campo: string) {
    if (COLUNAS_FIXAS.includes(campo)) return
    const col = visiveis.find((c) => c.campo === campo)
    if (!col) return
    setVisiveis((atual) => atual.filter((c) => c.campo !== campo))
    setDisponiveis((atual) =>
      [...atual, col].sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR')),
    )
    setSujo(true)
  }

  function mostrar(campo: string) {
    const col = disponiveis.find((c) => c.campo === campo)
    if (!col) return
    setDisponiveis((atual) => atual.filter((c) => c.campo !== campo))
    setVisiveis((atual) => [...atual, col])
    setSujo(true)
  }

  function salvar() {
    startSalvar(async () => {
      const r = await salvarLayoutColunas(visiveis.map((c) => c.campo))
      if (r.ok) {
        setSujo(false)
        toast.success('Colunas salvas. A lista de Processos já reflete a mudança.')
      } else {
        toast.error(r.erro)
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide">Visíveis</h2>
              <p className="text-xs text-muted-foreground">Na ordem em que aparecem na lista</p>
            </div>
            <span className="text-sm text-muted-foreground">{visiveis.length}</span>
          </div>
          <ul className="max-h-[28rem] overflow-y-auto">
            {visiveis.map((col, i) => {
              const fixa = COLUNAS_FIXAS.includes(col.campo)
              return (
                <li
                  key={col.campo}
                  className="flex items-center gap-2 border-b border-border px-2 py-2 last:border-b-0"
                >
                  <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">
                    {i + 1}
                  </span>
                  <div className="flex shrink-0 gap-0.5">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Mover ${col.rotulo} para cima`}
                      disabled={salvando || i === 0}
                      onClick={() => mover(i, -1)}
                    >
                      <ChevronUpIcon />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Mover ${col.rotulo} para baixo`}
                      disabled={salvando || i === visiveis.length - 1}
                      onClick={() => mover(i, 1)}
                    >
                      <ChevronDownIcon />
                    </Button>
                  </div>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate">{col.rotulo}</span>
                    {fixa && (
                      <Badge variant="secondary" className="shrink-0 font-normal">
                        sempre visível
                      </Badge>
                    )}
                  </span>
                  {fixa ? (
                    <LockIcon
                      role="img"
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-label={`${col.rotulo} não pode ser ocultada`}
                    />
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={salvando}
                      onClick={() => ocultar(col.campo)}
                    >
                      Ocultar
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide">Disponíveis</h2>
              <p className="text-xs text-muted-foreground">Ocultas — clique em Mostrar para usar</p>
            </div>
            <span className="text-sm text-muted-foreground">{disponiveis.length}</span>
          </div>
          <ul className="max-h-[28rem] overflow-y-auto">
            {disponiveis.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                Todas as colunas estão na lista.
              </li>
            )}
            {disponiveis.map((col) => (
              <li
                key={col.campo}
                className="flex items-center gap-2 border-b border-border px-4 py-2 last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate">{col.rotulo}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={salvando}
                  onClick={() => mostrar(col.campo)}
                >
                  Mostrar
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <span className="text-sm text-muted-foreground">
          {sujo ? 'Alterações não salvas' : 'Tudo salvo'}
        </span>
        <Button
          className="bg-enterplak hover:bg-enterplak-700"
          disabled={!sujo || salvando}
          onClick={salvar}
        >
          {salvando ? 'Salvando…' : 'Salvar alterações'}
        </Button>
      </div>
    </div>
  )
}
