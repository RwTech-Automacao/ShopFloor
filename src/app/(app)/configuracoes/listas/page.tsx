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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Listas</h1>
        <ListaForm />
      </div>

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
                  <ExcluirListaButton id={lista.id} nome={lista.nome} sistema={lista.sistema} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
