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

// Esta página busca usuários via API admin (service-role, sem cookies), então o
// Next não a detecta como dinâmica sozinho e tenta avaliá-la na coleta de dados
// do build — o que faz uma chamada real ao Supabase e quebra o build se a rede
// falha. Forçamos render dinâmico: a página é sempre por-requisição mesmo.
export const dynamic = 'force-dynamic'

export default async function UsuariosPage() {
  const [usuarios, perfis] = await Promise.all([listarUsuarios(), listarPerfis()])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <UsuarioForm perfis={perfis} />
      </div>

      {/* Desktop: tabela */}
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
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
            {usuarios.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  Nenhum usuário encontrado.
                </TableCell>
              </TableRow>
            )}
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

      {/* Mobile: cards */}
      <div className="space-y-3 lg:hidden">
        {usuarios.length === 0 && (
          <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
            Nenhum usuário encontrado.
          </p>
        )}
        {usuarios.map((usuario) => (
          <div key={usuario.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{usuario.nome}</span>
              <Badge variant="outline">{usuario.perfis.nome}</Badge>
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-muted-foreground">E-mail</dt>
                <dd className="min-w-0 flex-1 truncate">{usuario.email}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="w-24 shrink-0 text-muted-foreground">Ativo</dt>
                <dd className="min-w-0 flex-1">
                  <AlternarAtivoUsuario id={usuario.id} ativo={usuario.ativo} />
                </dd>
              </div>
            </dl>
            <div className="mt-3 flex justify-end gap-1 border-t border-border pt-3">
              <UsuarioForm usuario={usuario} perfis={perfis} />
              <RedefinirSenhaButton id={usuario.id} nome={usuario.nome} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
