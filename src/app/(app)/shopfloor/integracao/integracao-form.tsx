'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { Plus, X, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  integrar,
  buscarIntegracao,
  cancelarIntegracao,
} from '@/modules/shopfloor/application/integracao-actions'
import type { IntegracaoDetalhe } from '@/modules/shopfloor/infra/integracao-repository'
import type { OrdemLancamentoLista } from '@/modules/shopfloor/infra/lancamento-repository'

interface LinhaPlaca {
  pmo: string
  op: string
  sn: string
}

const LINHA_VAZIA: LinhaPlaca = { pmo: '', op: '', sn: '' }
const MAX_PLACAS = 200

export function IntegracaoForm({
  ordens,
  podeCancelar,
}: {
  ordens: OrdemLancamentoLista[]
  podeCancelar: boolean
}) {
  const [colaborador, setColaborador] = useState('')
  const [cliente, setCliente] = useState('')
  const [pmo, setPmo] = useState('')
  const [op, setOp] = useState('')
  const [produtoSN, setProdutoSN] = useState('')
  const [placas, setPlacas] = useState<LinhaPlaca[]>([{ ...LINHA_VAZIA }])
  const [qtdRapida, setQtdRapida] = useState('')
  const [buscaSN, setBuscaSN] = useState('')
  const [detalhe, setDetalhe] = useState<IntegracaoDetalhe | null>(null)
  const [buscou, setBuscou] = useState(false)
  const [enviando, startEnvio] = useTransition()
  const [buscando, startBusca] = useTransition()
  const produtoRef = useRef<HTMLInputElement>(null)

  // Cascata do PRODUTO: só OPs com Integração no fluxo
  const ordensIntegraveis = useMemo(() => ordens.filter((o) => o.postos.includes('Integração')), [ordens])
  const clientes = useMemo(() => [...new Set(ordensIntegraveis.map((o) => o.cliente))], [ordensIntegraveis])
  const pmos = useMemo(
    () => [...new Set(ordensIntegraveis.filter((o) => o.cliente === cliente).map((o) => o.pmo))],
    [ordensIntegraveis, cliente],
  )
  const ops = useMemo(
    () => ordensIntegraveis.filter((o) => o.cliente === cliente && o.pmo === pmo).map((o) => o.op),
    [ordensIntegraveis, cliente, pmo],
  )
  const ordemSel = useMemo(
    () => ordensIntegraveis.find((o) => o.cliente === cliente && o.pmo === pmo && o.op === op) ?? null,
    [ordensIntegraveis, cliente, pmo, op],
  )

  // Placas: por padrão qualquer PMO; se o produto tem receita, só as PMOs dela.
  const todasPmos = useMemo(() => [...new Set(ordens.map((o) => o.pmo))], [ordens])
  const pmosPlaca = useMemo(() => {
    const receita = ordemSel?.componentes ?? []
    if (receita.length === 0) return todasPmos
    const permitidas = new Set(receita.map((r) => r.toLowerCase()))
    return todasPmos.filter((p) => permitidas.has(p.toLowerCase()))
  }, [ordemSel, todasPmos])
  function opsDoPmo(p: string) {
    return ordens.filter((o) => o.pmo === p).map((o) => o.op)
  }
  function descricaoDe(p: string, o: string) {
    return ordens.find((x) => x.pmo === p && x.op === o)?.descricao ?? ''
  }

  function mudarCliente(v: string) {
    setCliente(v); setPmo(''); setOp(''); setPlacas([{ ...LINHA_VAZIA }])
  }
  function mudarPmo(v: string) {
    setPmo(v); setOp(''); setPlacas([{ ...LINHA_VAZIA }])
  }
  function mudarOpProduto(v: string) {
    setOp(v ?? '')
    setPlacas([{ ...LINHA_VAZIA }])
  }

  function atualizarPlaca(i: number, patch: Partial<LinhaPlaca>) {
    setPlacas(placas.map((l, idx) => (idx === i ? { ...l, ...patch, ...(patch.pmo !== undefined ? { op: '' } : {}) } : l)))
  }
  function adicionarLinha() {
    if (placas.length < MAX_PLACAS) setPlacas([...placas, { ...LINHA_VAZIA }])
  }
  function removerLinha(i: number) {
    setPlacas(placas.length > 1 ? placas.filter((_, idx) => idx !== i) : placas)
  }
  function gerarLinhas() {
    const qtd = Number(qtdRapida)
    if (!Number.isInteger(qtd) || qtd < 1) return
    setPlacas(Array.from({ length: Math.min(qtd, MAX_PLACAS) }, () => ({ ...LINHA_VAZIA })))
  }
  function limpar() {
    setPlacas([{ ...LINHA_VAZIA }]); setProdutoSN(''); setQtdRapida('')
  }

  const valido =
    colaborador.trim() !== '' && ordemSel !== null && produtoSN.trim() !== '' &&
    placas.some((l) => l.sn.trim() !== '')

  function onRegistrar() {
    if (!valido || enviando) return
    startEnvio(async () => {
      const r = await integrar({ colaborador, pmo, op, produtoSN, placas })
      if (r.ok) {
        toast.success(`Integração registrada: ${r.codigo}`)
        limpar()
        setTimeout(() => produtoRef.current?.focus(), 0)
      } else {
        toast.error(r.erro)
      }
    })
  }

  function onBuscar() {
    if (buscaSN.trim() === '' || buscando) return
    startBusca(async () => {
      const r = await buscarIntegracao(buscaSN)
      if (r.ok) {
        setDetalhe(r.detalhe)
        setBuscou(true)
      } else {
        toast.error(r.erro)
      }
    })
  }

  function onCancelar() {
    if (!detalhe || buscando) return
    if (!window.confirm(`Cancelar a integração ${detalhe.codigo}? O produto e as placas ficarão livres para re-integrar.`)) return
    startBusca(async () => {
      const r = await cancelarIntegracao(detalhe.codigo)
      if (r.ok) {
        toast.success('Integração cancelada.')
        setDetalhe(null)
        setBuscou(false)
        setBuscaSN('')
      } else {
        toast.error(r.erro)
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Registrar */}
      <Card>
        <CardHeader>
          <CardTitle>Registrar integração</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="colab">Colaborador</Label>
              <Input id="colab" value={colaborador} onChange={(e) => setColaborador(e.target.value)} autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Cliente</Label>
              <Select value={cliente} onValueChange={(v) => mudarCliente(v ?? '')}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{clientes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>PMO (produto final)</Label>
              <Select value={pmo} onValueChange={(v) => mudarPmo(v ?? '')} disabled={cliente === ''}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{pmos.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>OP</Label>
              <Select value={op} onValueChange={(v) => mudarOpProduto(v ?? '')} disabled={pmo === ''}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{ops.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-4">
              <Label>Descrição</Label>
              <Input value={ordemSel?.descricao ?? ''} readOnly disabled />
            </div>
          </div>

          {/* Placas */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Placas <span className="font-normal text-muted-foreground">· 1 linha por placa</span></p>
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Input type="number" min="1" step="1" value={qtdRapida} onChange={(e) => setQtdRapida(e.target.value)} placeholder="Qtd" className="h-8 w-20" />
                <Button type="button" variant="outline" size="sm" onClick={gerarLinhas}>Gerar</Button>
                <Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar</Button>
              </span>
            </div>
            {(ordemSel?.componentes?.length ?? 0) > 0 && (
              <p className="mb-2 text-xs text-muted-foreground">
                Este produto aceita apenas placas das PMOs: {ordemSel!.componentes.join(', ')}.
              </p>
            )}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>PMO</TableHead>
                    <TableHead>OP</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Nº de Série</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {placas.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm font-medium text-enterplak">{i + 1}</TableCell>
                      <TableCell className="min-w-[130px]">
                        <Select value={l.pmo} onValueChange={(v) => atualizarPlaca(i, { pmo: v ?? '' })}>
                          <SelectTrigger><SelectValue placeholder="PMO" /></SelectTrigger>
                          <SelectContent>{pmosPlaca.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="min-w-[110px]">
                        <Select value={l.op} onValueChange={(v) => atualizarPlaca(i, { op: v ?? '' })} disabled={l.pmo === ''}>
                          <SelectTrigger><SelectValue placeholder="OP" /></SelectTrigger>
                          <SelectContent>{opsDoPmo(l.pmo).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="min-w-[160px]">
                        <Input value={descricaoDe(l.pmo, l.op)} readOnly disabled />
                      </TableCell>
                      <TableCell className="min-w-[160px]">
                        <Input value={l.sn} onChange={(e) => atualizarPlaca(i, { sn: e.target.value })} placeholder="Bipe o SN da placa" autoComplete="off" />
                      </TableCell>
                      <TableCell>
                        <button type="button" aria-label={`Remover placa ${i + 1}`} onClick={() => removerLinha(i)} disabled={placas.length <= 1} className="text-muted-foreground hover:text-red-600 disabled:opacity-30">
                          <X className="size-4" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <button type="button" onClick={adicionarLinha} className="mt-2 w-full rounded-lg border border-dashed border-border py-2 text-sm font-medium text-enterplak hover:bg-muted">
              <Plus className="mr-1 inline size-4" /> Adicionar linha
            </button>
          </div>

          <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="produtoSN">Produto Final (Nº de Série)</Label>
              <Input id="produtoSN" ref={produtoRef} value={produtoSN} onChange={(e) => setProdutoSN(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onRegistrar() } }} placeholder="Bipe o SN do produto final" autoComplete="off" className="h-12 text-lg" />
            </div>
            <Button onClick={onRegistrar} disabled={!valido || enviando} className="h-11 bg-enterplak px-8 hover:bg-enterplak-700">
              {enviando ? 'Registrando…' : 'Registrar Integração'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Buscar */}
      <Card>
        <CardHeader>
          <CardTitle>Buscar por Nº de Série</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="buscaSN">SN do produto ou da placa</Label>
              <Input id="buscaSN" value={buscaSN} onChange={(e) => setBuscaSN(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onBuscar() } }} autoComplete="off" />
            </div>
            <Button variant="outline" onClick={onBuscar} disabled={buscando}>
              <Search className="mr-1 size-4" /> {buscando ? 'Buscando…' : 'Buscar'}
            </Button>
          </div>

          {buscou && !detalhe && (
            <p className="text-sm text-muted-foreground">Nenhuma integração ativa encontrada para esse SN.</p>
          )}

          {detalhe && (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <p className="font-semibold text-tinta">{detalhe.codigo}</p>
                  <p className="text-muted-foreground">
                    {detalhe.cliente} · {detalhe.pmo}/{detalhe.op} · {detalhe.qtdPlacas} placa(s) · por {detalhe.colaborador}
                  </p>
                </div>
                {podeCancelar && (
                  <Button variant="destructive" size="sm" onClick={onCancelar} disabled={buscando}>
                    Cancelar integração
                  </Button>
                )}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>PMO</TableHead>
                    <TableHead>OP</TableHead>
                    <TableHead>Nº de Série</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detalhe.itens.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell className={it.tipo === 'Produto' ? 'font-medium text-enterplak' : ''}>{it.tipo}</TableCell>
                      <TableCell>{it.pmo}</TableCell>
                      <TableCell>{it.op}</TableCell>
                      <TableCell>{it.sn}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
