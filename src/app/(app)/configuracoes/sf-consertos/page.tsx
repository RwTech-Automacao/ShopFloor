import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarConsertos } from '@/modules/shopfloor/infra/consertos-repository'
import { ConsertosLista } from './consertos-lista'

export default async function ConsertosPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return <SemPermissao descricao="Você não tem permissão para gerenciar consertos." />
  }

  const consertos = await listarConsertos()
  return <ConsertosLista consertos={consertos} />
}
