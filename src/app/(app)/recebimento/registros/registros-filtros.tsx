'use client'

import { useState, type FormEvent } from 'react'
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
import { ETAPAS, ROTULO_ETAPA } from '@/modules/recebimento/domain/etapa-processo'

// Sentinela: o Select não aceita item com value="" (usado internamente para representar "nenhuma
// seleção"), então usamos um marcador para "Todos".
const TODOS = '__todos__'

interface RegistrosFiltrosProps {
  embs: string[]
  fornecedores: string[]
}

export function RegistrosFiltros({ embs, fornecedores }: RegistrosFiltrosProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [emb, setEmb] = useState(searchParams.get('emb') ?? '')
  const [item, setItem] = useState(searchParams.get('item') ?? '')
  const [fornecedor, setFornecedor] = useState(searchParams.get('fornecedor') ?? '')
  const [etapa, setEtapa] = useState(searchParams.get('etapa') ?? '')
  const [de, setDe] = useState(searchParams.get('de') ?? '')
  const [ate, setAte] = useState(searchParams.get('ate') ?? '')
  const [colaborador, setColaborador] = useState(searchParams.get('colaborador') ?? '')

  function aplicar() {
    const params = new URLSearchParams()
    if (emb) params.set('emb', emb)
    if (item) params.set('item', item)
    if (fornecedor) params.set('fornecedor', fornecedor)
    if (etapa) params.set('etapa', etapa)
    if (de) params.set('de', de)
    if (ate) params.set('ate', ate)
    if (colaborador) params.set('colaborador', colaborador)
    // "Por página" é preferência de exibição, não filtro: sobrevive à nova consulta.
    const tamanho = searchParams.get('tamanho')
    if (tamanho) params.set('tamanho', tamanho)
    // Nova consulta de filtros reinicia a paginação (o parâmetro `pagina` não é copiado).
    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname)
  }

  // Enter em qualquer campo filtra — é como o pessoal usa (digita o item e aperta Enter).
  function aoEnviar(e: FormEvent) {
    e.preventDefault()
    aplicar()
  }

  function limpar() {
    setEmb('')
    setItem('')
    setFornecedor('')
    setEtapa('')
    setDe('')
    setAte('')
    setColaborador('')
    const tamanho = searchParams.get('tamanho')
    router.push(tamanho ? `${pathname}?tamanho=${tamanho}` : pathname)
  }

  return (
    <form
      onSubmit={aoEnviar}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3"
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-emb">EMB</Label>
        <Select value={emb || TODOS} onValueChange={(v) => setEmb(v === TODOS ? '' : String(v))}>
          <SelectTrigger id="filtro-emb" className="w-40">
            <SelectValue placeholder="Todas">
              {(value: string | null) => (!value || value === TODOS ? 'Todas' : String(value))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas</SelectItem>
            {embs.map((e) => (
              <SelectItem key={e} value={e}>
                {e}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-item">Item</Label>
        <Input
          id="filtro-item"
          value={item}
          onChange={(e) => setItem(e.target.value)}
          className="w-36"
          placeholder="Código do material"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-fornecedor">Fornecedor</Label>
        <Select
          value={fornecedor || TODOS}
          onValueChange={(v) => setFornecedor(v === TODOS ? '' : String(v))}
        >
          <SelectTrigger id="filtro-fornecedor" className="w-48">
            <SelectValue placeholder="Todos">
              {(value: string | null) => (!value || value === TODOS ? 'Todos' : String(value))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos</SelectItem>
            {fornecedores.map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-etapa">Etapa</Label>
        {/* Filtra pela caixa em que o item FICOU depois do registro. */}
        <Select value={etapa || TODOS} onValueChange={(v) => setEtapa(v === TODOS ? '' : String(v))}>
          <SelectTrigger id="filtro-etapa" className="w-48">
            <SelectValue placeholder="Todas">
              {(value: string | null) =>
                !value || value === TODOS
                  ? 'Todas'
                  : (ROTULO_ETAPA[value as keyof typeof ROTULO_ETAPA] ?? String(value))
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas</SelectItem>
            {ETAPAS.map((e) => (
              <SelectItem key={e} value={e}>
                {ROTULO_ETAPA[e]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-de">De</Label>
        <Input id="filtro-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-40" />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-ate">Até</Label>
        <Input id="filtro-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="w-40" />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-colaborador">Colaborador</Label>
        <Input
          id="filtro-colaborador"
          value={colaborador}
          onChange={(e) => setColaborador(e.target.value)}
          className="w-40"
          placeholder="Nome"
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" className="bg-enterplak hover:bg-enterplak-700">
          Filtrar
        </Button>
        <Button type="button" variant="outline" onClick={limpar}>
          Limpar
        </Button>
      </div>
    </form>
  )
}
