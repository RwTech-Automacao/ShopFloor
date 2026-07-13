import Link from 'next/link'
import { ArrowLeftIcon } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { listarGeracoes } from '@/modules/etiquetas/infra/etiqueta-repository'

const ROTULOS_TIPO: Record<string, string> = {
  nf: 'Nº NF',
  emb: 'Nº embarque',
  fornecedor: 'Fornecedor',
}

const formatadorData = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
  // Fuso fixo de Brasília (servidor renderiza em UTC na Vercel).
  timeZone: 'America/Sao_Paulo',
})

export default async function HistoricoEtiquetasPage() {
  const geracoes = await listarGeracoes()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Histórico de geração de etiquetas</h1>
        <Link
          href="/recebimento/etiquetas"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-enterplak hover:underline"
        >
          <ArrowLeftIcon className="size-4" />
          Voltar para Etiquetas
        </Link>
      </div>

      {/* Desktop: tabela */}
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data/hora</TableHead>
              <TableHead>Usuário</TableHead>
              <TableHead>Filtro</TableHead>
              <TableHead>Nº processos</TableHead>
              <TableHead>Nº etiquetas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {geracoes.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Nenhuma geração de etiquetas registrada ainda.
                </TableCell>
              </TableRow>
            )}
            {geracoes.map((geracao) => (
              <TableRow key={geracao.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatadorData.format(new Date(geracao.created_at))}
                </TableCell>
                <TableCell>{geracao.usuario_nome || '—'}</TableCell>
                <TableCell>
                  {ROTULOS_TIPO[geracao.filtro_tipo] ?? geracao.filtro_tipo}
                  {geracao.filtro_valor ? `: ${geracao.filtro_valor}` : ''}
                </TableCell>
                <TableCell>{geracao.total_processos}</TableCell>
                <TableCell>{geracao.total_etiquetas}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 md:hidden">
        {geracoes.length === 0 && (
          <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
            Nenhuma geração de etiquetas registrada ainda.
          </p>
        )}
        {geracoes.map((geracao) => (
          <div key={geracao.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{geracao.usuario_nome || '—'}</span>
              <span className="whitespace-nowrap text-muted-foreground">
                {formatadorData.format(new Date(geracao.created_at))}
              </span>
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted-foreground">Filtro</dt>
                <dd className="min-w-0 flex-1">
                  {ROTULOS_TIPO[geracao.filtro_tipo] ?? geracao.filtro_tipo}
                  {geracao.filtro_valor ? `: ${geracao.filtro_valor}` : ''}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted-foreground">Nº processos</dt>
                <dd className="min-w-0 flex-1">{geracao.total_processos}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted-foreground">Nº etiquetas</dt>
                <dd className="min-w-0 flex-1">{geracao.total_etiquetas}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </div>
  )
}
