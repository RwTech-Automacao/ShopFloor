import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { listarMotivos } from '@/modules/sat/infra/repository'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { MotivosTela } from './motivos-tela'

/** SAT → Motivos de reprovação da NF (lista cadastrada, começa vazia). sat.administrar. */
export default async function MotivosSatPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'sat', 'visualizar') || !podeNoModulo(sessao.perfil, 'sat', 'administrar')) {
    return <SemPermissao descricao="Você não tem permissão para administrar o SAT." />
  }
  const motivos = await listarMotivos()
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-tinta">Motivos de reprovação da NF</h2>
      <MotivosTela motivos={motivos} />
    </div>
  )
}
