import Link from 'next/link'
import { ListIcon } from 'lucide-react'
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
import { listarListas } from '@/modules/listas/infra/lista-repository'
import { ListaForm, ExcluirListaButton } from './lista-form'

export default async function ListasPage() {
  const listas = await listarListas()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <ListaForm />
      </div>

      {/* Desktop: tabela */}
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Chave</TableHead>
              <TableHead className="text-center">Itens</TableHead>
              <TableHead className="text-center">Sistema</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listas.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  Nenhuma lista cadastrada.
                </TableCell>
              </TableRow>
            )}
            {listas.map((lista) => (
              <TableRow key={lista.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/configuracoes/listas/${lista.chave}`}
                    className="hover:text-enterplak hover:underline"
                  >
                    {lista.nome}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{lista.chave}</TableCell>
                <TableCell className="text-center">{lista.totalItens}</TableCell>
                <TableCell className="text-center">
                  {lista.sistema && <Badge variant="outline">Sistema</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Gerenciar itens"
                      render={<Link href={`/configuracoes/listas/${lista.chave}`} />}
                    >
                      <ListIcon />
                    </Button>
                    <ExcluirListaButton id={lista.id} nome={lista.nome} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 md:hidden">
        {listas.length === 0 && (
          <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
            Nenhuma lista cadastrada.
          </p>
        )}
        {listas.map((lista) => (
          <div key={lista.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <Link
                href={`/configuracoes/listas/${lista.chave}`}
                className="font-semibold hover:text-enterplak hover:underline"
              >
                {lista.nome}
              </Link>
              {lista.sistema && <Badge variant="outline">Sistema</Badge>}
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted-foreground">Chave</dt>
                <dd className="min-w-0 flex-1">{lista.chave}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted-foreground">Itens</dt>
                <dd className="min-w-0 flex-1">{lista.totalItens}</dd>
              </div>
            </dl>
            <div className="mt-3 flex justify-end gap-1 border-t border-border pt-3">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Gerenciar itens"
                render={<Link href={`/configuracoes/listas/${lista.chave}`} />}
              >
                <ListIcon />
              </Button>
              <ExcluirListaButton id={lista.id} nome={lista.nome} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
