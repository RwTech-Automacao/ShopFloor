'use client'

import { useMemo, useState, useTransition } from 'react'
import { ArrowDownAZIcon, ArrowUpAZIcon, FilterIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { buscarEtiquetas, gerarEtiquetas } from '@/modules/etiquetas/application/gerar-etiquetas'
import {
  SUB_FILTRO_PADRAO,
  aplicarSubFiltro,
  valoresDistintosSub,
  type Acessor,
  type SubFiltroEtiquetas,
} from '@/modules/etiquetas/domain/sub-filtro'
import {
  elegivelParaEtiqueta,
  gerarEtiquetasDoProcesso,
  type MotivoInelegivel,
  type ProcessoEtiqueta,
} from '@/modules/etiquetas/domain/partnumber'
import type {
  FiltroTipoEtiqueta,
  ProcessoEtiquetaLista,
} from '@/modules/etiquetas/infra/etiqueta-repository'
import { rotuloStatusProcesso } from '@/modules/recebimento/domain/status-processo'
import { Badge } from '@/components/ui/badge'

const TIPOS: { valor: FiltroTipoEtiqueta; rotulo: string }[] = [
  { valor: 'nf', rotulo: 'Nº NF' },
  { valor: 'emb', rotulo: 'Nº embarque' },
  { valor: 'fornecedor', rotulo: 'Fornecedor' },
]

const ROTULO_MOTIVO: Record<MotivoInelegivel, string> = {
  aguardando: 'Aguardando conferência',
  incompleto: 'Campos incompletos para etiqueta',
}

/** Prévia do 1º Part Number do processo, calculada no cliente com o mesmo
 * domínio (`gerarEtiquetasDoProcesso`) usado autoritativamente pelo servidor
 * em `gerarEtiquetas` — garante que a prévia mostrada bate com o resultado
 * do CSV gerado. */
function previaPartNumber(processo: ProcessoEtiqueta): string {
  const { incompleto, etiquetas } = gerarEtiquetasDoProcesso(processo)
  if (incompleto || !etiquetas[0]) return '— incompleto —'
  return etiquetas[0].partNumber
}

function dispararDownload(csv: string, fileName: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

/** Colunas do sub-filtro e como ler o valor de cada uma numa linha. `numero`
 *  devolve number (ordena numericamente); `doc` é derivado (DI/INPI ou NF). */
const ACESSORES = {
  numero: (p: ProcessoEtiquetaLista) => p.numero,
  status: (p: ProcessoEtiquetaLista) => p.status,
  codigoMaterial: (p: ProcessoEtiquetaLista) => p.codigoMaterial ?? '',
  numeroPedido: (p: ProcessoEtiquetaLista) => p.numeroPedido ?? '',
  doc: (p: ProcessoEtiquetaLista) => p.diInpi || p.numeroNf || '',
} satisfies Record<string, Acessor<ProcessoEtiquetaLista>>

export function EtiquetasCliente() {
  const [tipo, setTipo] = useState<FiltroTipoEtiqueta>('nf')
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState<ProcessoEtiquetaLista[] | null>(null)
  const [erroBusca, setErroBusca] = useState<string | null>(null)
  const [buscando, startBusca] = useTransition()

  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())

  const [erroGeracao, setErroGeracao] = useState<string | null>(null)
  const [mensagemGeracao, setMensagemGeracao] = useState<string | null>(null)
  const [gerando, startGeracao] = useTransition()

  const [subFiltro, setSubFiltro] = useState<SubFiltroEtiquetas>(SUB_FILTRO_PADRAO)

  /** Linhas exibidas = resultado da busca principal com o sub-filtro aplicado. */
  const linhasVisiveis = useMemo(
    () => aplicarSubFiltro(resultados ?? [], subFiltro, ACESSORES),
    [resultados, subFiltro],
  )

  /** Valores distintos por coluna (dos resultados carregados), para o checkbox. */
  const valoresPorColuna = useMemo(
    () => ({
      numero: valoresDistintosSub(resultados ?? [], ACESSORES.numero),
      status: valoresDistintosSub(resultados ?? [], ACESSORES.status),
      codigoMaterial: valoresDistintosSub(resultados ?? [], ACESSORES.codigoMaterial),
      numeroPedido: valoresDistintosSub(resultados ?? [], ACESSORES.numeroPedido),
      doc: valoresDistintosSub(resultados ?? [], ACESSORES.doc),
    }),
    [resultados],
  )

  const previas = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const processo of resultados ?? []) mapa.set(processo.id, previaPartNumber(processo))
    return mapa
  }, [resultados])

  const elegibilidades = useMemo(() => {
    const mapa = new Map<string, { elegivel: boolean; motivo: MotivoInelegivel | null }>()
    for (const processo of resultados ?? []) mapa.set(processo.id, elegivelParaEtiqueta(processo))
    return mapa
  }, [resultados])

  function buscar() {
    setErroBusca(null)
    setMensagemGeracao(null)
    setErroGeracao(null)
    startBusca(async () => {
      const res = await buscarEtiquetas(tipo, termo)
      if (res.ok) {
        setResultados(res.processos)
        setSelecionados(new Set())
        setSubFiltro(SUB_FILTRO_PADRAO)
      } else {
        setResultados(null)
        setErroBusca(res.erro)
      }
    })
  }

  function alternarSelecao(id: string, marcado: boolean) {
    setSelecionados((atual) => {
      const proximo = new Set(atual)
      if (marcado) proximo.add(id)
      else proximo.delete(id)
      return proximo
    })
  }

  function selecionarTodosElegiveis() {
    const elegiveis = linhasVisiveis.filter((p) => elegibilidades.get(p.id)?.elegivel)
    setSelecionados(new Set(elegiveis.map((p) => p.id)))
  }

  function limparSelecao() {
    setSelecionados(new Set())
  }

  function gerar() {
    setErroGeracao(null)
    setMensagemGeracao(null)
    startGeracao(async () => {
      const res = await gerarEtiquetas({
        processoIds: Array.from(selecionados),
        filtroTipo: tipo,
        filtroValor: termo,
      })
      if (res.ok) {
        dispararDownload(res.csv, res.fileName)
        const partes = [`Geradas ${res.totalEtiquetas} etiqueta(s) de ${res.totalProcessos} processo(s).`]
        if (res.ignorados > 0) partes.push(`${res.ignorados} processo(s) ignorado(s) por dados incompletos.`)
        setMensagemGeracao(partes.join(' '))
        setSelecionados(new Set())
      } else {
        setErroGeracao(res.erro)
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
        <div className="flex flex-col gap-1">
          <Label>Buscar por</Label>
          <div className="flex items-center gap-4 pt-1">
            {TIPOS.map((item) => (
              <label key={item.valor} className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="tipo-busca"
                  value={item.valor}
                  checked={tipo === item.valor}
                  onChange={() => setTipo(item.valor)}
                  className="accent-enterplak"
                />
                {item.rotulo}
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="termo-busca">Termo</Label>
          <Input
            id="termo-busca"
            placeholder="Digite para filtrar (vazio traz os mais recentes)"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') buscar()
            }}
            className="w-72"
          />
        </div>

        <Button onClick={buscar} disabled={buscando} className="bg-enterplak hover:bg-enterplak-700">
          {buscando ? 'Buscando...' : 'Buscar'}
        </Button>
      </div>

      {erroBusca && <p className="text-sm text-red-600">{erroBusca}</p>}

      {resultados !== null && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={selecionarTodosElegiveis}>
                Selecionar todos (elegíveis)
              </Button>
              <Button variant="outline" size="sm" onClick={limparSelecao}>
                Limpar seleção
              </Button>
            </div>
            <span className="text-sm text-muted-foreground">
              {selecionados.size} selecionado(s) de {linhasVisiveis.length} visível(is)
            </span>
          </div>

          {/* Desktop: tabela */}
          <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>
                    <MenuColunaEtiqueta campo="numero" rotulo="Nº" valores={valoresPorColuna.numero} subFiltro={subFiltro} onAplicar={setSubFiltro} />
                  </TableHead>
                  <TableHead>
                    <MenuColunaEtiqueta campo="status" rotulo="Status" valores={valoresPorColuna.status} rotuloValor={(v) => rotuloStatusProcesso(v).rotulo} subFiltro={subFiltro} onAplicar={setSubFiltro} />
                  </TableHead>
                  <TableHead>
                    <MenuColunaEtiqueta campo="codigoMaterial" rotulo="Código" valores={valoresPorColuna.codigoMaterial} subFiltro={subFiltro} onAplicar={setSubFiltro} />
                  </TableHead>
                  <TableHead>
                    <MenuColunaEtiqueta campo="numeroPedido" rotulo="Pedido" valores={valoresPorColuna.numeroPedido} subFiltro={subFiltro} onAplicar={setSubFiltro} />
                  </TableHead>
                  <TableHead>
                    <MenuColunaEtiqueta campo="doc" rotulo="Doc" valores={valoresPorColuna.doc} subFiltro={subFiltro} onAplicar={setSubFiltro} />
                  </TableHead>
                  <TableHead>Volumes</TableHead>
                  <TableHead>Prévia (1º Part Number)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhasVisiveis.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      Nenhum processo encontrado para os filtros selecionados.
                    </TableCell>
                  </TableRow>
                )}
                {linhasVisiveis.map((processo) => {
                  const elegib = elegibilidades.get(processo.id) ?? {
                    elegivel: false,
                    motivo: 'incompleto' as MotivoInelegivel,
                  }
                  const status = rotuloStatusProcesso(processo.status)
                  const textoPrevia = elegib.elegivel
                    ? (previas.get(processo.id) ?? '')
                    : ROTULO_MOTIVO[elegib.motivo!]
                  return (
                    <TableRow key={processo.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Selecionar processo ${processo.codigoMaterial ?? processo.id}`}
                          checked={selecionados.has(processo.id)}
                          disabled={!elegib.elegivel}
                          onChange={(e) => alternarSelecao(processo.id, e.target.checked)}
                          className="accent-enterplak"
                        />
                      </TableCell>
                      <TableCell>{processo.numero}</TableCell>
                      <TableCell>
                        <Badge className={status.className}>{status.rotulo}</Badge>
                      </TableCell>
                      <TableCell>{processo.codigoMaterial || '—'}</TableCell>
                      <TableCell>{processo.numeroPedido || '—'}</TableCell>
                      <TableCell>{processo.diInpi || processo.numeroNf || '—'}</TableCell>
                      <TableCell>{processo.volumes ?? '—'}</TableCell>
                      <TableCell
                        className={!elegib.elegivel ? 'text-muted-foreground italic' : 'font-mono text-xs'}
                      >
                        {textoPrevia}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: cards */}
          <div className="space-y-3 md:hidden">
            {linhasVisiveis.length === 0 && (
              <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
                Nenhum processo encontrado para os filtros selecionados.
              </p>
            )}
            {linhasVisiveis.map((processo) => {
              const elegib = elegibilidades.get(processo.id) ?? {
                elegivel: false,
                motivo: 'incompleto' as MotivoInelegivel,
              }
              const status = rotuloStatusProcesso(processo.status)
              const textoPrevia = elegib.elegivel
                ? (previas.get(processo.id) ?? '')
                : ROTULO_MOTIVO[elegib.motivo!]
              return (
                <div key={processo.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar processo ${processo.codigoMaterial ?? processo.id}`}
                      checked={selecionados.has(processo.id)}
                      disabled={!elegib.elegivel}
                      onChange={(e) => alternarSelecao(processo.id, e.target.checked)}
                      className="mt-1 accent-enterplak"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">#{processo.numero}</span>
                      </div>
                      <dl className="mt-2 space-y-1.5 text-sm">
                        <div className="flex gap-2">
                          <dt className="w-28 shrink-0 text-muted-foreground">Status</dt>
                          <dd className="min-w-0 flex-1">
                            <Badge className={status.className}>{status.rotulo}</Badge>
                          </dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-28 shrink-0 text-muted-foreground">Código</dt>
                          <dd className="min-w-0 flex-1">{processo.codigoMaterial || '—'}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-28 shrink-0 text-muted-foreground">Pedido</dt>
                          <dd className="min-w-0 flex-1">{processo.numeroPedido || '—'}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-28 shrink-0 text-muted-foreground">Doc</dt>
                          <dd className="min-w-0 flex-1">{processo.diInpi || processo.numeroNf || '—'}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-28 shrink-0 text-muted-foreground">Volumes</dt>
                          <dd className="min-w-0 flex-1">{processo.volumes ?? '—'}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-28 shrink-0 text-muted-foreground">Prévia</dt>
                          <dd
                            className={
                              !elegib.elegivel
                                ? 'min-w-0 flex-1 text-muted-foreground italic'
                                : 'min-w-0 flex-1 font-mono text-xs'
                            }
                          >
                            {textoPrevia}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex flex-col items-start gap-2">
            <Button
              onClick={gerar}
              disabled={gerando || selecionados.size === 0}
              className="bg-enterplak hover:bg-enterplak-700"
            >
              {gerando ? 'Gerando...' : 'Gerar etiquetas (CSV)'}
            </Button>
            {mensagemGeracao && <p className="text-sm text-emerald-700">{mensagemGeracao}</p>}
            {erroGeracao && <p className="text-sm text-red-600">{erroGeracao}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

interface MenuColunaEtiquetaProps {
  campo: string
  rotulo: string
  valores: string[]
  /** Como exibir um valor no checkbox (ex.: status em pt-BR). Padrão: o próprio valor. */
  rotuloValor?: (valor: string) => string
  subFiltro: SubFiltroEtiquetas
  onAplicar: (novo: SubFiltroEtiquetas) => void
}

/** Fallback estável para "sem filtro aplicado nesta coluna". Precisa ser a MESMA
 *  referência em todo render (em vez de um `{}` recriado a cada chamada), senão
 *  a ressincronização abaixo dispararia a cada digitação. */
const FILTRO_COLUNA_VAZIO: { texto?: string; valores?: string[] } = {}

/** Cabeçalho de coluna com menu estilo Excel (ordenar A→Z/Z→A, busca por texto,
 *  checkbox de valores). Client-side: os `valores` vêm das linhas já carregadas. */
function MenuColunaEtiqueta({ campo, rotulo, valores, rotuloValor, subFiltro, onAplicar }: MenuColunaEtiquetaProps) {
  const filtroAtual = subFiltro.filtros[campo] ?? FILTRO_COLUNA_VAZIO
  const [texto, setTexto] = useState(filtroAtual.texto ?? '')
  const [marcados, setMarcados] = useState<string[]>(filtroAtual.valores ?? [])
  const [busca, setBusca] = useState('')

  // Ressincroniza com o filtro APLICADO da coluna quando ele muda por fora
  // (reset de busca, Aplicar/Limpar de outro menu). Ajuste de estado durante
  // a renderização (padrão recomendado pelo React em vez de useEffect) para
  // não disparar um setState síncrono dentro de um efeito: só corrige quando
  // o objeto de filtro aplicado muda, preservando a digitação em andamento.
  const [filtroSincronizado, setFiltroSincronizado] = useState(filtroAtual)
  if (filtroSincronizado !== filtroAtual) {
    setFiltroSincronizado(filtroAtual)
    setTexto(filtroAtual.texto ?? '')
    setMarcados(filtroAtual.valores ?? [])
  }

  const exibir = (v: string) => (rotuloValor ? rotuloValor(v) : v)
  const ativo = Boolean(subFiltro.filtros[campo])
  const ordenando = subFiltro.ordenar === campo

  function ordenar(direcao: 'asc' | 'desc') {
    onAplicar({ ...subFiltro, ordenar: campo, direcao })
  }

  function aplicarFiltro() {
    const filtros = { ...subFiltro.filtros }
    const filtro: { texto?: string; valores?: string[] } = {}
    if (texto.trim() !== '') filtro.texto = texto.trim()
    if (marcados.length > 0) filtro.valores = marcados
    if (filtro.texto === undefined && filtro.valores === undefined) delete filtros[campo]
    else filtros[campo] = filtro
    onAplicar({ ...subFiltro, filtros })
  }

  function limpar() {
    const filtros = { ...subFiltro.filtros }
    delete filtros[campo]
    setTexto('')
    setMarcados([])
    onAplicar({ ...subFiltro, filtros })
  }

  const listados = valores.filter((v) =>
    busca.trim() === '' ? true : exibir(v).toLowerCase().includes(busca.trim().toLowerCase()),
  )

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button type="button" className="flex items-center gap-1 font-medium hover:text-enterplak">
            {rotulo}
            {ordenando && (subFiltro.direcao === 'asc' ? <ArrowUpAZIcon className="size-3.5" /> : <ArrowDownAZIcon className="size-3.5" />)}
            <FilterIcon className={ativo ? 'size-3 text-enterplak' : 'size-3 opacity-40'} />
          </button>
        }
      />
      <PopoverContent className="w-64 p-0" align="start">
        <div className="flex flex-col">
          <button type="button" className="px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => ordenar('asc')}>
            ↑ Ordenar de A a Z
          </button>
          <button type="button" className="px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => ordenar('desc')}>
            ↓ Ordenar de Z a A
          </button>
          <div className="border-t border-border" />
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
          <div className="max-h-56 overflow-y-auto p-2">
            <Input
              placeholder="Filtrar valores..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="mb-2 h-7 text-xs"
            />
            {listados.length === 0 && <p className="px-1 py-2 text-xs text-muted-foreground">Nenhum valor.</p>}
            {listados.map((valor) => (
              <label key={valor} className="flex items-center gap-2 px-1 py-1 text-sm">
                <Checkbox
                  checked={marcados.includes(valor)}
                  onCheckedChange={(marcado) =>
                    setMarcados((atual) => (marcado ? [...atual, valor] : atual.filter((v) => v !== valor)))
                  }
                />
                <span className="truncate">{exibir(valor)}</span>
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
