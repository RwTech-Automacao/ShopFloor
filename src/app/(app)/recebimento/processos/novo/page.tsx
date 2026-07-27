import Link from 'next/link'
import { ArrowLeftIcon } from 'lucide-react'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { carregarCamposFormulario } from '@/modules/recebimento/infra/processo-detalhe-repository'
import { carregarItensPorLista } from '@/modules/recebimento/infra/campo-comercial-repository'
import { NovoProcessoForm } from './novo-processo-form'

export default async function NovoProcessoPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'editar')) {
    return <SemPermissao descricao="Você não tem permissão para criar processos." />
  }

  const todos = await carregarCamposFormulario()
  const campos = todos.filter(
    (campo) => (campo.grupo === 'comercial' || campo.grupo === 'material') && !campo.calculado,
  )
  const chaves = [
    ...new Set(
      campos
        .filter((campo) => campo.tipo === 'lista' && campo.listaChave)
        .map((campo) => campo.listaChave as string),
    ),
  ]
  const itensPorLista = await carregarItensPorLista(chaves)

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/recebimento/processos"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-enterplak hover:underline"
      >
        <ArrowLeftIcon className="size-4" />
        Voltar para Processos
      </Link>
      <h1 className="text-2xl font-semibold">Novo processo</h1>
      <NovoProcessoForm campos={campos} itensPorLista={itensPorLista} />
    </div>
  )
}
