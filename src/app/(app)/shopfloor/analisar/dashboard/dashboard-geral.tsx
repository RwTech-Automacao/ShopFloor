'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { carregarDashboardGeral } from '@/modules/shopfloor/application/dashboard-actions'
import { FILTRO_PADRAO, OPS_POR_PAGINA, type DadosDashboard, type FiltroDashboard } from '@/modules/shopfloor/domain/dashboard'
import { capitalizarDescricaoDefeito, separarCodigoDefeito } from '@/modules/shopfloor/domain/defeito'
import type { OrdemPesquisa } from '@/modules/shopfloor/infra/pesquisa-repository'

const TODOS = '__todos__'
const fmt = new Intl.NumberFormat('pt-BR')

/**
 * Dashboard geral — a visão que substitui o relatório do Looker Studio, que lia da planilha do
 * ShopFloor legado. Os números NÃO batem com os de lá de propósito: aqui é o dado do sistema.
 *
 * Tudo é agregado no banco (migração 0101). Cruzar várias OPs no cliente exigiria baixar a
 * `sf_registros` inteira, e o PostgREST corta em 1000 linhas sem avisar.
 */
export function DashboardGeral({ ordens, postos }: { ordens: OrdemPesquisa[]; postos: string[] }) {
  const [filtro, setFiltro] = useState<FiltroDashboard>(FILTRO_PADRAO)
  const [pagina, setPagina] = useState(0)
  const [dados, setDados] = useState<DadosDashboard | null>(null)
  const [carregando, start] = useTransition()

  // Recarrega a cada mudança de filtro ou de página. O filtro inteiro entra na dependência como
  // JSON porque é um objeto novo a cada render — comparar por referência recarregaria sempre.
  const chave = JSON.stringify(filtro)
  useEffect(() => {
    start(async () => {
      const r = await carregarDashboardGeral(filtro, pagina)
      if (r.ok) setDados(r.dados)
      else { setDados(null); toast.error(r.erro) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `chave` já representa o filtro inteiro
  }, [chave, pagina])

  // As listas dos filtros saem das OPs cadastradas — não do resultado, senão o filtro sumiria
  // justamente quando o recorte não tem dado, e a pessoa ficaria sem como voltar atrás.
  const clientes = useMemo(() => [...new Set(ordens.map((o) => o.cliente))].sort(), [ordens])
  const pmos = useMemo(() => {
    const base = filtro.cliente ? ordens.filter((o) => o.cliente === filtro.cliente) : ordens
    return [...new Set(base.map((o) => o.pmo))].sort()
  }, [ordens, filtro.cliente])
  const ops = useMemo(() => {
    const base = ordens.filter((o) => (!filtro.cliente || o.cliente === filtro.cliente) && (!filtro.pmo || o.pmo === filtro.pmo))
    return [...new Set(base.map((o) => o.op))].sort()
  }, [ordens, filtro.cliente, filtro.pmo])

  // Trocar um filtro volta pra primeira página: manter a página 3 num recorte que só tem 1 é
  // mostrar tela vazia sem explicar por quê.
  function mudar(patch: Partial<FiltroDashboard>) {
    setPagina(0)
    setFiltro((f) => ({ ...f, ...patch }))
  }

  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.opsTotal / OPS_POR_PAGINA)) : 1
  const maiorDefeito = dados?.defeitos.topo[0]?.total ?? 0

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- Filtros ---------- */}
      <Card>
        <CardContent className="grid gap-3 py-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <CampoSelect rotulo="Cliente" valor={filtro.cliente} opcoes={clientes}
            onChange={(v) => mudar({ cliente: v, pmo: '', op: '' })} />
          <CampoSelect rotulo="PMO" valor={filtro.pmo} opcoes={pmos}
            onChange={(v) => mudar({ pmo: v, op: '' })} />
          <CampoSelect rotulo="OP" valor={filtro.op} opcoes={ops} onChange={(v) => mudar({ op: v })} />
          <div className="flex flex-col gap-1.5">
            <Label>Status da OP</Label>
            <Select value={filtro.statusOp === '' ? TODOS : filtro.statusOp}
              onValueChange={(v) => mudar({ statusOp: !v || v === TODOS ? '' : (v as 'aberta' | 'finalizada') })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="aberta">Em aberto</SelectItem>
                <SelectItem value="finalizada">Finalizadas</SelectItem>
                <SelectItem value={TODOS}>Todas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <CampoSelect rotulo="Posto" valor={filtro.posto} opcoes={postos} onChange={(v) => mudar({ posto: v })} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="de">De</Label>
            <Input id="de" type="date" value={filtro.de} className="h-9"
              onChange={(e) => mudar({ de: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ate">Até</Label>
            <Input id="ate" type="date" value={filtro.ate} className="h-9"
              onChange={(e) => mudar({ ate: e.target.value })} />
          </div>
        </CardContent>
      </Card>

      {/* ---------- Indicadores ---------- */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Indicador rotulo="Total" valor={dados?.totais.total} cor="text-foreground"
          dica="Peças distintas (nº de série) no recorte" />
        <Indicador rotulo="Aprovado" valor={dados?.totais.aprovado} cor="text-green-700 dark:text-green-400"
          dica="Peças com ao menos um Aprovado" />
        <Indicador rotulo="Reprovado" valor={dados?.totais.reprovado} cor="text-red-600 dark:text-red-400"
          dica="Peças com ao menos um Reprovado" />
      </div>
      {/* A soma não fecha com o Total, e isso é correto — ver a nota na migração 0101. Dizer aqui
          evita a pergunta "o dashboard está errado?" toda vez que alguém confere na mão. */}
      <p className="-mt-2 text-xs text-muted-foreground">
        Contagem por <strong>peça</strong>, não por bipe. Aprovado + Reprovado não fecha com o Total:
        peças que só passaram por postos sem status ficam de fora, e uma peça aprovada num posto e
        reprovada em outro conta nos dois.
        {dados && <> · {fmt.format(dados.totais.bipes)} bipes em {fmt.format(dados.totais.ops)} OPs</>}
      </p>

      {/* ---------- Grade OP × posto ---------- */}
      <Card>
        <CardContent className="py-4">
          {carregando && !dados && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {dados && dados.grade.ops.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma OP com movimento neste filtro.</p>
          )}
          {dados && dados.grade.ops.length > 0 && (
            <>
              {/* A tabela é larga por natureza (uma coluna por posto) — rola dentro do próprio
                  container pra a página nunca rolar de lado. */}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-10 bg-card">PMO·OP</TableHead>
                      <TableHead>Cliente</TableHead>
                      {dados.grade.postos.map((p) => (
                        <TableHead key={p} className="whitespace-nowrap text-center">{p}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dados.grade.ops.map((o) => (
                      <TableRow key={`${o.pmo}|${o.op}`}>
                        <TableCell className="sticky left-0 z-10 whitespace-nowrap bg-card font-medium">
                          {o.pmo}·{o.op}
                          {o.finalizada && <span className="ml-2 text-xs font-normal text-muted-foreground">finalizada</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{o.cliente}</TableCell>
                        {dados.grade.postos.map((p) => {
                          const c = o.porPosto[p]
                          return (
                            <TableCell key={p} className="text-center tabular-nums">
                              {!c ? <span className="text-muted-foreground/40">—</span> : (
                                <span className="inline-flex items-baseline gap-1.5">
                                  <span className="font-medium text-green-700 dark:text-green-400">{fmt.format(c.aprovados)}</span>
                                  {c.reprovados > 0 && (
                                    <span className="text-xs text-red-600 dark:text-red-400">{fmt.format(c.reprovados)}</span>
                                  )}
                                </span>
                              )}
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                  {fmt.format(dados.opsTotal)} OP{dados.opsTotal === 1 ? '' : 's'} · página {pagina + 1} de {totalPaginas}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={pagina === 0 || carregando}
                    onClick={() => setPagina((p) => Math.max(0, p - 1))}>Anterior</Button>
                  <Button variant="outline" size="sm" disabled={pagina + 1 >= totalPaginas || carregando}
                    onClick={() => setPagina((p) => p + 1)}>Próxima</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------- Principais defeitos ---------- */}
      {dados && dados.defeitos.topo.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-2 py-4">
            <p className="text-sm font-semibold text-foreground">Principais defeitos</p>
            {dados.defeitos.topo.map((d) => {
              const { numero, descricao } = separarCodigoDefeito(d.codigo)
              const pct = maiorDefeito > 0 ? Math.round((d.total / maiorDefeito) * 100) : 0
              return (
                <div key={d.codigo} className="flex items-center gap-3 text-sm">
                  <span className="w-56 shrink-0 truncate" title={d.codigo}>
                    {capitalizarDescricaoDefeito(descricao) || d.codigo}
                    {numero && <span className="ml-1.5 text-xs text-muted-foreground">Cod.: {numero}</span>}
                  </span>
                  <div className="h-4 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-enterplak" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-16 shrink-0 text-right tabular-nums font-medium">{fmt.format(d.total)}</span>
                </div>
              )
            })}
            {dados.defeitos.outros > 0 && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="w-56 shrink-0">Outros</span>
                <div className="h-4 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-muted-foreground/40"
                    style={{ width: `${maiorDefeito > 0 ? Math.round((dados.defeitos.outros / maiorDefeito) * 100) : 0}%` }} />
                </div>
                <span className="w-16 shrink-0 text-right tabular-nums">{fmt.format(dados.defeitos.outros)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/** Select de filtro com a opção "todos" — repetido em Cliente/PMO/OP/Posto. */
function CampoSelect({ rotulo, valor, opcoes, onChange }: {
  rotulo: string; valor: string; opcoes: string[]; onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{rotulo}</Label>
      <Select value={valor === '' ? TODOS : valor} onValueChange={(v) => onChange(!v || v === TODOS ? '' : v)}>
        <SelectTrigger className="h-9"><SelectValue placeholder="Todos" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>Todos</SelectItem>
          {opcoes.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

function Indicador({ rotulo, valor, cor, dica }: { rotulo: string; valor?: number; cor: string; dica: string }) {
  return (
    <Card>
      <CardContent className="py-4" title={dica}>
        <p className="text-sm font-medium text-muted-foreground">{rotulo}</p>
        <p className={`text-3xl font-bold tabular-nums ${cor}`}>
          {valor === undefined ? '—' : fmt.format(valor)}
        </p>
      </CardContent>
    </Card>
  )
}
