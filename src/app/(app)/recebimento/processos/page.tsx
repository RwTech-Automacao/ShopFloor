import Link from 'next/link'
import { PlusIcon } from 'lucide-react'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { Button } from '@/components/ui/button'
import { decodificarEstadoGrid } from '@/modules/recebimento/domain/estado-grid'
import {
  carregarCatalogoColunas,
  listarColunasLista,
  listarProcessosGrid,
} from '@/modules/recebimento/infra/processo-repository'
import { ProcessosGrid } from './processos-grid'

interface ProcessosPageProps {
  searchParams: Promise<{ g?: string }>
}

export default async function ProcessosPage({ searchParams }: ProcessosPageProps) {
  const { g } = await searchParams

  const [sessao, catalogo, layout] = await Promise.all([
    getSessao(),
    carregarCatalogoColunas(),
    listarColunasLista(),
  ])
  const podeCriar = podeFazer(sessao?.perfil ?? null, 'editar')

  // Estado vem da URL e é validado contra o catálogo (nada dele é confiável).
  const estado = decodificarEstadoGrid(
    g,
    catalogo.map((c) => c.campo),
  )

  // Colunas visíveis, na ordem do layout, restritas ao catálogo.
  const porCampo = new Map(catalogo.map((c) => [c.campo, c]))
  const colunas = layout
    .filter((c) => c.visivel)
    .map((c) => porCampo.get(c.campo))
    .filter((c): c is NonNullable<typeof c> => c !== undefined)

  const tiposPorCampo = Object.fromEntries(catalogo.map((c) => [c.campo, c.tipo]))
  const { linhas, total } = await listarProcessosGrid({
    estado,
    colunas: colunas.map((c) => c.campo),
    tiposPorCampo,
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Processos</h1>
        {podeCriar && (
          <Button
            className="bg-enterplak hover:bg-enterplak-700"
            render={<Link href="/recebimento/processos/novo" />}
          >
            <PlusIcon />
            Adicionar processo
          </Button>
        )}
      </div>

      <ProcessosGrid colunas={colunas} linhas={linhas} total={total} estado={estado} />
    </div>
  )
}
