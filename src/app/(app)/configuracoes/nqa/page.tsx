import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { listarNqa } from '@/modules/recebimento/infra/referencias-admin-repository'
import { NqaForm } from './nqa-form'

function rotuloFaixa(min: number, max: number | null): string {
  return max === null ? `${min}+` : `${min}–${max}`
}

export default async function NqaPage() {
  const faixas = await listarNqa()

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Tabela NQA</h1>
        <p className="text-sm text-muted-foreground">
          Faixas de quantidade recebida e o respectivo tamanho de amostra usado no cálculo do
          campo Amostral.
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Faixa</TableHead>
            <TableHead className="text-center">Tamanho da Amostra</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {faixas.map((faixa) => (
            <TableRow key={faixa.id}>
              <TableCell className="font-medium">
                {rotuloFaixa(faixa.quantidadeMin, faixa.quantidadeMax)}
              </TableCell>
              <TableCell className="text-center">
                {faixa.tamanhoAmostra ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-right">
                <NqaForm faixa={faixa} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
