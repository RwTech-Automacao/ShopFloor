'use client'

import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Sentinela: o Select não aceita item com value="" (usado internamente para
// representar "nenhuma seleção"), então usamos um marcador para "Todos".
const TODOS = '__todos__'

interface ProcessosFiltrosProps {
  statusOpcoes: { valor: string; rotulo: string }[]
}

export function ProcessosFiltros({ statusOpcoes }: ProcessosFiltrosProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [busca, setBusca] = useState(searchParams.get('busca') ?? '')
  const [status, setStatus] = useState(searchParams.get('status') ?? '')

  function aplicar() {
    const params = new URLSearchParams()
    if (busca) params.set('busca', busca)
    if (status) params.set('status', status)
    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname)
  }

  function limpar() {
    setBusca('')
    setStatus('')
    router.push(pathname)
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-busca">Busca</Label>
        <Input
          id="filtro-busca"
          placeholder="Nº NF, pedido, fornecedor, material..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') aplicar()
          }}
          className="w-64"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-status">Status</Label>
        <Select
          value={status || TODOS}
          onValueChange={(valor) => setStatus(valor === TODOS ? '' : String(valor))}
        >
          <SelectTrigger id="filtro-status" className="w-44">
            <SelectValue placeholder="Todos">
              {(value: string | null) =>
                !value || value === TODOS
                  ? 'Todos'
                  : (statusOpcoes.find((s) => s.valor === value)?.rotulo ?? String(value))
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos</SelectItem>
            {statusOpcoes.map((item) => (
              <SelectItem key={item.valor} value={item.valor}>
                {item.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2">
        <Button onClick={aplicar} className="bg-enterplak hover:bg-enterplak-700">
          Filtrar
        </Button>
        <Button variant="outline" onClick={limpar}>
          Limpar
        </Button>
      </div>
    </div>
  )
}
