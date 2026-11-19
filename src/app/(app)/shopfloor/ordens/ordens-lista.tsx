'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Pencil, Plus } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { OrdemForm, type OrdemView, type PadraoFluxo } from './ordem-form'
import type { PerfilPosto } from '@/modules/shopfloor/domain/perfil-posto'
import { faixasDe, rotuloFaixas } from '@/modules/shopfloor/domain/faixas-sn'
import { ExcluirOrdemBotao } from './excluir-ordem-botao'
import { FluxoBotao } from './fluxo-botao'

const TODOS = '__todos__'

type Prt = NonNullable<OrdemView['prts']>[number]

/** Busca só com dígitos (ex.: "8498"): na lista nova, procura só no número da OP e no das PRTs, não na descrição. */
function soNumero(q: string): boolean {
  return /^\d+$/.test(q)
}

/** A PRT casa com a busca pelo código ou pelo número da OP dela no Compels (só pelo número, se a busca é numérica). */
function prtCasa(p: Prt, q: string): boolean {
  if (q === '') return false
  const op = (p.compelsOp ?? '').toLowerCase()
  return soNumero(q) ? op.includes(q) : p.codigo.toLowerCase().includes(q) || op.includes(q)
}

export function OrdensLista({
  novaOpHref,
  editarTrechosBase,
  cadeiaPrt,
  views,
  chavesPostos,
  postosPerfil,
  padroes,
  pmosExistentes,
  clientesExistentes,
  dadosPorPmo,
}: {
  /** Destino do botão Nova OP (tela nova, só para os liberados); sem ele, o cadastro antigo (OrdemForm). */
  novaOpHref?: string
  /** Base da página de edição de OP com trechos (`<base>/<id>`); sem ela, toda OP edita no modal. */
  editarTrechosBase?: string
  /** Lista nova: a busca também casa com a OP no Compels e o código das PRTs, e a OP com PRTs mostra a cadeia (seta). */
  cadeiaPrt?: boolean
  views: OrdemView[]
  chavesPostos: string[]
  postosPerfil: Record<string, PerfilPosto>
  padroes: PadraoFluxo[]
  pmosExistentes: string[]
  clientesExistentes: string[]
  dadosPorPmo: Record<string, { cliente: string; descricao: string }>
}) {
  const [cliente, setCliente] = useState(TODOS)
  const [status, setStatus] = useState(TODOS)
  const [busca, setBusca] = useState('')
  // abre/fecha manual da cadeia, por OP; zera quando a busca muda (aí vale a abertura automática)
  const [manual, setManual] = useState<Record<string, boolean>>({})

  const clientes = useMemo(() => [...new Set(views.map((v) => v.cliente))].sort(), [views])

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return views.filter((v) => {
      if (cliente !== TODOS && v.cliente !== cliente) return false
      const finalizada = v.status.toUpperCase() === 'FINALIZADA'
      if (status === 'ATIVA' && finalizada) return false
      if (status === 'FINALIZADA' && !finalizada) return false
      if (q !== '' && cadeiaPrt && soNumero(q)) {
        if (!v.op.toLowerCase().includes(q) && !(v.prts ?? []).some((p) => prtCasa(p, q))) return false
      } else if (q !== '' && !`${v.pmo} ${v.op} ${v.descricao}`.toLowerCase().includes(q)) {
        if (!(cadeiaPrt && (v.prts ?? []).some((p) => prtCasa(p, q)))) return false
      }
      return true
    })
  }, [views, cliente, status, busca, cadeiaPrt])
  const q = busca.trim().toLowerCase()

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        {novaOpHref ? (
          <Link href={novaOpHref} className={buttonVariants({ className: 'bg-enterplak hover:bg-enterplak-700' })}>
            <Plus className="size-4" /> Nova OP
          </Link>
        ) : (
          <OrdemForm postos={chavesPostos} postosPerfil={postosPerfil} padroesExistentes={padroes} pmosExistentes={pmosExistentes} clientesExistentes={clientesExistentes} dadosPorPmo={dadosPorPmo} />
        )}
      </div>

      {/* Filtros */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label>Cliente</Label>
          <Select value={cliente} onValueChange={(v) => setCliente(v ?? TODOS)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os clientes</SelectItem>
              {clientes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v ?? TODOS)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              <SelectItem value="ATIVA">Ativa</SelectItem>
              <SelectItem value="FINALIZADA">Finalizada</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <Label htmlFor="buscaOp">Buscar</Label>
          <Input
            id="buscaOp"
            value={busca}
            onChange={(e) => { setBusca(e.target.value); setManual({}) }}
            placeholder="PMO, OP ou descrição…"
            autoComplete="off"
          />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Mostrando {filtradas.length} de {views.length} OP(s)
      </p>

      <Table containerClassName="max-h-[65vh] overflow-auto rounded-lg border border-border">
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>PMO</TableHead>
              <TableHead>OP</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Faixa SN</TableHead>
              <TableHead className="text-center">Postos</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtradas.map((o) => {
              const prts = cadeiaPrt ? (o.prts ?? []) : []
              const aberta = manual[o.id] ?? prts.some((p) => prtCasa(p, q))
              return (
              <TableRow key={o.id}>
                <TableCell className="font-medium">{o.pmo}</TableCell>
                <TableCell>
                  {prts.length > 0 ? (
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-expanded={aberta}
                          aria-label={`${aberta ? 'Esconder' : 'Mostrar'} PRTs da OP ${o.op}`}
                          onClick={() => setManual((m) => ({ ...m, [o.id]: !aberta }))}
                          className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                        >
                          {aberta ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </button>
                        <span>{o.op}</span>
                        {!aberta && <span className="text-xs text-muted-foreground">{`+${prts.length} PRT${prts.length === 1 ? '' : 's'}`}</span>}
                      </div>
                      {aberta && (
                        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                          {prts.map((p, i) => (
                            <li key={`${p.codigo}-${i}`} data-testid="linha-prt" style={{ paddingLeft: `${(i + 1) * 0.75}rem` }}
                                className={prtCasa(p, q) ? 'font-semibold text-primary' : undefined}>
                              <span aria-hidden className="text-muted-foreground/60">└</span>{' '}
                              <span>{p.compelsOp ?? 'sem OP no Compels'}</span>{'  '}<span>{p.codigo}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : o.op}
                </TableCell>
                <TableCell>{o.cliente}</TableCell>
                <TableCell className="max-w-[240px] truncate">{o.descricao || '—'}</TableCell>
                <TableCell>{o.status.toUpperCase() === 'FINALIZADA' ? 'Finalizada' : 'Ativa'}</TableCell>
                <TableCell title={faixasDe(o).map((f) => `${f.sn_ini}–${f.sn_fim}`).join('\n') || undefined}>{rotuloFaixas(o)}</TableCell>
                <TableCell className="text-center">{o.postos.length}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <FluxoBotao pmo={o.pmo} op={o.op} postos={o.postos} />
                    {editarTrechosBase && o.temTrechos ? (
                      <Link href={`${editarTrechosBase}/${o.id}`} aria-label="Editar OP" className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
                        <Pencil className="size-4" />
                      </Link>
                    ) : (
                      <OrdemForm postos={chavesPostos} postosPerfil={postosPerfil} ordem={o} padroesExistentes={padroes} pmosExistentes={pmosExistentes} clientesExistentes={clientesExistentes} dadosPorPmo={dadosPorPmo} />
                    )}
                    <ExcluirOrdemBotao id={o.id} rotulo={`${o.pmo}/${o.op}`} />
                  </div>
                </TableCell>
              </TableRow>
              )
            })}
            {filtradas.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  {views.length === 0 ? 'Nenhuma OP cadastrada ainda.' : 'Nenhuma OP para os filtros aplicados.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
      </Table>
    </div>
  )
}
