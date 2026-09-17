import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { listarEquipamentos, listarOrdensSetup } from '@/modules/setup/infra/setup-repository'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { MontarSetup } from './montar-setup'

export default async function MontarSetupPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'setup', 'lancar')) {
    return <SemPermissao descricao="Você não tem permissão para montar setup." />
  }
  const [ordens, equipamentos] = await Promise.all([listarOrdensSetup(), listarEquipamentos(true)])
  return (
    <MontarSetup
      ordens={ordens}
      equipamentos={equipamentos}
      podeAdministrar={podeNoModulo(sessao.perfil, 'setup', 'administrar')}
    />
  )
}
