import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { novaOpLiberada } from '@/modules/shopfloor/application/liberacao-nova-op'
import { OrdensConteudo } from '../ordens/ordens-conteudo'

export default async function OrdensNovaPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar') || !novaOpLiberada(sessao.email)) {
    return <SemPermissao descricao="Você não tem permissão para gerenciar ordens de produção." />
  }
  return <OrdensConteudo novaOpHref="/shopfloor/ordens/nova" />
}
