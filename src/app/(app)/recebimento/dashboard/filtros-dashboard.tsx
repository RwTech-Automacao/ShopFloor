'use client'

import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  FILTROS_LIMPOS,
  etiquetasDosFiltros,
  semFiltro,
  type FiltrosDashboard,
  type OpcoesDashboard,
} from '@/modules/recebimento/domain/dashboard'

// O Select não aceita item com value="" (é o "nada escolhido" interno dele): marcador para "Todos".
const TODOS = '__todos__'

interface FiltrosDashboardProps {
  /** Os filtros aplicados agora (vêm da URL). O formulário nasce com eles. */
  filtros: FiltrosDashboard
  opcoes: OpcoesDashboard
  /** Leva os filtros para a URL — a tela inteira recalcula. */
  onAplicar: (filtros: FiltrosDashboard) => void
}

/**
 * Fornecedor · Comprador · EMB · Código · De · Até · Filtrar · Limpar filtros, e as etiquetas
 * removíveis do que está aplicado. Quem chama remonta este componente (key) quando os filtros da
 * URL mudam, para o formulário acompanhar um clique num gráfico.
 */
export function FiltrosDashboardBarra({ filtros, opcoes, onAplicar }: FiltrosDashboardProps) {
  const [fornecedor, setFornecedor] = useState(filtros.fornecedor)
  const [comprador, setComprador] = useState(filtros.comprador)
  const [emb, setEmb] = useState(filtros.emb)
  const [codigo, setCodigo] = useState(filtros.codigo)
  const [de, setDe] = useState(filtros.de)
  const [ate, setAte] = useState(filtros.ate)
  const etiquetas = etiquetasDosFiltros(filtros)

  // Enter em qualquer campo filtra. O sinal não está no formulário (vem do gráfico): preserva.
  function aoEnviar(e: FormEvent) {
    e.preventDefault()
    onAplicar({ fornecedor, comprador, emb: emb.trim(), codigo: codigo.trim(), de, ate, sinal: filtros.sinal })
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <form
        onSubmit={aoEnviar}
        className="grid grid-cols-1 items-end gap-3 rounded-lg border border-border p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[repeat(6,minmax(0,1fr))_auto]"
      >
        <CampoLista id="dash-fornecedor" rotulo="Fornecedor" valor={fornecedor} opcoes={opcoes.fornecedores} aoMudar={setFornecedor} />
        <CampoLista id="dash-comprador" rotulo="Comprador" valor={comprador} opcoes={opcoes.compradores} aoMudar={setComprador} />

        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="dash-emb">EMB</Label>
          <Input id="dash-emb" value={emb} onChange={(e) => setEmb(e.target.value)} placeholder="Número da EMB" />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="dash-codigo">Código do material</Label>
          <Input id="dash-codigo" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Código" />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="dash-de">De</Label>
          <Input id="dash-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="dash-ate">Até</Label>
          <Input id="dash-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>

        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-3 xl:col-span-1">
          <Button type="submit" className="bg-enterplak hover:bg-enterplak-700">Filtrar</Button>
          <Button type="button" variant="outline" onClick={() => onAplicar(FILTROS_LIMPOS)}>Limpar filtros</Button>
        </div>
      </form>

      {etiquetas.length > 0 && (
        <ul aria-label="Filtros aplicados" className="flex flex-wrap gap-2">
          {etiquetas.map((e) => (
            <li key={e.chave} className="min-w-0 max-w-full">
              <button
                type="button"
                onClick={() => onAplicar(semFiltro(filtros, e.chave))}
                aria-label={`Tirar o filtro ${e.texto}`}
                title={`Tirar o filtro ${e.texto}`}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-foreground hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="truncate">{e.texto}</span>
                <X className="size-3 shrink-0" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CampoLista({ id, rotulo, valor, opcoes, aoMudar }: {
  id: string; rotulo: string; valor: string; opcoes: string[]; aoMudar: (v: string) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id}>{rotulo}</Label>
      <Select value={valor || TODOS} onValueChange={(v) => aoMudar(v === TODOS ? '' : String(v))}>
        <SelectTrigger id={id} className="w-full min-w-0">
          <SelectValue placeholder="Todos">
            {(v: string | null) => (!v || v === TODOS ? 'Todos' : String(v))}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>Todos</SelectItem>
          {opcoes.map((o) => (
            <SelectItem key={o} value={o}>{o}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
