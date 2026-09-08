import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { consultarRegistros, listarClientesRegistros } from '@/modules/shopfloor/infra/registros-repository'
import { listarPostos } from '@/modules/shopfloor/infra/ordem-repository'
import { parsearFiltrosRegistros, TAMANHOS_PAGINA } from '@/modules/shopfloor/domain/registros-filtros'
import { RegistrosFiltros } from './registros-filtros'
import { RegistrosTabela } from './registros-tabela'
import { RegistrosPaginacao } from './registros-paginacao'

export const dynamic = 'force-dynamic'

const TAMANHO_PADRAO = '100'
/** "Todos" tem teto: 27 mil linhas no DOM travam o navegador. Acima disso, use Exportar. */
const TETO_TODOS = 5000

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
    tamanho?: string
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

  const escolhido = (TAMANHOS_PAGINA as readonly string[]).includes(sp.tamanho ?? '') ? sp.tamanho! : TAMANHO_PADRAO
  const tamanho = escolhido === 'todos' ? TETO_TODOS : Number.parseInt(escolhido, 10)

  const filtros = parsearFiltrosRegistros(sp)

  const [{ linhas, total }, clientes, postos] = await Promise.all([
    consultarRegistros(filtros, pagina, tamanho),
    listarClientesRegistros(),
    listarPostos(),
  ])

  const totalPaginas = Math.max(1, Math.ceil(total / tamanho))

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Registros</h2>
        <p className="text-sm text-muted-foreground">{total} registro{total === 1 ? '' : 's'}</p>
      </div>

      <RegistrosFiltros clientes={clientes} postos={postos.map((p) => p.chave)} />

      <RegistrosTabela linhas={linhas} podeAdministrar={podeAdministrar} />

      <RegistrosPaginacao
        pagina={pagina}
        totalPaginas={totalPaginas}
        total={total}
        tamanho={escolhido}
        truncado={escolhido === 'todos' && total > TETO_TODOS}
      />
    </div>
  )
}
