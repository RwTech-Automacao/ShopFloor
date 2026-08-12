import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { RepinmetroForm } from './repinmetro-form'

export default async function RepinmetroPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para acessar os logs do repinmetro." />
  }
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Repinmetro</h2>
        <p className="text-sm text-muted-foreground">
          Testes de qualidade do repinmetro por Nº de Série do produto final.
        </p>
      </div>
      <RepinmetroForm />
    </div>
  )
}
