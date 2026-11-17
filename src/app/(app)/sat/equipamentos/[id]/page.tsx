import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { ITENS_JUNTO, FRETES } from '@/modules/sat/domain/entrada'
import { lerEntrada, listarMotivos, type HistoricoNf } from '@/modules/sat/infra/repository'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { StatusNf } from '../../situacao-nf'
import { dia, quando, reais } from '../../formato'
import { MudarNf } from './mudar-nf'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function textoHistorico(h: HistoricoNf): string {
  const mot = h.motivos.length > 0 ? ` (${h.motivos.join('; ')})` : ''
  if (h.tipo === 'entrada') return `Entrada com a NF ${h.nfPara} ${h.situacaoPara}${mot}`
  if (h.tipo === 'correcao') return `NF ${h.nfPara} corrigida: ${h.situacaoDe} → ${h.situacaoPara}${mot}`
  return `NF ${h.nfDe} (${h.situacaoDe}) substituída pela NF ${h.nfPara} ${h.situacaoPara}${mot}`
}

/** SAT → ficha do equipamento recebido, com o histórico da NF. Corrigir/trocar a NF: sat.aprovar_nf. */
export default async function FichaSatPage({ params }: { params: Promise<{ id: string }> }) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'sat', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver os equipamentos do SAT." />
  }
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const e = await lerEntrada(id)
  if (!e) notFound()
  const podeNf = podeNoModulo(sessao.perfil, 'sat', 'aprovar_nf')
  const motivos = podeNf ? await listarMotivos() : []

  const itens = e.itensJunto.map((i) => (i === 'outros' ? `Outros: ${e.itensJuntoOutros}` : ITENS_JUNTO.find((x) => x.chave === i)?.rotulo ?? i))
  const linhas: [string, string][] = [
    ['Número de série', e.nsEscrito],
    ['Modelo / sequência', e.modelo && e.sequencia ? `${e.modelo} / ${e.sequencia}` : e.sequencia ?? '—'],
    ['OS', e.osNumero || '—'],
    ['Empresa', e.empresa || '—'],
    ['CNPJ', e.cnpj || '—'],
    ['Produto', e.produto || '—'],
    ['NF de entrada', e.nf],
    ['Valor unitário', reais(e.valor)],
    ['Frete de entrada', FRETES.find((f) => f.chave === e.frete)?.rotulo ?? '—'],
    ['Itens que vieram junto', itens.join(', ') || '—'],
    ['Defeito relatado', e.defeito || '—'],
    ['Locação', e.locacao || '—'],
    ['Custo', reais(e.custo)],
    ['Recebido em', dia(e.data)],
    ['Responsável', e.responsavelNome || '—'],
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/sat/equipamentos" className="text-sm underline">← Equipamentos</Link>
        <h2 className="text-lg font-semibold text-tinta">Ficha — {e.nsEscrito}</h2>
        <StatusNf situacao={e.situacao} />
      </div>
      {e.situacao === 'reprovada' && e.motivos.length > 0 && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">Motivos: {e.motivos.join('; ')}</p>
      )}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border bg-white p-3 text-sm sm:grid-cols-2">
        {linhas.map(([r, v]) => (
          <div key={r} className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{r}</dt>
            <dd className="whitespace-pre-wrap">{v}</dd>
          </div>
        ))}
      </dl>

      {podeNf && <MudarNf entradaId={e.id} nfAtual={e.nf} motivos={motivos} />}

      <section className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-tinta">Histórico da NF</h3>
        <ol className="flex flex-col gap-1 rounded-lg border bg-white p-3 text-sm">
          {e.historico.map((h, i) => (
            <li key={i} className="flex flex-wrap gap-x-3">
              <span className="text-muted-foreground">{quando(h.em)}</span>
              <span>{textoHistorico(h)}</span>
              <span className="text-muted-foreground">— {h.usuarioNome || '—'}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
