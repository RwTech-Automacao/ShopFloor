import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { OrdensConteudo } from './ordens-conteudo'

export default async function OrdensPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return <SemPermissao descricao="Você não tem permissão para gerenciar ordens de produção." />
  }
  // Sempre o cadastro antigo (OrdemForm); a tela nova fica em /shopfloor/ordens-nova.
  return <OrdensConteudo />
}
