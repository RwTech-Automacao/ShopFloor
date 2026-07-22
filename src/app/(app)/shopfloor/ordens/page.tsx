import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { listarOrdens, listarPostos, listarFluxos } from '@/modules/shopfloor/infra/ordem-repository'
import { OrdemForm, type OrdemView } from './ordem-form'
import { ExcluirOrdemBotao } from './excluir-ordem-botao'

export default async function OrdensPage() {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return <SemPermissao descricao="Você não tem permissão para gerenciar ordens de produção." />
  }

  const [ordens, postos, fluxos] = await Promise.all([listarOrdens(), listarPostos(), listarFluxos()])
  const chavesPostos = postos.map((p) => p.chave).filter((c) => c !== 'Manutenção')
  const views: OrdemView[] = ordens.map((o) => ({
    id: o.id,
    pmo: o.pmo,
    op: o.op,
    cliente: o.cliente,
    qtd: o.qtd,
    descricao: o.descricao,
    acp: o.acp,
    status: o.status,
    sn_ini: o.sn_ini,
    sn_fim: o.sn_fim,
    postos: [...o.sf_ordem_postos].sort((a, b) => a.ordem - b.ordem).map((x) => x.posto),
  }))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-tinta">Ordens de Produção</h2>
          <p className="text-sm text-muted-foreground">{views.length} OP(s) cadastrada(s)</p>
        </div>
        <OrdemForm postos={chavesPostos} fluxosExistentes={fluxos} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PMO</TableHead>
              <TableHead>OP</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Faixa SN</TableHead>
              <TableHead className="text-center">Postos</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {views.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-medium">{o.pmo}</TableCell>
                <TableCell>{o.op}</TableCell>
                <TableCell>{o.cliente}</TableCell>
                <TableCell className="max-w-[240px] truncate">{o.descricao || '—'}</TableCell>
                <TableCell>{o.status.toUpperCase() === 'FINALIZADA' ? 'Finalizada' : 'Ativa'}</TableCell>
                <TableCell>{o.sn_ini && o.sn_fim ? `${o.sn_ini}–${o.sn_fim}` : '—'}</TableCell>
                <TableCell className="text-center">{o.postos.length}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <OrdemForm postos={chavesPostos} ordem={o} fluxosExistentes={fluxos} />
                    <ExcluirOrdemBotao id={o.id} rotulo={`${o.pmo}/${o.op}`} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {views.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  Nenhuma OP cadastrada ainda.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
