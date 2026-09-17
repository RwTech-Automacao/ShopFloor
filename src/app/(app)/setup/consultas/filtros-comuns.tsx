'use client'

import { useMemo } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { rotuloEquipamento } from '@/modules/setup/domain/tipos'
import type { Equipamento } from '@/modules/setup/infra/setup-repository'

/** Sentinela: o Select não aceita item com value="" (usado internamente para "nenhuma seleção"). */
export const TODOS = '__todos__'

export function fmtData(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Linhas distintas de uma lista de equipamentos (já filtrada por processo, se for o caso), ordenadas numérico-alfabeticamente. */
export function useLinhasOrdenadas(equipamentos: Equipamento[]): string[] {
  return useMemo(
    () => [...new Set(equipamentos.map((e) => e.linha))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })),
    [equipamentos],
  )
}

/** Select de Máquina/Bloco usado nas telas de consulta de Setups e Trocas — `equipamentos` já deve
 * vir filtrado (processo e, opcionalmente, linha) por quem chama, pra não misturar equipamentos de
 * mesmo nome entre SMD e PTH. */
export function SelectMaquina({
  id, label, equipamentos, valor, onChange,
}: {
  id: string
  label: string
  equipamentos: Equipamento[]
  valor: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Select value={valor || TODOS} onValueChange={(v) => onChange(v === TODOS ? '' : String(v))}>
        <SelectTrigger id={id} className="w-40">
          <SelectValue placeholder="Todos">
            {(v: string | null) => {
              if (!v || v === TODOS) return 'Todos'
              const e = equipamentos.find((m) => m.equipamento === v)
              return e ? rotuloEquipamento(e.processo, e.equipamento) : v
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>Todos</SelectItem>
          {equipamentos.map((m) => <SelectItem key={m.id} value={m.equipamento}>{rotuloEquipamento(m.processo, m.equipamento)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}
