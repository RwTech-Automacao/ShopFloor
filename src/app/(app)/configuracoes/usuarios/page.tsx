import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { listarUsuarios } from '@/modules/usuarios/infra/usuario-admin-repository'
import { listarPerfis } from '@/modules/perfis/infra/perfil-repository'
import { UsuarioForm, RedefinirSenhaButton, AlternarAtivoUsuario } from './usuario-form'

export default async function UsuariosPage() {
  const [usuarios, perfis] = await Promise.all([listarUsuarios(), listarPerfis()])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Usuários</h1>
        <UsuarioForm perfis={perfis} />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>E-mail</TableHead>
            <TableHead>Perfil</TableHead>
            <TableHead className="text-center">Ativo</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {usuarios.map((usuario) => (
            <TableRow key={usuario.id}>
              <TableCell className="font-medium">{usuario.nome}</TableCell>
              <TableCell>{usuario.email}</TableCell>
              <TableCell>
                <Badge variant="outline">{usuario.perfis.nome}</Badge>
              </TableCell>
              <TableCell className="text-center">
                <AlternarAtivoUsuario id={usuario.id} ativo={usuario.ativo} />
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <UsuarioForm usuario={usuario} perfis={perfis} />
                  <RedefinirSenhaButton id={usuario.id} nome={usuario.nome} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
