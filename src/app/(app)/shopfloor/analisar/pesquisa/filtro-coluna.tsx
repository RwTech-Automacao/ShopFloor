'use client'

import { useMemo, useState } from 'react'
import { Filter } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { VAZIO } from '@/modules/shopfloor/domain/grade-filtro'

/** A partir de quantos valores a lista ganha a caixa de busca. */
const BUSCA_A_PARTIR = 8

const CAMPO =
  'h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40'

interface BaseProps {
  coluna: string
  ativo: boolean
  /** Chamado ao abrir o popover: é aqui que a OP inteira começa a carregar (1ª vez). */
  onAbrir: () => void
  carregando: boolean
  /** Motivo pra não filtrar (ex.: OP grande demais). Com ele o botão fica desabilitado. */
  indisponivel?: string
}

type Props =
  | (BaseProps & { tipo: 'texto'; texto: string; onTexto: (t: string) => void })
  | (BaseProps & {
      tipo: 'valores'
      /** Valores distintos da coluna (OP inteira, respeitando a caixa). */
      valores: string[]
      /** Valores marcados; `undefined` = sem filtro (tudo marcado). */
      selecionados: string[] | undefined
      onSelecionados: (s: string[] | undefined) => void
    })

/** Botão de funil no cabeçalho da coluna + popover de filtro (lista com checkbox ou texto). */
export function FiltroColuna(props: Props) {
  const { coluna, ativo, onAbrir, carregando, indisponivel } = props
  const [aberto, setAberto] = useState(false)

  return (
    <Popover
      open={aberto}
      onOpenChange={(o) => {
        setAberto(o)
        if (o) onAbrir()
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={indisponivel !== undefined}
            title={indisponivel ?? `Filtrar ${coluna}`}
            aria-label={`Filtrar ${coluna}`}
            className={`inline-flex size-5 shrink-0 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40 ${
              ativo ? 'bg-enterplak text-white' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            <Filter className="size-3" />
          </button>
        }
      />
      <PopoverContent side="bottom" align="start" sideOffset={4} className="w-64 max-w-[calc(100vw-2rem)] gap-0 p-0">
        <div className="border-b border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
          Filtrar {coluna}
        </div>
        {props.tipo === 'texto' ? (
          <div className="flex flex-col gap-1.5 p-2">
            <input
              autoFocus
              value={props.texto}
              onChange={(e) => props.onTexto(e.target.value)}
              placeholder="Contém…"
              className={CAMPO}
            />
            {carregando && <p className="text-xs text-muted-foreground">Carregando a OP inteira…</p>}
          </div>
        ) : carregando ? (
          <p className="px-2.5 py-2 text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <ListaValores
            valores={props.valores}
            selecionados={props.selecionados}
            onSelecionados={props.onSelecionados}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function ListaValores({
  valores,
  selecionados,
  onSelecionados,
}: {
  valores: string[]
  selecionados: string[] | undefined
  onSelecionados: (s: string[] | undefined) => void
}) {
  const [busca, setBusca] = useState('')
  const marcados = useMemo(() => new Set(selecionados ?? valores), [selecionados, valores])
  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return t === '' ? valores : valores.filter((v) => v.toLowerCase().includes(t))
  }, [valores, busca])
  const todosVisiveisMarcados = visiveis.length > 0 && visiveis.every((v) => marcados.has(v))

  /** Tudo marcado = sem filtro na coluna (undefined), pra não "prender" valores novos. */
  function aplicar(novo: Set<string>) {
    onSelecionados(valores.every((v) => novo.has(v)) ? undefined : valores.filter((v) => novo.has(v)))
  }
  function alternar(v: string) {
    const novo = new Set(marcados)
    if (novo.has(v)) novo.delete(v)
    else novo.add(v)
    aplicar(novo)
  }
  function alternarTodos() {
    const novo = new Set(marcados)
    for (const v of visiveis) {
      if (todosVisiveisMarcados) novo.delete(v)
      else novo.add(v)
    }
    aplicar(novo)
  }

  if (valores.length === 0) return <p className="px-2.5 py-2 text-sm text-muted-foreground">Sem valores.</p>

  return (
    <>
      {valores.length >= BUSCA_A_PARTIR && (
        <div className="border-b border-border p-1.5">
          <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar…" className={CAMPO} />
        </div>
      )}
      <div className="max-h-64 overflow-y-auto p-1">
        <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm font-medium hover:bg-accent">
          <input type="checkbox" className="size-3.5 accent-enterplak" checked={todosVisiveisMarcados} onChange={alternarTodos} />
          {busca.trim() === '' ? 'Selecionar tudo' : 'Selecionar resultados'}
        </label>
        {visiveis.map((v) => (
          <label key={v} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent">
            <input type="checkbox" className="size-3.5 accent-enterplak" checked={marcados.has(v)} onChange={() => alternar(v)} />
            <span className={v === VAZIO ? 'italic text-muted-foreground' : 'truncate'}>{v}</span>
          </label>
        ))}
        {visiveis.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">Nada encontrado.</p>}
      </div>
    </>
  )
}
