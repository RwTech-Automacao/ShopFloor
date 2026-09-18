'use client'

import { useMemo } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Equipamento } from '@/modules/setup/infra/setup-repository'

/** Sentinela: o Select não aceita item com value="" (usado internamente para "nenhuma seleção"). */
export const TODOS = '__todos__'

export function fmtData(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function distintos(valores: (string | null)[]): string[] {
  return [...new Set(valores.filter((v): v is string => v !== null && v !== ''))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
}

/** Linhas distintas de uma lista de equipamentos (já filtrada por processo, se for o caso), ordenadas numérico-alfabeticamente. */
export function useLinhasOrdenadas(equipamentos: Equipamento[]): string[] {
  return useMemo(() => distintos(equipamentos.map((e) => e.linha)), [equipamentos])
}

/** Blocos distintos — quem chama já filtrou por processo e linha. */
export function useBlocosOrdenados(equipamentos: Equipamento[]): string[] {
  return useMemo(() => distintos(equipamentos.map((e) => e.bloco)), [equipamentos])
}

/** Máquinas distintas — quem chama já filtrou por processo, linha e bloco. No PTH volta vazio. */
export function useMaquinasOrdenadas(equipamentos: Equipamento[]): string[] {
  return useMemo(() => distintos(equipamentos.map((e) => e.maquina)), [equipamentos])
}

/** Select de filtro com a opção "Todos"/"Todas" e valor vazio = sem filtro. As opções já vêm
 * restritas pela cascata de quem chama (processo → linha → bloco → máquina), pra não oferecer
 * combinação que não existe cadastrada. */
export function SelectFiltro({
  id, label, opcoes, valor, onChange, rotuloTodos = 'Todos', largura = 'w-32', formatar,
}: {
  id: string
  label: string
  opcoes: string[]
  valor: string
  onChange: (v: string) => void
  rotuloTodos?: string
  largura?: string
  formatar?: (v: string) => string
}) {
  const mostrar = (v: string) => (formatar ? formatar(v) : v)
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Select value={valor || TODOS} onValueChange={(v) => onChange(v === TODOS ? '' : String(v))}>
        <SelectTrigger id={id} className={largura}>
          <SelectValue placeholder={rotuloTodos}>
            {(v: string | null) => (!v || v === TODOS ? rotuloTodos : mostrar(String(v)))}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>{rotuloTodos}</SelectItem>
          {opcoes.map((o) => <SelectItem key={o} value={o}>{mostrar(o)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}
