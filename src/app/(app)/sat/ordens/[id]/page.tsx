import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { rotuloTipo } from '@/modules/sat/domain/ordem'
import { lerOrdem, listarDefeitosAtivos } from '@/modules/sat/infra/ordens-repository'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { Dados, Secao } from '../../blocos'
import { EtapaOrdem, TipoOrdemSelo } from '../../etapa-ordem'
import { quando } from '../../formato'
import { CorrigirEtapa } from './corrigir-etapa'
import { textoEvento } from './linha-do-tempo'
import { Manutencao } from './manutencao'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * SAT → ficha da OS: cabeçalho, manutenção (defeitos, peças, laudo, troca de NS — com sat.manutencao), trocas de NS,
 * correção de etapa (sat.administrar) e a linha do tempo. sat.visualizar.
 */
export default async function FichaOrdemPage({ params }: { params: Promise<{ id: string }> }) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'sat', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver as ordens de serviço do SAT." />
  }
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const o = await lerOrdem(id)
  if (!o) notFound()
  const podeManutencao = podeNoModulo(sessao.perfil, 'sat', 'manutencao')
  const podeAdministrar = podeNoModulo(sessao.perfil, 'sat', 'administrar')
  const defeitosAtivos = podeManutencao && o.etapa === 'em_manutencao' ? await listarDefeitosAtivos() : []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/sat/ordens" className="text-sm underline">← Ordens de serviço</Link>
        <h2 className="text-lg font-semibold text-tinta">OS {o.numero}</h2>
        <EtapaOrdem etapa={o.etapa} />
        <TipoOrdemSelo tipo={o.tipo} />
      </div>

      <Secao titulo="Ordem de serviço">
        <Dados linhas={[
          ['Número de série', o.nsAtual || '—'],
          ['Produto', o.produto || '—'],
          ['Cliente', o.cliente || '—'],
          ['CNPJ', o.cnpj || '—'],
          ['Tipo', rotuloTipo(o.tipo)],
          ['Garantia (planilha)', o.garantia || '—'],
          ['Ticket do suporte', o.ticketNumero || '—'],
          ['NF de entrada', o.nf ? `NF ${o.nf.numero} (${o.nf.situacao})` : '—'],
          ['Técnico', o.tecnicoNome || '—'],
          ['Aberta em', quando(o.criadoEm)],
          ['Nesta etapa há', o.tempoNaEtapa],
        ]} />
        {o.entradaId && (
          <Link className="text-sm underline" href={`/sat/equipamentos/${o.entradaId}`}>Ver o relógio recebido</Link>
        )}
      </Secao>

      <Manutencao
        ordemId={o.id} etapa={o.etapa} tipo={o.tipo} podeManutencao={podeManutencao}
        defeitos={o.defeitos} pecas={o.pecas} laudo={o.laudo} defeitosAtivos={defeitosAtivos}
      />

      {o.trocasNs.length > 0 && (
        <Secao titulo="Trocas de número de série">
          <ul className="flex flex-col gap-1 text-sm">
            {o.trocasNs.map((t) => (
              <li key={t.id} className="flex flex-wrap gap-x-3">
                <span className="font-mono">{t.nsAntigo} → {t.nsNovo}</span>
                <span className="text-muted-foreground">{quando(t.em)} — {t.usuarioNome || '—'}</span>
              </li>
            ))}
          </ul>
        </Secao>
      )}

      {podeAdministrar && <CorrigirEtapa ordemId={o.id} etapaAtual={o.etapa} />}

      <section className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-tinta">Linha do tempo</h3>
        <ol className="flex flex-col gap-1 rounded-lg border bg-white p-3 text-sm">
          {o.historico.map((h, i) => (
            <li key={i} className="flex flex-wrap gap-x-3">
              <span className="text-muted-foreground">{quando(h.em)}</span>
              <span>{textoEvento(h)}</span>
              <span className="text-muted-foreground">— {h.usuarioNome || '—'}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
