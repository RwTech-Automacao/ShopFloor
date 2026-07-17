import {
  carregarCatalogoColunas,
  listarColunasLista,
} from '@/modules/recebimento/infra/processo-repository'
import { ColunasForm } from './colunas-form'

export default async function ColunasPage() {
  const [catalogo, layout] = await Promise.all([carregarCatalogoColunas(), listarColunasLista()])

  const porCampo = new Map(catalogo.map((c) => [c.campo, c]))

  // Visíveis na ordem salva, restritas ao catálogo (linha órfã de campo desativado some).
  const visiveis = layout
    .filter((c) => c.visivel)
    .map((c) => porCampo.get(c.campo))
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
    .map((c) => ({ campo: c.campo, rotulo: c.rotulo }))

  // Disponíveis = catálogo − visíveis (inclui campo novo que ainda não tem linha), A→Z.
  const jaVisivel = new Set(visiveis.map((c) => c.campo))
  const disponiveis = catalogo
    .filter((c) => !jaVisivel.has(c.campo))
    .map((c) => ({ campo: c.campo, rotulo: c.rotulo }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'))

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Colunas da Lista</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Escolha quais colunas aparecem na lista de Processos e em que ordem. Vale para todos os
          usuários.
        </p>
      </div>
      <ColunasForm visiveisIniciais={visiveis} disponiveisIniciais={disponiveis} />
    </div>
  )
}
