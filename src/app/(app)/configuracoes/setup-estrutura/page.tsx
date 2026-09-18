import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarOrdensSetup, listarPmosComEstrutura } from '@/modules/setup/infra/setup-repository'
import { EstruturaTela } from './estrutura-tela'

export default async function SetupEstruturaPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'setup', 'administrar')) {
    return <SemPermissao descricao="Você não tem permissão para administrar a estrutura da PMO." />
  }

  const [ordens, pmos] = await Promise.all([listarOrdensSetup(), listarPmosComEstrutura()])
  return <EstruturaTela pmos={[...new Set(ordens.map((o) => o.pmo))].sort()} comEstrutura={pmos} />
}
