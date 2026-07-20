import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { listarImportacoes } from '@/modules/recebimento/infra/importacao-repository'

const formatadorData = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
  // Fuso fixo de Brasília (servidor renderiza em UTC na Vercel).
  timeZone: 'America/Sao_Paulo',
})

export default async function ImportacoesPage() {
  const importacoes = await listarImportacoes()

  return (
    <div className="flex flex-col gap-4">
      {/* Desktop: tabela */}
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Arquivo</TableHead>
              <TableHead>Formato</TableHead>
              <TableHead>Nº de processos</TableHead>
              <TableHead>Data/hora</TableHead>
              <TableHead>Usuário</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {importacoes.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Nenhuma importação encontrada.
                </TableCell>
              </TableRow>
            )}
            {importacoes.map((importacao) => (
              <TableRow key={importacao.id}>
                <TableCell>{importacao.arquivo_nome}</TableCell>
                <TableCell className="uppercase">{importacao.formato}</TableCell>
                <TableCell>{importacao.total_processos_criados}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatadorData.format(new Date(importacao.created_at))}
                </TableCell>
                <TableCell>{importacao.usuario_nome || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 lg:hidden">
        {importacoes.length === 0 && (
          <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
            Nenhuma importação encontrada.
          </p>
        )}
        {importacoes.map((importacao) => (
          <div key={importacao.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{importacao.arquivo_nome}</span>
              <span className="uppercase text-muted-foreground">{importacao.formato}</span>
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted-foreground">Nº processos</dt>
                <dd className="min-w-0 flex-1">{importacao.total_processos_criados}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted-foreground">Data/hora</dt>
                <dd className="min-w-0 flex-1">
                  {formatadorData.format(new Date(importacao.created_at))}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted-foreground">Usuário</dt>
                <dd className="min-w-0 flex-1">{importacao.usuario_nome || '—'}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </div>
  )
}
