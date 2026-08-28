import Link from 'next/link'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { consultarRegistros, listarClientesRegistros } from '@/modules/shopfloor/infra/registros-repository'
import { listarPostos } from '@/modules/shopfloor/infra/ordem-repository'
import { parsearFiltrosRegistros } from '@/modules/shopfloor/domain/registros-filtros'
import { RegistrosFiltros } from './registros-filtros'
import { RegistrosTabela } from './registros-tabela'

export const dynamic = 'force-dynamic'

const TAMANHO_PAGINA = 25

interface RegistrosPageProps {
  searchParams: Promise<{
    cliente?: string
    busca?: string
    posto?: string
    sn?: string
    status?: string
    de?: string
    ate?: string
    pagina?: string
  }>
}

export default async function RegistrosPage({ searchParams }: RegistrosPageProps) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver os registros." />
  }

  const podeAdministrar = podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')

  const sp = await searchParams
  const paginaSolicitada = Number.parseInt(sp.pagina ?? '0', 10)
  const pagina = Number.isFinite(paginaSolicitada) && paginaSolicitada > 0 ? paginaSolicitada : 0

  const filtros = parsearFiltrosRegistros(sp)

  const [{ linhas, total }, clientes, postos] = await Promise.all([
    consultarRegistros(filtros, pagina, TAMANHO_PAGINA),
    listarClientesRegistros(),
    listarPostos(),
  ])

  const totalPaginas = Math.max(1, Math.ceil(total / TAMANHO_PAGINA))
  const temAnterior = pagina > 0
  const temProxima = pagina + 1 < totalPaginas

  function hrefPagina(novaPagina: number): string {
    const params = new URLSearchParams()
    if (sp.cliente) params.set('cliente', sp.cliente)
    if (sp.busca) params.set('busca', sp.busca)
    if (sp.posto) params.set('posto', sp.posto)
    if (sp.sn) params.set('sn', sp.sn)
    if (sp.status) params.set('status', sp.status)
    if (sp.de) params.set('de', sp.de)
    if (sp.ate) params.set('ate', sp.ate)
    if (novaPagina > 0) params.set('pagina', String(novaPagina))
    const query = params.toString()
    return query ? `/shopfloor/registros?${query}` : '/shopfloor/registros'
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Registros</h2>
        <p className="text-sm text-muted-foreground">{total} registro{total === 1 ? '' : 's'}</p>
      </div>

      <RegistrosFiltros clientes={clientes} postos={postos.map((p) => p.chave)} />

      <RegistrosTabela linhas={linhas} podeAdministrar={podeAdministrar} />

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Página {pagina + 1} de {totalPaginas} — {total} registro{total === 1 ? '' : 's'}
        </span>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Página anterior"
            disabled={!temAnterior}
            render={<Link href={hrefPagina(pagina - 1)} />}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Próxima página"
            disabled={!temProxima}
            render={<Link href={hrefPagina(pagina + 1)} />}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </div>
    </div>
  )
}
