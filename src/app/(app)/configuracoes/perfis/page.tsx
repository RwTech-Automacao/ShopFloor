import { CheckIcon, MinusIcon } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { listarPerfisComGrants } from '@/modules/perfis/infra/perfil-repository'
import { PERMISSOES } from '@/modules/perfis/domain/regras-perfil'
import type { PerfilRow } from '@/modules/auth/domain/mapear-perfil'
import { PerfilForm, ExcluirPerfilButton } from './perfil-form'

function FlagCell({ marcado }: { marcado: boolean }) {
  return (
    <TableCell className="text-center">
      {marcado ? (
        <CheckIcon className="mx-auto size-4 text-enterplak" />
      ) : (
        <MinusIcon className="mx-auto size-4 text-muted-foreground" />
      )}
    </TableCell>
  )
}

function FlagIcon({ marcado }: { marcado: boolean }) {
  return marcado ? (
    <CheckIcon className="size-4 text-enterplak" />
  ) : (
    <MinusIcon className="size-4 text-muted-foreground" />
  )
}

export default async function PerfisPage() {
  const perfis = await listarPerfisComGrants()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <PerfilForm />
      </div>

      {/* Desktop: tabela */}
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              {PERMISSOES.map((permissao) => (
                <TableHead key={permissao.chave} className="text-center">
                  {permissao.rotulo}
                </TableHead>
              ))}
              <TableHead className="text-center">Sistema</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {perfis.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={PERMISSOES.length + 3}
                  className="py-8 text-center text-muted-foreground"
                >
                  Nenhum perfil encontrado.
                </TableCell>
              </TableRow>
            )}
            {perfis.map((perfil: PerfilRow) => (
              <TableRow key={perfil.id}>
                <TableCell className="font-medium">{perfil.nome}</TableCell>
                <FlagCell marcado={perfil.pode_visualizar} />
                <FlagCell marcado={perfil.pode_importar} />
                <FlagCell marcado={perfil.pode_editar} />
                <FlagCell marcado={perfil.pode_finalizar} />
                <FlagCell marcado={perfil.pode_editar_finalizado} />
                <FlagCell marcado={perfil.pode_excluir} />
                <FlagCell marcado={perfil.pode_gerar_etiqueta} />
                <FlagCell marcado={perfil.pode_administrar} />
                <TableCell className="text-center">
                  {perfil.sistema && <Badge variant="outline">Sistema</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <PerfilForm perfil={perfil} grants={perfil.perfil_permissao} />
                    <ExcluirPerfilButton
                      id={perfil.id}
                      nome={perfil.nome}
                      sistema={perfil.sistema}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 lg:hidden">
        {perfis.length === 0 && (
          <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
            Nenhum perfil encontrado.
          </p>
        )}
        {perfis.map((perfil: PerfilRow) => (
          <div key={perfil.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{perfil.nome}</span>
              {perfil.sistema && <Badge variant="outline">Sistema</Badge>}
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              {PERMISSOES.map((permissao) => {
                const campo = `pode_${permissao.chave}` as keyof PerfilRow
                return (
                  <div key={permissao.chave} className="flex items-center gap-2">
                    <dt className="w-32 shrink-0 text-muted-foreground">{permissao.rotulo}</dt>
                    <dd className="min-w-0 flex-1">
                      <FlagIcon marcado={Boolean(perfil[campo])} />
                    </dd>
                  </div>
                )
              })}
            </dl>
            <div className="mt-3 flex justify-end gap-1 border-t border-border pt-3">
              <PerfilForm perfil={perfil} grants={perfil.perfil_permissao} />
              <ExcluirPerfilButton id={perfil.id} nome={perfil.nome} sistema={perfil.sistema} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
