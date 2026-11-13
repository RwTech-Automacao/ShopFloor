import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarPostos } from '@/modules/shopfloor/infra/ordem-repository'
import { listarEstruturas } from '@/modules/shopfloor/infra/estrutura-repository'
import { EstruturasCliente } from './estruturas-cliente'

export default async function EstruturasPage({ searchParams }: { searchParams: Promise<{ pmo?: string | string[] }> }) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return <SemPermissao descricao="Você não tem permissão para gerenciar estruturas." />
  }
  const { pmo } = await searchParams
  const pmoInicial = (Array.isArray(pmo) ? pmo[0] : pmo)?.trim() || undefined
  const [estruturas, postos] = await Promise.all([listarEstruturas(), listarPostos()])
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Estruturas</h2>
        <p className="text-sm text-muted-foreground">
          Em que posto termina cada PRT de uma PMO. Com a estrutura ativa, o ShopFloor aponta as PRTs no Compels.
        </p>
      </div>
      <EstruturasCliente estruturas={estruturas} postos={postos.map((p) => p.chave).filter((c) => c !== 'Manutenção')} pmoInicial={pmoInicial} />
    </div>
  )
}
