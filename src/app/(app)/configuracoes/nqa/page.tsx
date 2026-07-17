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

  const mensagemVazio = 'Nenhuma faixa cadastrada.'

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Faixas de quantidade recebida e o respectivo tamanho de amostra usado no cálculo do campo
        Amostral.
      </p>

      {/* Desktop: tabela */}
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Faixa</TableHead>
              <TableHead className="text-center">Tamanho da Amostra</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {faixas.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                  {mensagemVazio}
                </TableCell>
              </TableRow>
            )}
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

      {/* Mobile: cards */}
      <div className="space-y-3 lg:hidden">
        {faixas.length === 0 && (
          <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
            {mensagemVazio}
          </p>
        )}
        {faixas.map((faixa) => (
          <div key={faixa.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">
                {rotuloFaixa(faixa.quantidadeMin, faixa.quantidadeMax)}
              </span>
              <NqaForm faixa={faixa} />
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted-foreground">Amostra</dt>
                <dd className="min-w-0 flex-1">
                  {faixa.tamanhoAmostra ?? <span className="text-muted-foreground">—</span>}
                </dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </div>
  )
}
