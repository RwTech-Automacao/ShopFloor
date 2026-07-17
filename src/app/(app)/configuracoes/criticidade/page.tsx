import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { listarCriticidade } from '@/modules/recebimento/infra/referencias-admin-repository'
import { CriticidadeForm, ExcluirCriticidadeButton } from './criticidade-form'

export default async function CriticidadePage() {
  const registros = await listarCriticidade()

  const mensagemVazio = 'Nenhum fornecedor crítico cadastrado.'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <CriticidadeForm />
      </div>

      {/* Desktop: tabela */}
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fornecedor</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {registros.length === 0 && (
              <TableRow>
                <TableCell colSpan={2} className="py-8 text-center text-muted-foreground">
                  {mensagemVazio}
                </TableCell>
              </TableRow>
            )}
            {registros.map((registro) => (
              <TableRow key={registro.id}>
                <TableCell className="font-medium">{registro.fornecedor}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <ExcluirCriticidadeButton id={registro.id} fornecedor={registro.fornecedor} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 lg:hidden">
        {registros.length === 0 && (
          <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
            {mensagemVazio}
          </p>
        )}
        {registros.map((registro) => (
          <div key={registro.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{registro.fornecedor}</span>
              <ExcluirCriticidadeButton id={registro.id} fornecedor={registro.fornecedor} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
