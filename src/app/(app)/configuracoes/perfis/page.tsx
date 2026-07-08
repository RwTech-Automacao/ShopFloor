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
import { listarPerfis } from '@/modules/perfis/infra/perfil-repository'
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

export default async function PerfisPage() {
  const perfis = await listarPerfis()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Perfis</h1>
        <PerfilForm />
      </div>

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
                  <PerfilForm perfil={perfil} />
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
  )
}
