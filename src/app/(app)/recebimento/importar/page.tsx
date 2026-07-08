import { redirect } from 'next/navigation'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import {
  carregarCamposComerciais,
  carregarItensPorLista,
} from '@/modules/recebimento/infra/campo-comercial-repository'
import { WizardImportacao } from './wizard-importacao'

export default async function ImportarPage() {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'importar')) redirect('/home')

  const campos = await carregarCamposComerciais()
  const chaves = Array.from(
    new Set(campos.map((campo) => campo.listaChave).filter((chave): chave is string => chave !== null)),
  )
  const itensPorLista = await carregarItensPorLista(chaves)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Importar planilha</h1>
      <WizardImportacao campos={campos} itensPorLista={itensPorLista} />
    </div>
  )
}
