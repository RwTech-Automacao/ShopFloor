import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { ITENS_JUNTO } from '@/modules/sat/domain/entrada'
import { ordemDaEntrada } from '@/modules/sat/infra/ordens-repository'
import { lerEntrada, listarMotivos, type HistoricoSat } from '@/modules/sat/infra/repository'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { EtapaOrdem } from '../../etapa-ordem'
import { StatusNf } from '../../situacao-nf'
import { dia, quando, reais } from '../../formato'
import { MudarNf } from './mudar-nf'
import { TrocarOs } from './trocar-os'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const campo = (o: Record<string, unknown> | null, k: string) => {
  const v = o?.[k]
  return typeof v === 'string' || typeof v === 'number' ? String(v) : ''
}

function textoHistorico(h: HistoricoSat): string {
  const mot = h.motivos.length > 0 ? ` (${h.motivos.join('; ')})` : ''
  const de = (k: string) => campo(h.de, k)
  const para = (k: string) => campo(h.para, k)
  if (h.tipo === 'entrada') return `Entrada com a NF ${para('numero')} ${para('situacao')}${mot}`
  if (h.tipo === 'correcao') return `NF ${para('numero')} corrigida: ${de('situacao')} → ${para('situacao')}${mot}`
  if (h.tipo === 'troca') {
    const quem = [para('empresa'), para('cnpj') && `(${para('cnpj')})`].filter(Boolean).join(' ')
    return `NF ${de('numero')} (${de('situacao')}) substituída pela NF ${para('numero')}${quem ? ` — ${quem}` : ''} ${para('situacao')}${mot}`
  }
  const os = (n: string) => (n ? `OS ${n}` : 'sem OS')
  return `OS trocada: ${os(de('os_numero'))} → ${os(para('os_numero'))}`
}

function Dados({ linhas }: { linhas: [string, string][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {linhas.map(([r, v]) => (
        <div key={r} className="flex flex-col">
          <dt className="text-xs text-muted-foreground">{r}</dt>
          <dd className="whitespace-pre-wrap">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-white p-3">
      <h3 className="text-sm font-semibold text-tinta">{titulo}</h3>
      {children}
    </section>
  )
}

/**
 * SAT → ficha do relógio recebido: o relógio, a OS (trocar: sat.associar_os), a nota fiscal com os outros relógios
 * dela (corrigir/trocar: sat.aprovar_nf, vale para todos) e o histórico da nota e da OS deste relógio.
 */
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
  const podeOs = podeNoModulo(sessao.perfil, 'sat', 'associar_os')
  const [motivos, ordem] = await Promise.all([podeNf ? listarMotivos() : Promise.resolve([]), ordemDaEntrada(e.id)])
  const n = e.nota

  const itens = e.itensJunto.map((i) => (i === 'outros' ? `Outros: ${e.itensJuntoOutros}` : ITENS_JUNTO.find((x) => x.chave === i)?.rotulo ?? i))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/sat/equipamentos" className="text-sm underline">← Equipamentos</Link>
        <h2 className="text-lg font-semibold text-tinta">Ficha — {e.nsEscrito}</h2>
        <StatusNf situacao={n.situacao} />
        {ordem && (
          <Link href={`/sat/ordens/${ordem.id}`} className="flex items-center gap-2 text-sm underline">
            OS {ordem.numero} <EtapaOrdem etapa={ordem.etapa} />
          </Link>
        )}
      </div>

      <Secao titulo="Relógio">
        <Dados linhas={[
          ['Número de série', e.nsEscrito],
          ['Modelo / sequência', e.modelo && e.sequencia ? `${e.modelo} / ${e.sequencia}` : e.sequencia ?? '—'],
          ['Produto', e.produto || '—'],
          ['Itens que vieram junto', itens.join(', ') || '—'],
          ['Locação', e.locacao || '—'],
          ['Recebido em', dia(e.data)],
          ['Responsável', e.responsavelNome || '—'],
        ]} />
      </Secao>

      <Secao titulo="OS">
        {e.os ? (
          <Dados linhas={[
            ['Número', e.os.numero || '—'],
            ['Garantia', e.os.garantia || '—'],
            ['Defeito', e.os.defeito || '—'],
            ['Solução', e.os.solucao || '—'],
          ]} />
        ) : (
          <p className="text-sm text-muted-foreground">Sem OS</p>
        )}
        {podeOs && <TrocarOs entradaId={e.id} osAtualId={e.os?.id ?? null} osAtualNumero={e.os?.numero} opcoes={e.osDoNs} />}
      </Secao>

      <Secao titulo="Nota fiscal">
        <Dados linhas={[
          ['Número da NF', n.numero],
          ['CNPJ', n.cnpj || '—'],
          ['Empresa', n.empresa || '—'],
          ['Valor da nota', reais(n.valor)],
        ]} />
        {n.situacao === 'reprovada' && n.motivos.length > 0 && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">Motivos: {n.motivos.join('; ')}</p>
        )}
        {e.outrosRelogios.length > 0 && (
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Outros relógios desta NF</span>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {e.outrosRelogios.map((r) => (
                <Link key={r.id} className="font-mono underline" href={`/sat/equipamentos/${r.id}`}>{r.nsEscrito}</Link>
              ))}
            </div>
          </div>
        )}
        {podeNf && <MudarNf nfId={n.id} nfAtual={n.numero} situacaoAtual={n.situacao} motivosAtuais={n.motivos} relogios={e.outrosRelogios.length + 1} motivos={motivos} />}
      </Secao>

      <section className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-tinta">Histórico</h3>
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
