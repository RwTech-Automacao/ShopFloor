import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { listarEquipamentos } from '@/modules/setup/infra/setup-repository'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { SetupsConsulta } from './setups-consulta'

export default async function ConsultarSetupsPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'setup', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para consultar setups." />
  }
  return <SetupsConsulta equipamentos={await listarEquipamentos()} />
}
