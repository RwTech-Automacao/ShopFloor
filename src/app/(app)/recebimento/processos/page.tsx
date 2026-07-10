import Link from 'next/link'
import { ChevronLeftIcon, ChevronRightIcon, ArrowRightIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { rotuloStatusProcesso } from '@/modules/recebimento/domain/status-processo'
import { listarProcessos } from '@/modules/recebimento/infra/processo-repository'
import { ProcessosFiltros } from './processos-filtros'

const TAMANHO_PAGINA = 25

interface ProcessosPageProps {
  searchParams: Promise<{ busca?: string; status?: string; pagina?: string }>
}

export default async function ProcessosPage({ searchParams }: ProcessosPageProps) {
  const sp = await searchParams
  const paginaSolicitada = Number.parseInt(sp.pagina ?? '0', 10)
  const pagina = Number.isFinite(paginaSolicitada) && paginaSolicitada > 0 ? paginaSolicitada : 0

  const { linhas, total } = await listarProcessos({
    busca: sp.busca || undefined,
    status: sp.status || undefined,
    pagina,
    tamanho: TAMANHO_PAGINA,
  })

  const totalPaginas = Math.max(1, Math.ceil(total / TAMANHO_PAGINA))
  const temAnterior = pagina > 0
  const temProxima = pagina + 1 < totalPaginas

  function hrefPagina(novaPagina: number): string {
    const params = new URLSearchParams()
    if (sp.busca) params.set('busca', sp.busca)
    if (sp.status) params.set('status', sp.status)
    if (novaPagina > 0) params.set('pagina', String(novaPagina))
    const query = params.toString()
    return query ? `/recebimento/processos?${query}` : '/recebimento/processos'
  }

  const material = (p: (typeof linhas)[number]) =>
    p.codigo_material ? `${p.codigo_material} — ${p.descricao_material ?? ''}` : '—'

  const mensagemVazio =
    sp.busca || sp.status
      ? 'Nenhum processo encontrado para os filtros selecionados.'
      : 'Nenhum processo encontrado.'

  return (
    <div className="flex flex-col gap-4">
      <ProcessosFiltros />

      {/* Desktop: tabela */}
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Número</TableHead>
              <TableHead>Nº NF</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead>Material</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  {mensagemVazio}
                </TableCell>
              </TableRow>
            )}
            {linhas.map((processo) => {
              const status = rotuloStatusProcesso(processo.status)
              return (
                <TableRow key={processo.id}>
                  <TableCell className="font-medium">{processo.numero}</TableCell>
                  <TableCell>{processo.numero_nf || '—'}</TableCell>
                  <TableCell>{processo.fornecedor || '—'}</TableCell>
                  <TableCell>{material(processo)}</TableCell>
                  <TableCell>
                    <Badge className={status.className}>{status.rotulo}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Abrir processo #${processo.numero}`}
                      render={<Link href={`/recebimento/processos/${processo.id}`} />}
                    >
                      <ArrowRightIcon />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 md:hidden">
        {linhas.length === 0 && (
          <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
            {mensagemVazio}
          </p>
        )}
        {linhas.map((processo) => {
          const status = rotuloStatusProcesso(processo.status)
          return (
            <Link
              key={processo.id}
              href={`/recebimento/processos/${processo.id}`}
              className="block rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">#{processo.numero}</span>
                <Badge className={status.className}>{status.rotulo}</Badge>
              </div>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-muted-foreground">Nº NF</dt>
                  <dd>{processo.numero_nf || '—'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-muted-foreground">Fornecedor</dt>
                  <dd className="min-w-0 flex-1">{processo.fornecedor || '—'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-muted-foreground">Material</dt>
                  <dd className="min-w-0 flex-1">{material(processo)}</dd>
                </div>
              </dl>
            </Link>
          )
        })}
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Página {pagina + 1} de {totalPaginas} — {total} processo{total === 1 ? '' : 's'}
        </span>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Página anterior"
            disabled={!temAnterior}
            render={<Link href={hrefPagina(pagina - 1)} />}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Próxima página"
            disabled={!temProxima}
            render={<Link href={hrefPagina(pagina + 1)} />}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </div>
    </div>
  )
}
