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
})

export default async function ImportacoesPage() {
  const importacoes = await listarImportacoes()

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Importações</h1>

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
              <TableCell>{importacao.usuarios?.nome || '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
