import Link from 'next/link'
import { ArrowRightIcon } from 'lucide-react'
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
import { queryProcessos } from '@/modules/recebimento/domain/busca-processo'
import type { FiltrosProcessos, ProcessoResumoRow } from '@/modules/recebimento/infra/processo-repository'
import { ScrollHorizontalTopo } from './scroll-horizontal-topo'

const CAMPOS: { rotulo: string; valor: (p: ProcessoResumoRow) => string }[] = [
  { rotulo: 'NF', valor: (p) => p.numero_nf || '—' },
  { rotulo: 'Nº EMB', valor: (p) => p.numero_emb || '—' },
  { rotulo: 'Nº DI/INPI', valor: (p) => p.di_inpi || '—' },
  { rotulo: 'ACP/Cliente', valor: (p) => p.acp_cliente || '—' },
  { rotulo: 'Nº Pedido', valor: (p) => p.numero_pedido || '—' },
  { rotulo: 'Tipo', valor: (p) => p.tipo || '—' },
  { rotulo: 'Fornecedor', valor: (p) => p.fornecedor || '—' },
  { rotulo: 'Item Recebido', valor: (p) => p.codigo_material || '—' },
]

export function LinhasProcessos({ linhas, filtros }: { linhas: ProcessoResumoRow[]; filtros: FiltrosProcessos }) {
  if (linhas.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">Nenhum processo neste grupo.</p>
    )
  }
  const q = queryProcessos(filtros)
  return (
    <>
      {/* Desktop: tabela compacta com rolagem lateral (barra espelho no topo,
          para não precisar descer até o fim da lista para rolar). */}
      <div className="hidden md:block">
        <ScrollHorizontalTopo>
        <Table className="text-xs [&_:is(th,td)]:px-2.5 [&_:is(th,td)]:whitespace-nowrap">
          <TableHeader>
            <TableRow>
              <TableHead>Número</TableHead>
              {CAMPOS.map((c) => (
                <TableHead key={c.rotulo}>{c.rotulo}</TableHead>
              ))}
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((processo) => {
              const status = rotuloStatusProcesso(processo.status)
              return (
                <TableRow key={processo.id}>
                  <TableCell className="font-medium">{processo.numero}</TableCell>
                  {CAMPOS.map((c) => (
                    <TableCell key={c.rotulo}>{c.valor(processo)}</TableCell>
                  ))}
                  <TableCell>
                    <Badge className={status.className}>{status.rotulo}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Abrir processo #${processo.numero}`}
                      render={<Link href={`/recebimento/processos/${processo.id}${q}`} />}
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

      {/* Mobile: cards */}
      <div className="space-y-3 md:hidden">
        {linhas.map((processo) => {
          const status = rotuloStatusProcesso(processo.status)
          return (
            <Link
              key={processo.id}
              href={`/recebimento/processos/${processo.id}${q}`}
              className="block rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">#{processo.numero}</span>
                <Badge className={status.className}>{status.rotulo}</Badge>
              </div>
              <dl className="mt-3 space-y-1.5 text-sm">
                {CAMPOS.map((c) => (
                  <div key={c.rotulo} className="flex gap-2">
                    <dt className="w-24 shrink-0 text-muted-foreground">{c.rotulo}</dt>
                    <dd className="min-w-0 flex-1">{c.valor(processo)}</dd>
                  </div>
                ))}
              </dl>
            </Link>
          )
        })}
      </div>
    </>
  )
}
