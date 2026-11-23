import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { buscarOrdemComTrechos, contarRegistros, listarOrdens, listarPostos } from '@/modules/shopfloor/infra/ordem-repository'
import { mapaPostoPerfil } from '@/modules/shopfloor/infra/postos-repository'
import { listarEspelho } from '@/modules/shopfloor/infra/espelho-ops-repository'
import { resumoTrechosDaOp } from '@/modules/shopfloor/infra/estrutura-repository'
import { trechosDaOpGravada } from '@/modules/shopfloor/domain/edicao-op-trechos'
import { agruparReceitaPorPosto } from '@/modules/shopfloor/domain/receita-posto'
import { agruparTempoBurninPorPosto } from '@/modules/shopfloor/domain/burnin-posto'
import { EditarOpCliente } from './editar-op-cliente'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Edição de OP com trechos do Compels (0184). OP sem trechos segue no cadastro antigo (modal da lista). */
export default async function EditarOpPage({ params }: { params: Promise<{ id: string }> }) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return <SemPermissao descricao="Você não tem permissão para gerenciar ordens de produção." />
  }
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const ordem = await buscarOrdemComTrechos(id)
  if (!ordem) notFound()
  if (ordem.sf_ordem_trechos.length === 0) redirect('/shopfloor/ordens-nova')

  const [postos, postosPerfil, ordens, espelho, resumo, registros] = await Promise.all([
    listarPostos(),
    mapaPostoPerfil(),
    listarOrdens(),
    // Só enfeita os trechos (quantidade e situação no Compels): sem o espelho a página abre igual.
    listarEspelho().catch(() => []),
    resumoTrechosDaOp(ordem.pmo, ordem.op).catch(() => null),
    // Falha = trata como sem registros; o servidor recusa ao salvar se houver (a mesma regra do cadastro antigo).
    contarRegistros(ordem.pmo, ordem.op).catch(() => 0),
  ])
  const chaves = postos.map((p) => p.chave).filter((c) => c !== 'Manutenção')
  const clientes = [...new Set(ordens.map((o) => o.cliente))].filter((c) => c.trim() !== '').sort()
  const pmos = [...new Set(ordens.map((o) => o.pmo))].sort()
  const trechos = trechosDaOpGravada(ordem.sf_ordem_trechos, ordem.sf_ordem_postos, ordem.sf_ordem_faixas ?? [], espelho)

  return (
    <div className="flex min-h-full flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">{`Editar OP ${ordem.pmo}/${ordem.op}`}</h2>
        <p className="text-sm text-muted-foreground">
          OP dividida em trechos do Compels: as PRTs e a PMO.{' '}
          <Link href="/shopfloor/ordens-nova" className="underline">Voltar às ordens</Link>
        </p>
      </div>
      <EditarOpCliente
        ordem={{
          id: ordem.id, pmo: ordem.pmo, op: ordem.op, cliente: ordem.cliente, qtd: ordem.qtd, descricao: ordem.descricao,
          acp: ordem.acp, status: ordem.status, embalagemIndividual: ordem.embalagem_individual, placasPorPainel: ordem.placas_por_painel,
        }}
        trechos={trechos}
        resumo={resumo}
        postos={chaves}
        postosPerfil={postosPerfil}
        clientesExistentes={clientes}
        temRegistros={registros > 0}
        receita={agruparReceitaPorPosto(ordem.sf_ordem_componentes)}
        tempoBurnin={agruparTempoBurninPorPosto(ordem.sf_ordem_burnin)}
        pmosExistentes={pmos}
      />
    </div>
  )
}
