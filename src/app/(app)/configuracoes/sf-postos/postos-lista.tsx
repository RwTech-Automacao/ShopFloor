'use client'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { PostoRow } from '@/modules/shopfloor/infra/ordem-repository'
import type { PerfilPosto } from '@/modules/shopfloor/domain/perfil-posto'
import { PostoForm, EditarPostoButton, ExcluirPostoButton } from './posto-form'

interface PostosListaProps {
  postos: PostoRow[]
  perfis: PerfilPosto[]
  emUso: string[]
}

export function PostosLista({ postos, perfis, emUso }: PostosListaProps) {
  const emUsoSet = new Set(emUso)
  const lista = [...postos].sort((a, b) => a.ordem - b.ordem)
  const nomePerfil = (chave: string) => perfis.find((p) => p.chave === chave)?.nome ?? chave
  const vazio = 'Nenhum posto cadastrado.'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Postos</h1>
        <PostoForm perfis={perfis} />
      </div>

      {/* Desktop: tabela */}
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Ordem</TableHead>
              <TableHead>Perfil</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  {vazio}
                </TableCell>
              </TableRow>
            )}
            {lista.map((p) => {
              const bloqueado = emUsoSet.has(p.chave)
              return (
                <TableRow key={p.chave}>
                  <TableCell className="font-medium">{p.chave}</TableCell>
                  <TableCell>{p.ordem}</TableCell>
                  <TableCell>{nomePerfil(p.perfil)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <EditarPostoButton posto={p} perfis={perfis} bloqueado={bloqueado} />
                      <ExcluirPostoButton chave={p.chave} bloqueado={bloqueado} />
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 lg:hidden">
        {lista.length === 0 && (
          <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
            {vazio}
          </p>
        )}
        {lista.map((p) => {
          const bloqueado = emUsoSet.has(p.chave)
          return (
            <div key={p.chave} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <span className="font-semibold">{p.chave}</span>
                  <span className="text-xs text-muted-foreground">
                    Ordem {p.ordem} · {nomePerfil(p.perfil)}
                  </span>
                  {bloqueado && (
                    <span className="text-xs text-amber-700 dark:text-amber-400">
                      Em uso em uma OP
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  <EditarPostoButton posto={p} perfis={perfis} bloqueado={bloqueado} />
                  <ExcluirPostoButton chave={p.chave} bloqueado={bloqueado} />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
