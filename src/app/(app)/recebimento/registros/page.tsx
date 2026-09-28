import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import {
  consultarRegistros,
  listarValoresDistintos,
} from '@/modules/recebimento/infra/registros-repository'
import { carregarCamposFormulario } from '@/modules/recebimento/infra/processo-detalhe-repository'
import {
  parsearFiltrosRegistros,
  TAMANHOS_PAGINA,
} from '@/modules/recebimento/domain/registros-filtros'
import { RegistrosFiltros } from './registros-filtros'
import { RegistrosTabela } from './registros-tabela'
import { RegistrosPaginacao } from './registros-paginacao'

export const dynamic = 'force-dynamic'

const TAMANHO_PADRAO = '100'

interface RegistrosPageProps {
  searchParams: Promise<{
    emb?: string
    item?: string
    fornecedor?: string
    etapa?: string
    de?: string
    ate?: string
    colaborador?: string
    pagina?: string
    tamanho?: string
  }>
}

export default async function RegistrosRecebimentoPage({ searchParams }: RegistrosPageProps) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver os registros do Recebimento." />
  }

  const sp = await searchParams
  const paginaSolicitada = Number.parseInt(sp.pagina ?? '0', 10)
  const pagina = Number.isFinite(paginaSolicitada) && paginaSolicitada > 0 ? paginaSolicitada : 0

  const escolhido = (TAMANHOS_PAGINA as readonly string[]).includes(sp.tamanho ?? '')
    ? sp.tamanho!
    : TAMANHO_PADRAO
  const tamanho = Number.parseInt(escolhido, 10)

  const filtros = parsearFiltrosRegistros(sp)

  const [{ linhas, total }, embs, fornecedores, campos] = await Promise.all([
    consultarRegistros(filtros, pagina, tamanho),
    listarValoresDistintos('numero_emb'),
    listarValoresDistintos('fornecedor'),
    carregarCamposFormulario(),
  ])

  // campo → rótulo: o detalhe mostra "Quantidade recebida", não `quantidade_recebida`.
  const rotulos = Object.fromEntries(campos.map((c) => [c.campo, c.rotulo]))
  const totalPaginas = Math.max(1, Math.ceil(total / tamanho))

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Registros do Recebimento</h2>
        <p className="text-sm text-muted-foreground">
          As passagens de etapa de cada item. Clique numa linha para ver o que mudou.
        </p>
      </div>

      <RegistrosFiltros embs={embs} fornecedores={fornecedores} />

      <RegistrosTabela linhas={linhas} rotulos={rotulos} />

      <RegistrosPaginacao
        pagina={pagina}
        totalPaginas={totalPaginas}
        total={total}
        tamanho={escolhido}
      />
    </div>
  )
}
