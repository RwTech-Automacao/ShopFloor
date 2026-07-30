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

const STATUS = [
  { valor: 'aprovado', rotulo: 'Aprovado' },
  { valor: 'reprovado', rotulo: 'Reprovado' },
  { valor: 'sem-status', rotulo: 'Sem status' },
]

// Sentinela: o Select não aceita item com value="" (usado internamente para
// representar "nenhuma seleção"), então usamos um marcador para "Todos".
const TODOS = '__todos__'

interface RegistrosFiltrosProps {
  clientes: string[]
  postos: string[]
}

export function RegistrosFiltros({ clientes, postos }: RegistrosFiltrosProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [cliente, setCliente] = useState(searchParams.get('cliente') ?? '')
  const [busca, setBusca] = useState(searchParams.get('busca') ?? '')
  const [posto, setPosto] = useState(searchParams.get('posto') ?? '')
  const [sn, setSn] = useState(searchParams.get('sn') ?? '')
  const [status, setStatus] = useState(searchParams.get('status') ?? '')
  const [de, setDe] = useState(searchParams.get('de') ?? '')
  const [ate, setAte] = useState(searchParams.get('ate') ?? '')

  function aplicar() {
    const params = new URLSearchParams()
    if (cliente) params.set('cliente', cliente)
    if (busca) params.set('busca', busca)
    if (posto) params.set('posto', posto)
    if (sn) params.set('sn', sn)
    if (status) params.set('status', status)
    if (de) params.set('de', de)
    if (ate) params.set('ate', ate)
    // Nova consulta de filtros reinicia a paginação.
    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname)
  }

  function limpar() {
    setCliente('')
    setBusca('')
    setPosto('')
    setSn('')
    setStatus('')
    setDe('')
    setAte('')
    router.push(pathname)
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-cliente">Cliente</Label>
        <Select
          value={cliente || TODOS}
          onValueChange={(valor) => setCliente(valor === TODOS ? '' : String(valor))}
        >
          <SelectTrigger id="filtro-cliente" className="w-40">
            <SelectValue placeholder="Todos">
              {(value: string | null) => (!value || value === TODOS ? 'Todos' : String(value))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos</SelectItem>
            {clientes.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-busca">OP/PMO</Label>
        <Input
          id="filtro-busca"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-32"
          placeholder="OP ou PMO"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-posto">Posto</Label>
        <Select
          value={posto || TODOS}
          onValueChange={(valor) => setPosto(valor === TODOS ? '' : String(valor))}
        >
          <SelectTrigger id="filtro-posto" className="w-40">
            <SelectValue placeholder="Todos">
              {(value: string | null) => (!value || value === TODOS ? 'Todos' : String(value))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos</SelectItem>
            {postos.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-sn">SN</Label>
        <Input
          id="filtro-sn"
          value={sn}
          onChange={(e) => setSn(e.target.value)}
          className="w-36"
          placeholder="Número de série"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-status">Status</Label>
        <Select
          value={status || TODOS}
          onValueChange={(valor) => setStatus(valor === TODOS ? '' : String(valor))}
        >
          <SelectTrigger id="filtro-status" className="w-36">
            <SelectValue placeholder="Todos">
              {(value: string | null) =>
                !value || value === TODOS
                  ? 'Todos'
                  : (STATUS.find((s) => s.valor === value)?.rotulo ?? String(value))
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos</SelectItem>
            {STATUS.map((item) => (
              <SelectItem key={item.valor} value={item.valor}>
                {item.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-de">De</Label>
        <Input
          id="filtro-de"
          type="date"
          value={de}
          onChange={(e) => setDe(e.target.value)}
          className="w-40"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-ate">Até</Label>
        <Input
          id="filtro-ate"
          type="date"
          value={ate}
          onChange={(e) => setAte(e.target.value)}
          className="w-40"
        />
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
