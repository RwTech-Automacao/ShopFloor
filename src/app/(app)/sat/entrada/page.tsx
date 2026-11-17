import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { listarMotivos } from '@/modules/sat/infra/repository'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { EntradaTela } from './entrada-tela'

/**
 * SAT → Entrada de equipamento (spec 2026-11-17-sat-entrada-design.md): a metade de entrada da FO-161.
 * Precisa de sat.visualizar e sat.registrar_entrada (conferidos de novo na action e no banco).
 */
export default async function EntradaSatPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'sat', 'visualizar') || !podeNoModulo(sessao.perfil, 'sat', 'registrar_entrada')) {
    return <SemPermissao descricao="Você não tem permissão para registrar a entrada de equipamentos no SAT." />
  }
  const motivos = await listarMotivos()
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-tinta">Entrada de equipamento</h2>
      <EntradaTela motivos={motivos} />
    </div>
  )
}
