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
  )
}
