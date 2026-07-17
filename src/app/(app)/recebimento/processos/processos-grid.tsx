'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowDownAZIcon, ArrowRightIcon, ArrowUpAZIcon, FilterIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { carregarValoresColuna } from '@/modules/recebimento/application/carregar-processos-grid'
import { rotuloMes } from '@/modules/recebimento/domain/agrupamento-mes'
import {
  TAMANHOS_PAGINA,
  codificarEstadoGrid,
  rotulosOrdenacao,
  type EstadoGrid,
  type FiltroColuna,
} from '@/modules/recebimento/domain/estado-grid'
import { rotuloStatusProcesso } from '@/modules/recebimento/domain/status-processo'
import type { ColunaGrid } from '@/modules/recebimento/infra/processo-repository'
import { ScrollHorizontalTopo } from './scroll-horizontal-topo'

interface ProcessosGridProps {
  colunas: ColunaGrid[]
  linhas: Record<string, unknown>[]
  total: number
  estado: EstadoGrid
}

/** Texto de uma célula. Status vira Badge; data vira dd/mm/aaaa; o resto é o valor cru. */
function celula(coluna: ColunaGrid, valor: unknown): React.ReactNode {
  if (valor === null || valor === undefined || valor === '') return '—'
  if (coluna.campo === 'status') {
    const s = rotuloStatusProcesso(String(valor))
    return <Badge className={s.className}>{s.rotulo}</Badge>
  }
  // Data vem como 'YYYY-MM-DD' do Postgres. Reordena os pedaços em vez de usar
  // `new Date()` — evita o deslocamento de fuso que já nos mordeu antes.
  if (coluna.tipo === 'data') {
    const partes = String(valor).slice(0, 10).split('-')
    return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : String(valor)
  }
  return String(valor)
}

