import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarEquipamentos } from '@/modules/setup/infra/setup-repository'
import { EquipamentosLista } from './equipamentos-lista'

export default async function SetupEquipamentosPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'setup', 'administrar')) {
    return <SemPermissao descricao="Você não tem permissão para administrar linhas e máquinas." />
  }

  const equipamentos = await listarEquipamentos()
  return <EquipamentosLista equipamentos={equipamentos} />
}
