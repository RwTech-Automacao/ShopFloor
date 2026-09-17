import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'

export default async function MontarSetupPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'setup', 'lancar')) {
    return <SemPermissao descricao="Você não tem permissão para montar setup." />
  }
  return <p className="text-sm text-muted-foreground">Em construção.</p>
}
