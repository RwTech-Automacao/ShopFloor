import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { listarEquipamentos, listarOrdensSetup } from '@/modules/setup/infra/setup-repository'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { Abastecimento } from './abastecimento'

export default async function AbastecimentoSetupPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'setup', 'lancar')) {
    return <SemPermissao descricao="Você não tem permissão para trocar rolo." />
  }
  const [ordens, equipamentos] = await Promise.all([listarOrdensSetup(), listarEquipamentos(true)])
  return <Abastecimento ordens={ordens} equipamentos={equipamentos} />
}
