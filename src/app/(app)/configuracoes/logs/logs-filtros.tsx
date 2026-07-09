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

// Lista de entidades logadas hoje (Tasks 1-6). `entidade` é texto livre no
// banco (sem enum), então isso é apenas o conjunto conhecido para o filtro.
const ENTIDADES = [
  { valor: 'usuario', rotulo: 'Usuário' },
  { valor: 'perfil', rotulo: 'Perfil' },
  { valor: 'lista', rotulo: 'Lista' },
  { valor: 'campo', rotulo: 'Campo' },
]

const ACOES = [
  { valor: 'criar', rotulo: 'Criar' },
  { valor: 'importar', rotulo: 'Importar' },
  { valor: 'alterar_campo', rotulo: 'Alterar campo' },
  { valor: 'mudar_status', rotulo: 'Mudar status' },
  { valor: 'gerar_etiqueta', rotulo: 'Gerar etiqueta' },
  { valor: 'excluir', rotulo: 'Excluir' },
  { valor: 'login', rotulo: 'Login' },
]

// Sentinela: o Select não aceita item com value="" (usado internamente para
// representar "nenhuma seleção"), então usamos um marcador para "Todas".
const TODOS = '__todos__'

export function LogsFiltros() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [entidade, setEntidade] = useState(searchParams.get('entidade') ?? '')
  const [acao, setAcao] = useState(searchParams.get('acao') ?? '')
  const [de, setDe] = useState(searchParams.get('de') ?? '')
  const [ate, setAte] = useState(searchParams.get('ate') ?? '')

  function aplicar() {
    const params = new URLSearchParams()
    if (entidade) params.set('entidade', entidade)
    if (acao) params.set('acao', acao)
    if (de) params.set('de', de)
    if (ate) params.set('ate', ate)
    // Nova consulta de filtros reinicia a paginação.
    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname)
  }

  function limpar() {
    setEntidade('')
    setAcao('')
    setDe('')
    setAte('')
    router.push(pathname)
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-entidade">Entidade</Label>
        <Select
          value={entidade || TODOS}
          onValueChange={(valor) => setEntidade(valor === TODOS ? '' : String(valor))}
        >
          <SelectTrigger id="filtro-entidade" className="w-40">
            <SelectValue placeholder="Todas">
              {(value: string | null) =>
                !value || value === TODOS
                  ? 'Todas'
                  : (ENTIDADES.find((e) => e.valor === value)?.rotulo ?? String(value))
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas</SelectItem>
            {ENTIDADES.map((item) => (
              <SelectItem key={item.valor} value={item.valor}>
                {item.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-acao">Ação</Label>
        <Select
          value={acao || TODOS}
          onValueChange={(valor) => setAcao(valor === TODOS ? '' : String(valor))}
        >
          <SelectTrigger id="filtro-acao" className="w-44">
            <SelectValue placeholder="Todas">
              {(value: string | null) =>
                !value || value === TODOS
                  ? 'Todas'
                  : (ACOES.find((a) => a.valor === value)?.rotulo ?? String(value))
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas</SelectItem>
            {ACOES.map((item) => (
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