export function ProcessosGrid({ colunas, linhas, total, estado }: ProcessosGridProps) {
  const router = useRouter()
  const [navegando, startNavegacao] = useTransition()

  function aplicar(novo: EstadoGrid) {
    startNavegacao(() => {
      const params = new URLSearchParams({ g: codificarEstadoGrid(novo) })
      router.push(`/recebimento/processos?${params.toString()}`)
    })
  }

  const primeira = total === 0 ? 0 : estado.pagina * estado.tamanho + 1
  const ultima = Math.min((estado.pagina + 1) * estado.tamanho, total)
  const temProxima = ultima < total

  return (
    <div className="flex flex-col gap-3">
      <div className="hidden lg:block">
        <ScrollHorizontalTopo>
          <Table className="text-xs [&_:is(th,td)]:px-2.5 [&_:is(th,td)]:whitespace-nowrap">
            <TableHeader>
              <TableRow>
                {colunas.map((coluna) => (
                  <TableHead key={coluna.campo}>
                    <MenuColuna
                      coluna={coluna}
                      estado={estado}
                      onAplicar={aplicar}
                      ativo={Boolean(estado.filtros[coluna.campo])}
                      ordenando={estado.ordenar === coluna.campo}
                      direcao={estado.direcao}
                    />
                  </TableHead>
                ))}
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={colunas.length + 1} className="py-6 text-center text-muted-foreground">
                    Nenhum processo encontrado para os filtros aplicados.
                  </TableCell>
                </TableRow>
              )}
              {linhas.map((linha, i) => {
                // O detalhe precisa saber de onde você veio: `g` = estado do grid
                // (ordem+filtros) e `i` = a posição global da linha na lista filtrada.
                const q = new URLSearchParams({
                  g: codificarEstadoGrid(estado),
                  i: String(estado.pagina * estado.tamanho + i),
                })
                return (
                  <TableRow key={String(linha.id)}>
                    {colunas.map((coluna) => (
                      <TableCell key={coluna.campo}>{celula(coluna, linha[coluna.campo])}</TableCell>
                    ))}
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Abrir processo #${String(linha.numero ?? '')}`}
                        render={
                          <Link href={`/recebimento/processos/${String(linha.id)}?${q.toString()}`} />
                        }
                      >
                        <ArrowRightIcon />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </ScrollHorizontalTopo>
      </div>

      <div className="flex flex-col gap-3 lg:hidden">
        {/* Barra de chips: os mesmos menus de coluna do desktop, em pílula */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {colunas.map((coluna) => (
            <MenuColuna
              key={coluna.campo}
              coluna={coluna}
              estado={estado}
              onAplicar={aplicar}
              ativo={Boolean(estado.filtros[coluna.campo])}
              ordenando={estado.ordenar === coluna.campo}
              direcao={estado.direcao}
              comoChip
            />
          ))}
        </div>

        {linhas.length === 0 && (
          <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
            Nenhum processo encontrado para os filtros aplicados.
          </p>
        )}
        {linhas.map((linha, i) => (
          <CardProcesso key={String(linha.id)} linha={linha} colunas={colunas} estado={estado} indice={i} />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">
          {total === 0 ? 'Nenhum processo' : `Mostrando ${primeira}–${ultima} de ${total}`}
        </span>
        <div className="flex items-center gap-2">
          <select
            aria-label="Linhas por página"
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            value={estado.tamanho}
            onChange={(e) => aplicar({ ...estado, tamanho: Number(e.target.value), pagina: 0 })}
          >
            {TAMANHOS_PAGINA.map((t) => (
              <option key={t} value={t}>
                {t} por página
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            disabled={estado.pagina === 0 || navegando}
            onClick={() => aplicar({ ...estado, pagina: estado.pagina - 1 })}
          >
            Anterior
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!temProxima || navegando}
            onClick={() => aplicar({ ...estado, pagina: estado.pagina + 1 })}
          >
            Próxima
          </Button>
        </div>
      </div>
    </div>
  )
}

interface MenuColunaProps {
  coluna: ColunaGrid
  estado: EstadoGrid
  ativo: boolean
  ordenando: boolean
  direcao: 'asc' | 'desc'
  onAplicar: (estado: EstadoGrid) => void
  comoChip?: boolean
}

/**
 * Cabeçalho da coluna com o menu estilo Excel: ordenar A→Z / Z→A, busca por texto e lista
 * de valores com checkbox. Os valores distintos são buscados sob demanda (só ao abrir o
 * menu) — em coluna de data eles são MESES, exibidos com `rotuloMes`.
 */
function MenuColuna({ coluna, estado, ativo, ordenando, direcao, onAplicar, comoChip }: MenuColunaProps) {
  const filtroAtual: FiltroColuna = estado.filtros[coluna.campo] ?? {}
  const [texto, setTexto] = useState(filtroAtual.texto ?? '')
  const [marcados, setMarcados] = useState<string[]>(filtroAtual.valores ?? [])
  const [valores, setValores] = useState<string[] | null>(null)
  const [busca, setBusca] = useState('')
  const [carregando, startCarga] = useTransition()

  function aoAbrir(aberto: boolean) {
    if (!aberto || valores !== null) return
    startCarga(async () => {
      const r = await carregarValoresColuna(coluna.campo)
      setValores(r.ok ? r.valores : [])
    })
  }

  function ordenar(dir: 'asc' | 'desc') {
    onAplicar({ ...estado, ordenar: coluna.campo, direcao: dir, pagina: 0 })
  }

  function aplicarFiltro() {
    const filtros = { ...estado.filtros }
    const filtro: FiltroColuna = {}
    if (texto.trim() !== '') filtro.texto = texto.trim()
    if (marcados.length > 0) filtro.valores = marcados
    if (filtro.texto === undefined && filtro.valores === undefined) delete filtros[coluna.campo]
    else filtros[coluna.campo] = filtro
    onAplicar({ ...estado, filtros, pagina: 0 })
  }

  function limpar() {
    const filtros = { ...estado.filtros }
    delete filtros[coluna.campo]
    setTexto('')
    setMarcados([])
    onAplicar({ ...estado, filtros, pagina: 0 })
  }

  const listados = (valores ?? []).filter((v) =>
    busca.trim() === '' ? true : rotulo(coluna, v).toLowerCase().includes(busca.trim().toLowerCase()),
  )

  // `.ilike` só existe para texto. Colunas numero (bigint) e data (date) filtram
  // pelo checkbox — oferecer busca nelas geraria erro 400 no banco.
  const buscaTextual = coluna.tipo === 'texto' || coluna.tipo === 'lista'

  // "A a Z" não diz nada numa coluna de Número ou Data — o rótulo segue o tipo.
  const rotulos = rotulosOrdenacao(coluna.tipo)

  return (
    <Popover onOpenChange={aoAbrir}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={
              comoChip
                ? `inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] ${
                    ativo || ordenando
                      ? 'border-enterplak bg-enterplak-50 text-enterplak'
                      : 'border-border hover:bg-muted'
                  }`
                : 'flex items-center gap-1 font-medium hover:text-enterplak'
            }
          >
            {coluna.rotulo}
            {ordenando && (direcao === 'asc' ? <ArrowUpAZIcon className="size-3.5" /> : <ArrowDownAZIcon className="size-3.5" />)}
            <FilterIcon className={ativo ? 'size-3 text-enterplak' : 'size-3 opacity-40'} />
          </button>
        }
      />
      <PopoverContent className="w-64 p-0" align="start">
        <div className="flex flex-col">
          <button type="button" className="px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => ordenar('asc')}>
            ↑ {rotulos.asc}
          </button>
          <button type="button" className="px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => ordenar('desc')}>
            ↓ {rotulos.desc}
          </button>
          <div className="border-t border-border" />
          {buscaTextual && (
            <>
              <div className="p-2">
                <Input
                  placeholder="Buscar nesta coluna..."
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') aplicarFiltro()
                  }}
                  className="h-8"
                />
              </div>
              <div className="border-t border-border" />
            </>
          )}
          <div className="max-h-56 overflow-y-auto p-2">
            <Input
              placeholder="Filtrar valores..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="mb-2 h-7 text-xs"
            />
            {carregando && <p className="px-1 py-2 text-xs text-muted-foreground">Carregando…</p>}
            {!carregando && listados.length === 0 && (
              <p className="px-1 py-2 text-xs text-muted-foreground">Nenhum valor.</p>
            )}
            {listados.map((valor) => (
              <label key={valor} className="flex items-center gap-2 px-1 py-1 text-sm">
                <Checkbox
                  checked={marcados.includes(valor)}
                  onCheckedChange={(marcado) =>
                    setMarcados((atual) =>
                      marcado ? [...atual, valor] : atual.filter((v) => v !== valor),
                    )
                  }
                />
                <span className="truncate">{rotulo(coluna, valor)}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-between gap-2 border-t border-border p-2">
            <Button variant="outline" size="sm" onClick={limpar}>
              Limpar
            </Button>
            <Button size="sm" className="bg-enterplak hover:bg-enterplak-700" onClick={aplicarFiltro}>
              Aplicar
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Rótulo de um valor no checkbox do filtro. Em coluna de data o valor é um MÊS
 *  ('YYYY-MM'/'sem_data') → 'Julho/2026'. Em status, usa o mesmo rótulo em pt-BR
 *  que a célula exibe — senão o menu e a tabela falariam vocabulários diferentes. */
function rotulo(coluna: ColunaGrid, valor: string): string {
  if (coluna.tipo === 'data') return rotuloMes(valor)
  if (coluna.campo === 'status') return rotuloStatusProcesso(valor).rotulo
  return valor
}

const CAP_COLUNAS_CARD = 6

/**
 * Um processo como card (celular/tablet em pé). Nº como título + Status como badge; as
 * demais colunas visíveis viram uma lista `rótulo···valor` com tracejado, com teto de 6 +
 * "ver mais". O card inteiro é o mesmo link da seta da tabela (leva `?g=&i=`).
 */
function CardProcesso({
  linha,
  colunas,
  estado,
  indice,
}: {
  linha: Record<string, unknown>
  colunas: ColunaGrid[]
  estado: EstadoGrid
  indice: number
}) {
  const [expandido, setExpandido] = useState(false)
  const status = rotuloStatusProcesso(String(linha.status ?? ''))
  const demais = colunas.filter((c) => c.campo !== 'numero' && c.campo !== 'status')
  const visiveis = expandido ? demais : demais.slice(0, CAP_COLUNAS_CARD)
  const ocultas = demais.length - CAP_COLUNAS_CARD

  const q = new URLSearchParams({
    g: codificarEstadoGrid(estado),
    i: String(estado.pagina * estado.tamanho + indice),
  })

  return (
    <Link
      href={`/recebimento/processos/${String(linha.id)}?${q.toString()}`}
      className="block rounded-lg border border-border bg-card p-4 hover:border-enterplak"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">Nº {String(linha.numero ?? '—')}</span>
        <Badge className={status.className}>{status.rotulo}</Badge>
      </div>
      <dl className="mt-3 flex flex-col gap-1.5">
        {visiveis.map((coluna) => (
          <div key={coluna.campo} className="flex items-baseline gap-1.5">
            <dt className="whitespace-nowrap text-sm text-muted-foreground">{coluna.rotulo}</dt>
            <span
              aria-hidden
              className="min-w-4 flex-1 -translate-y-1 border-b border-dotted border-border"
            />
            <dd className="max-w-[55%] truncate text-sm font-medium">
              {celula(coluna, linha[coluna.campo])}
            </dd>
          </div>
        ))}
      </dl>
      {ocultas > 0 && (
        <button
          type="button"
          className="mt-2 text-sm font-medium text-enterplak hover:underline"
          onClick={(e) => {
            // Não navegar: o card é um link, mas este botão só expande.
            e.preventDefault()
            setExpandido((v) => !v)
          }}
        >
          {expandido ? '− ver menos' : `+ ver mais ${ocultas} colunas`}
        </button>
      )}
    </Link>
  )
}
