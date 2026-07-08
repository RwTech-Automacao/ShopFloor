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

const TAMANHO_PAGINA = 25

interface ProcessosPageProps {
  searchParams: Promise<{ pagina?: string }>
}

export default async function ProcessosPage({ searchParams }: ProcessosPageProps) {
  const sp = await searchParams
  const paginaSolicitada = Number.parseInt(sp.pagina ?? '0', 10)
  const pagina = Number.isFinite(paginaSolicitada) && paginaSolicitada > 0 ? paginaSolicitada : 0

  const { linhas, total } = await listarProcessos({ pagina, tamanho: TAMANHO_PAGINA })

  const totalPaginas = Math.max(1, Math.ceil(total / TAMANHO_PAGINA))
  const temAnterior = pagina > 0
  const temProxima = pagina + 1 < totalPaginas

  function hrefPagina(novaPagina: number): string {
    const params = new URLSearchParams()
    if (novaPagina > 0) params.set('pagina', String(novaPagina))
    const query = params.toString()
    return query ? `/recebimento/processos?${query}` : '/recebimento/processos'
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Processos</h1>

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
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                Nenhum processo encontrado.
              </TableCell>
            </TableRow>
          )}
          {linhas.map((processo) => {
            const status = rotuloStatusProcesso(processo.status)
            return (
              <TableRow key={processo.id}>
                <TableCell>{processo.numero}</TableCell>
                <TableCell>{processo.numero_nf || '—'}</TableCell>
                <TableCell>{processo.fornecedor || '—'}</TableCell>
                <TableCell>
                  {processo.codigo_material
                    ? `${processo.codigo_material} — ${processo.descricao_material ?? ''}`
                    : '—'}
                </TableCell>
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
