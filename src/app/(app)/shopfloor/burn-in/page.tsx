import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarBurninAberto } from '@/modules/shopfloor/infra/burnin-repository'
import { BurninPainel } from './burnin-painel'

export default async function BurnInPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para acessar o Burn-in." />
  }
  const itens = await listarBurninAberto()
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Burn-in</h2>
        <p className="text-sm text-muted-foreground">Peças em Burn-in agora, com tempo decorrido ao vivo.</p>
      </div>
      <BurninPainel itens={itens} />
    </div>
  )
}
