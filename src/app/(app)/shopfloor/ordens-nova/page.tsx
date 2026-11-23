import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { OrdensConteudo } from '../ordens/ordens-conteudo'

export default async function OrdensNovaPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return <SemPermissao descricao="Você não tem permissão para gerenciar ordens de produção." />
  }
  return <OrdensConteudo editarTrechosBase="/shopfloor/ordens-nova" cadeiaPrt />
}
