import Link from 'next/link'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarOrdens, listarPostos } from '@/modules/shopfloor/infra/ordem-repository'
import { mapaPostoPerfil } from '@/modules/shopfloor/infra/postos-repository'
import { listarEspelho } from '@/modules/shopfloor/infra/espelho-ops-repository'
import { novaOpLiberada } from '@/modules/shopfloor/application/liberacao-nova-op'
import { NovaOpCliente } from './nova-op-cliente'

export default async function NovaOpPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar') || !novaOpLiberada(sessao.email)) {
    return <SemPermissao descricao="Você não tem permissão para gerenciar ordens de produção." />
  }
  const [espelho, postos, postosPerfil, ordens] = await Promise.all([listarEspelho(), listarPostos(), mapaPostoPerfil(), listarOrdens()])
  const chaves = postos.map((p) => p.chave).filter((c) => c !== 'Manutenção')
  const clientes = [...new Set(ordens.map((o) => o.cliente))].filter((c) => c.trim() !== '').sort()
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Nova OP</h2>
        <p className="text-sm text-muted-foreground">
          Escolha a PMO e a OP do Compels: as OPs filhas (PRTs) entram como trechos da mesma OP.{' '}
          <Link href="/shopfloor/ordens-nova" className="underline">Voltar às ordens</Link>
        </p>
      </div>
      <NovaOpCliente espelho={espelho} postos={chaves} postosPerfil={postosPerfil} clientesExistentes={clientes} />
    </div>
  )
}
