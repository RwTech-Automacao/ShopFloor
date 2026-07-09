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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Fornecedores Críticos</h1>
        <CriticidadeForm />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fornecedor</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
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
  )
}
