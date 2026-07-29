import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarDefeitos } from '@/modules/shopfloor/infra/defeitos-repository'
import { DefeitosLista } from './defeitos-lista'

export default async function DefeitosPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return <SemPermissao descricao="Você não tem permissão para gerenciar defeitos." />
  }

  const defeitos = await listarDefeitos()
  return <DefeitosLista defeitos={defeitos} />
}
