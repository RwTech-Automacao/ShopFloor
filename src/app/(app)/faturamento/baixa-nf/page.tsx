import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { configBaixaNf } from '@/modules/compels/application/baixar-nfs'
import { carregarTelaBaixaNf } from '@/modules/faturamento/application/carregar-tela'
import { clienteCompelsDoFaturamento } from '@/modules/faturamento/infra/compels'
import { lerFilaDaTela } from '@/modules/faturamento/infra/fila-repository'
import { buscarSaldoPa } from '@/modules/shopfloor/infra/estoque-compels'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { BaixaNfTela } from './baixa-nf-tela'

/**
 * Faturamento → Baixa de NF (spec 2026-11-17-faturamento-baixa-nf-design.md): as NFs de saída pendentes de
 * baixa no Compels (todas, sem data de corte), a seleção com prioridade e a fila. Ver: faturamento.visualizar;
 * selecionar/confirmar/tirar da fila: faturamento.baixar (conferido de novo nas actions e no banco).
 */
export default async function BaixaNfPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'faturamento', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver a baixa de NF." />
  }
  const dados = await carregarTelaBaixaNf({
    compels: clienteCompelsDoFaturamento(),
    lerFila: () => lerFilaDaTela(),
    saldoPa: (codigo) => buscarSaldoPa(codigo),
    modo: configBaixaNf()?.modo ?? null,
  })
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-tinta">Baixa de NF</h2>
      <BaixaNfTela dados={dados} podeBaixar={podeNoModulo(sessao.perfil, 'faturamento', 'baixar')} />
    </div>
  )
}
