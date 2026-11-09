import Link from 'next/link'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { buscarRelatorioEmb } from '@/modules/recebimento/infra/emb-relatorio-repository'
import { listarValoresDistintos } from '@/modules/recebimento/infra/registros-repository'
import { semJustificativa } from '@/modules/recebimento/domain/emb-relatorio'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { IrParaEmb } from '../ir-para-emb'

export const dynamic = 'force-dynamic'

const formatadorData = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

const qtd = (v: number | null) => (v === null ? '—' : v.toLocaleString('pt-BR'))
const n = (v: number, s: string, p: string) => `${v} ${v === 1 ? s : p}`

function decodificar(bruto: string): string {
  try {
    return decodeURIComponent(bruto)
  } catch {
    return bruto
  }
}

/**
 * O relatório de UMA EMB, aberto pelo link da mensagem do alerta "Fim de EMB" ou pelo índice do menu
 * (/recebimento/emb): o Nº da PO, quando fechou e as divergências de quantidade com a justificativa (as sem
 * justificativa em destaque). O topo troca de EMB ou volta ao índice.
 */
export default async function EmbRelatorioPage({ params }: { params: Promise<{ emb: string }> }) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver o relatório da EMB." />
  }

  const emb = decodificar((await params).emb).trim()
  const [r, embs] = await Promise.all([buscarRelatorioEmb(emb), listarValoresDistintos('numero_emb')])

  const topo = (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      <IrParaEmb embs={embs} atual={r?.emb ?? emb} />
      <Link href="/recebimento/emb" className="pb-2 text-sm text-enterplak underline-offset-2 hover:underline">
        ← Todas as EMBs
      </Link>
    </div>
  )

  if (!r) {
    return (
      <div className="flex flex-col gap-4">
        {topo}
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-tinta">EMB {emb || '—'}</h2>
          <p className="text-sm text-muted-foreground">Nenhum processo com esta EMB.</p>
        </div>
      </div>
    )
  }

  const pendentes = semJustificativa(r.divergencias)
  return (
    <div className="flex flex-col gap-4">
      {topo}
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-tinta">EMB {r.emb}</h2>
        <p className="text-sm text-muted-foreground">
          Nº da PO: {r.pedidos.length > 0 ? r.pedidos.join(', ') : '—'} · {n(r.processos, 'processo', 'processos')}
          {' · '}
          {r.fechada
            ? `fechou em ${r.fechadaEm ? formatadorData.format(r.fechadaEm) : '—'}`
            : 'ainda aberta (há processo em andamento)'}
        </p>
        <p className="text-base font-medium text-tinta">
          {r.divergencias.length === 0
            ? (r.fechada ? 'Fechou sem divergência de quantidade.' : 'Sem divergência de quantidade até agora.')
            : `${n(r.divergencias.length, 'divergência', 'divergências')} de quantidade` +
              (pendentes > 0 ? ` · ${pendentes} sem justificativa` : ' · todas justificadas')}
        </p>
      </div>

      {r.divergencias.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Processo</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right">Qtd pedido</TableHead>
                <TableHead className="text-right">Qtd recebida</TableHead>
                <TableHead className="text-right">Divergência</TableHead>
                <TableHead>Justificativa</TableHead>
                <TableHead>Justificado por</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.divergencias.map((d) => {
                const sem = d.justificativa.trim() === ''
                return (
                  <TableRow key={d.numero} className={sem ? 'bg-amber-50 hover:bg-amber-100' : undefined}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {d.id
                        ? <Link href={`/recebimento/processos/${d.id}`} className="text-enterplak underline-offset-2 hover:underline">#{d.numero}</Link>
                        : `#${d.numero}`}
                    </TableCell>
                    <TableCell className="font-mono">{d.item || '—'}</TableCell>
                    <TableCell className="max-w-[18rem] truncate" title={d.descricao}>{d.descricao || '—'}</TableCell>
                    <TableCell className="text-right">{qtd(d.quantidadePedido)}</TableCell>
                    <TableCell className="text-right">{qtd(d.quantidadeRecebida)}</TableCell>
                    <TableCell className="text-right font-medium">{d.divergencia || '—'}</TableCell>
                    <TableCell className="max-w-[20rem]">
                      {sem
                        ? <span className="font-medium text-amber-800">⚠️ sem justificativa</span>
                        : <span className="whitespace-pre-wrap">{d.justificativa}</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {sem ? '—' : (
                        <>
                          {d.justificadaPorNome || '—'}
                          {d.justificadaEm && (
                            <span className="block text-xs text-muted-foreground">{formatadorData.format(d.justificadaEm)}</span>
                          )}
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
