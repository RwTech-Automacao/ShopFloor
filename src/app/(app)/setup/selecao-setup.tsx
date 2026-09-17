'use client'

import { useMemo, useState } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FACES, type Face } from '@/modules/setup/domain/face'
import { rotuloEquipamento, rotulosPosicao, type Processo } from '@/modules/setup/domain/tipos'
import type { Equipamento, OrdemSetup } from '@/modules/setup/infra/setup-repository'

// Reexportado por conveniência: os telas de consulta/operação importam daqui há mais tempo.
export { rotuloEquipamento }

export interface ValorSelecao {
  pmo: string
  op: string
  processo: Processo | ''
  linha: string
  equipamento: string
  face: Face | ''
}

export const SELECAO_VAZIA: ValorSelecao = { pmo: '', op: '', processo: '', linha: '', equipamento: '', face: '' }

/** Os 6 campos preenchidos: dá pra localizar/abrir o setup. */
export function selecaoCompleta(v: ValorSelecao): v is ValorSelecao & { processo: Processo; face: Face } {
  return v.pmo !== '' && v.op !== '' && v.processo !== '' && v.linha !== '' && v.equipamento !== '' && v.face !== ''
}

// Campos grandes: a tela é usada em tablet no chão de fábrica.
const CAMPO = 'h-11 w-full text-base'
const LIMITE_LISTA = 200

export function SelecaoSetup({
  ordens,
  equipamentos,
  valor,
  onChange,
  desabilitado,
}: {
  ordens: OrdemSetup[]
  equipamentos: Equipamento[]
  valor: ValorSelecao
  onChange: (v: ValorSelecao) => void
  desabilitado?: boolean
}) {
  const [opAberto, setOpAberto] = useState(false)
  const [filtroOp, setFiltroOp] = useState('')

  const ordensFiltradas = useMemo(() => {
    const f = filtroOp.trim().toLowerCase()
    const lista = f ? ordens.filter((o) => `${o.pmo}/${o.op} ${o.cliente}`.toLowerCase().includes(f)) : ordens
    return lista.slice(0, LIMITE_LISTA)
  }, [ordens, filtroOp])

  const ordem = ordens.find((o) => o.pmo === valor.pmo && o.op === valor.op) ?? null
  const rotuloOp = ordem ? `${ordem.pmo}/${ordem.op}${ordem.cliente ? ` · ${ordem.cliente}` : ''}` : ''

  const linhas = useMemo(
    () => [...new Set(equipamentos.filter((e) => e.processo === valor.processo).map((e) => e.linha))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })),
    [equipamentos, valor.processo],
  )
  const maquinas = useMemo(
    () => equipamentos.filter((e) => e.processo === valor.processo && e.linha === valor.linha),
    [equipamentos, valor.processo, valor.linha],
  )
  const rotuloMaquina = valor.processo ? rotulosPosicao(valor.processo).equipamento : 'Máquina/Bloco'

  function escolherOp(o: OrdemSetup) {
    onChange({ ...SELECAO_VAZIA, pmo: o.pmo, op: o.op })
    setOpAberto(false)
    setFiltroOp('')
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex flex-col gap-1.5">
          <Label>OP</Label>
          <Popover open={opAberto} onOpenChange={(o) => { setOpAberto(o); if (!o) setFiltroOp('') }}>
            <PopoverTrigger
              disabled={desabilitado}
              render={
                <button
                  type="button"
                  className="flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className={rotuloOp ? 'truncate' : 'truncate text-muted-foreground'}>{rotuloOp || 'Selecione a OP'}</span>
                  <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
                </button>
              }
            />
            <PopoverContent side="bottom" align="start" sideOffset={4} className="w-[22rem] max-w-[calc(100vw-2rem)] gap-0 p-0">
              <div className="border-b border-border p-1.5">
                <input
                  autoFocus
                  value={filtroOp}
                  onChange={(e) => setFiltroOp(e.target.value)}
                  placeholder="Filtrar por PMO / OP / cliente…"
                  className="h-10 w-full rounded-md border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </div>
              <div className="max-h-72 overflow-y-auto p-1">
                {ordensFiltradas.length === 0 ? (
                  <p className="px-2 py-2 text-sm text-muted-foreground">Nenhuma OP encontrada.</p>
                ) : (
                  ordensFiltradas.map((o) => {
                    const sel = o.pmo === valor.pmo && o.op === valor.op
                    return (
                      <button
                        key={`${o.pmo}||${o.op}`}
                        type="button"
                        onClick={() => escolherOp(o)}
                        className={`flex w-full items-center rounded-md px-2 py-2.5 text-left text-base hover:bg-accent ${sel ? 'bg-accent font-medium' : ''}`}
                      >
                        {o.pmo}/{o.op}{o.cliente ? ` · ${o.cliente}` : ''}
                      </button>
                    )
                  })
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Processo</Label>
          <div className="grid grid-cols-2 gap-2">
            {(['SMD', 'PTH'] as const).map((p) => (
              <button
                key={p}
                type="button"
                disabled={desabilitado || valor.op === ''}
                aria-pressed={valor.processo === p}
                onClick={() => { if (valor.processo !== p) onChange({ ...valor, processo: p, linha: '', equipamento: '' }) }}
                className={`h-11 rounded-lg border text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  valor.processo === p ? 'border-enterplak bg-enterplak text-white' : 'border-input bg-card hover:bg-accent'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Linha</Label>
          <Select
            value={valor.linha || null}
            onValueChange={(v) => onChange({ ...valor, linha: v ?? '', equipamento: '' })}
            disabled={desabilitado || valor.processo === ''}
          >
            <SelectTrigger className={CAMPO}>
              <SelectValue placeholder="Selecione a linha">
                {(v: string | null) => (v ? `Linha ${v}` : 'Selecione a linha')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {linhas.map((l) => (
                <SelectItem key={l} value={l}>Linha {l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{rotuloMaquina}</Label>
          <Select
            value={valor.equipamento || null}
            onValueChange={(v) => onChange({ ...valor, equipamento: v ?? '' })}
            disabled={desabilitado || valor.linha === ''}
          >
            <SelectTrigger className={CAMPO}>
              <SelectValue placeholder={`Selecione ${valor.processo === 'PTH' ? 'o bloco' : 'a máquina'}`}>
                {(v: string | null) =>
                  v && valor.processo ? rotuloEquipamento(valor.processo, v) : `Selecione ${valor.processo === 'PTH' ? 'o bloco' : 'a máquina'}`}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {maquinas.map((e) => (
                <SelectItem key={e.id} value={e.equipamento}>{rotuloEquipamento(e.processo, e.equipamento)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Face</Label>
          <Select
            value={valor.face || null}
            onValueChange={(v) => onChange({ ...valor, face: (v ?? '') as Face | '' })}
            disabled={desabilitado || valor.op === ''}
          >
            <SelectTrigger className={CAMPO}>
              <SelectValue placeholder="Selecione a face">
                {(v: string | null) => v || 'Selecione a face'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {FACES.map((f) => (
                <SelectItem key={f} value={f}>{f}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {ordem && (
        <p className="text-sm text-muted-foreground">
          {ordem.descricao && <span className="text-foreground">{ordem.descricao}</span>}
          {ordem.descricao && ' · '}
          {ordem.snIni && ordem.snFim ? (
            <span>Faixa de SN <span className="font-mono text-foreground">{ordem.snIni} – {ordem.snFim}</span></span>
          ) : (
            <span className="font-medium text-amber-700">OP sem faixa de SN cadastrada</span>
          )}
        </p>
      )}
    </div>
  )
}
