export interface LinhaHistorico {
  lancamento: boolean // true = Lançado; false = Não-lançado (recusado)
  status: 'aprovado' | 'reprovado' | null // null = posto sem status
  sn: string
  dataHora: string // ISO, carimbado no cliente na hora do bipe
}

const formatadorData = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Sao_Paulo',
})
function fmtDataHora(iso: string): string { return formatadorData.format(new Date(iso)) }

/** ✓ verde (aprovado) / ✗ vermelho (reprovado) / — cinza (sem status). */
function SimboloStatus({ status }: { status: 'aprovado' | 'reprovado' | null }) {
  if (status === null) return <span className="text-muted-foreground">—</span>
  return <span className={`font-bold ${status === 'aprovado' ? 'text-green-600' : 'text-red-600'}`}>{status === 'aprovado' ? '✓' : '✗'}</span>
}

/** Uma lista do log da sessão (mais recente no topo). Colunas: Nº de Série · [Status] · Data/hora.
 *  `mostrarStatus` = o posto tem aprovado/reprovado (some a coluna Status nos demais). */
export function HistoricoLancamentos({
  titulo, linhas, mostrarStatus,
}: { titulo: string; linhas: LinhaHistorico[]; mostrarStatus: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="mb-1 shrink-0 text-xs font-medium text-muted-foreground">{titulo} ({linhas.length})</p>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
        <table className="w-full text-base">
          <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Nº de Série</th>
              {mostrarStatus && <th className="px-3 py-2 text-center font-medium">Status</th>}
              <th className="px-3 py-2 text-left font-medium">Data/hora</th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 && (
              <tr><td colSpan={mostrarStatus ? 3 : 2} className="px-3 py-3 text-center text-sm text-muted-foreground">—</td></tr>
            )}
            {linhas.map((l, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-1.5 font-mono">{l.sn}</td>
                {mostrarStatus && <td className="px-3 py-1.5 text-center"><SimboloStatus status={l.status} /></td>}
                <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{fmtDataHora(l.dataHora)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
