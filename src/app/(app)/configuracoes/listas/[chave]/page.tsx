import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeftIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { buscarLista, listarItens } from '@/modules/listas/infra/lista-repository'
import { ItemForm, AlternarItemAtivo, ExcluirItemButton } from '../item-form'

interface ListaDetalhePageProps {
  params: Promise<{ chave: string }>
}

export default async function ListaDetalhePage({ params }: ListaDetalhePageProps) {
  const { chave } = await params
  const lista = await buscarLista(chave)
  if (!lista) notFound()

  const itens = await listarItens(lista.id)
  const proximaOrdem = itens.length
    ? Math.max(...itens.map((item) => item.ordem)) + 1
    : 1

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/configuracoes/listas"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-enterplak hover:underline"
      >
        <ArrowLeftIcon className="size-4" />
        Voltar para Listas
      </Link>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">{lista.nome}</h1>
          {lista.sistema && <Badge variant="outline">Sistema</Badge>}
        </div>
        <ItemForm listaId={lista.id} listaChave={lista.chave} proximaOrdem={proximaOrdem} />
      </div>
      <p className="text-sm text-muted-foreground">Chave: {lista.chave}</p>

      {/* Desktop: tabela */}
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Valor</TableHead>
              <TableHead className="text-center">Ordem</TableHead>
              <TableHead className="text-center">Ativo</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {itens.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.valor}</TableCell>
                <TableCell className="text-center">{item.ordem}</TableCell>
                <TableCell className="text-center">
                  <div className="flex justify-center">
                    <AlternarItemAtivo id={item.id} ativo={item.ativo} />
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <ItemForm listaId={lista.id} listaChave={lista.chave} item={item} />
                    <ExcluirItemButton id={item.id} valor={item.valor} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {itens.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  Nenhum item cadastrado nesta lista.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 lg:hidden">
        {itens.length === 0 && (
          <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
            Nenhum item cadastrado nesta lista.
          </p>
        )}
        {itens.map((item) => (
          <div key={item.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{item.valor}</span>
              <AlternarItemAtivo id={item.id} ativo={item.ativo} />
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted-foreground">Ordem</dt>
                <dd className="min-w-0 flex-1">{item.ordem}</dd>
              </div>
            </dl>
            <div className="mt-3 flex justify-end gap-1 border-t border-border pt-3">
              <ItemForm listaId={lista.id} listaChave={lista.chave} item={item} />
              <ExcluirItemButton id={item.id} valor={item.valor} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
