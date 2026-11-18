import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { VitrineFluxo } from './vitrine-fluxo'

/**
 * Vitrine do marketing: o Fluxo da OP com uma produção fictícia perfeita. A página só confere a
 * permissão própria (`vitrine.visualizar`); os dados nascem no navegador (fonte-vitrine) — nada aqui
 * consulta o banco, o Compels ou qualquer dado real.
 */
export default async function VitrineFluxoPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'vitrine', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver a vitrine." />
  }
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-tinta">Fluxo da OP</h2>
      <VitrineFluxo />
    </div>
  )
}
