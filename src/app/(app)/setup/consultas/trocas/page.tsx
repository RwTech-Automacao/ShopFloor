import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { listarEquipamentos } from '@/modules/setup/infra/setup-repository'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { TrocasConsulta } from './trocas-consulta'

export default async function ConsultarTrocasPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'setup', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para consultar trocas de rolo." />
  }
  return <TrocasConsulta equipamentos={await listarEquipamentos()} />
}
