export interface LinhaHistorico {
  lancamento: boolean // true = Lançado; false = Não-lançado (recusado)
  status: 'aprovado' | 'reprovado' | null // null = posto sem status
  sn: string
  dataHora: string // ISO, carimbado no cliente na hora do bipe
  erro?: string // motivo, quando não-lançado (duplicado, fora da faixa, sequência…)
  grupo?: number // id do envio em lote (peças lançadas juntas) — desenha o "pente" no Lançado
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

/** Pente/ligação: liga as peças que foram lançadas JUNTAS (mesmo `grupo`), como um colchete à esquerda.
 *  Aparece só em grupos de ≥2 linhas consecutivas com o mesmo grupo. */
function Pente({ mesmoAcima, mesmoAbaixo }: { mesmoAcima: boolean; mesmoAbaixo: boolean }) {
  if (!mesmoAcima && !mesmoAbaixo) return null
  return (
    <>
      <span
        className="absolute left-3 w-0.5 rounded-full bg-enterplak"
        style={{ top: mesmoAcima ? 0 : '50%', bottom: mesmoAbaixo ? 0 : '50%' }}
      />
      <span className="absolute left-3 top-1/2 h-0.5 w-2.5 -translate-y-1/2 rounded-full bg-enterplak" />
    </>
  )
}

/** Uma lista do log da sessão (mais recente no topo). Colunas: [pente] · Nº de Série · [Status] · [Motivo] · Data/hora.
 *  `mostrarStatus` = lista de Lançado (posto com aprovado/reprovado). `mostrarMotivo` = lista de
 *  Não-lançado (mostra o erro por SN). `mostrarGrupo` = desenha o pente do lote (só no Lançado). Fonte
 *  maior (text-lg) com linha compacta (py-1) → mais legível sem aumentar o scroll. */
export function HistoricoLancamentos({
  titulo, linhas, mostrarStatus, mostrarMotivo = false, mostrarGrupo = false,
}: { titulo: string; linhas: LinhaHistorico[]; mostrarStatus: boolean; mostrarMotivo?: boolean; mostrarGrupo?: boolean }) {
  const nCols = 2 + (mostrarStatus ? 1 : 0) + (mostrarMotivo ? 1 : 0) + (mostrarGrupo ? 1 : 0)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="mb-1 shrink-0 text-sm font-medium text-muted-foreground">{titulo} ({linhas.length})</p>
      <div className="min-h-0 flex-1 max-h-[14rem] overflow-y-auto rounded-lg border border-border bg-card">
        <table className="w-full text-lg">
          <thead className="sticky top-0 bg-muted text-sm uppercase tracking-wide text-muted-foreground">
            <tr>
              {mostrarGrupo && <th className="w-6" />}
              <th className="px-3 py-1.5 text-left font-medium">Nº de Série</th>
              {mostrarStatus && <th className="px-3 py-1.5 text-center font-medium">Status</th>}
              {mostrarMotivo && <th className="px-3 py-1.5 text-left font-medium">Motivo</th>}
              <th className="px-3 py-1.5 text-left font-medium">Data/hora</th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 && (
              <tr><td colSpan={nCols} className="px-3 py-3 text-center text-sm text-muted-foreground">—</td></tr>
            )}
            {linhas.map((l, i) => {
              const g = l.grupo
              const mesmoAcima = g != null && linhas[i - 1]?.grupo === g
              const mesmoAbaixo = g != null && linhas[i + 1]?.grupo === g
              return (
                <tr key={i} className="border-t border-border">
                  {mostrarGrupo && (
                    <td className="relative w-6 p-0"><Pente mesmoAcima={mesmoAcima} mesmoAbaixo={mesmoAbaixo} /></td>
                  )}
                  <td className="px-3 py-1 font-mono">{l.sn}</td>
                  {mostrarStatus && <td className="px-3 py-1 text-center"><SimboloStatus status={l.status} /></td>}
                  {mostrarMotivo && <td className="px-3 py-1 text-red-600">{l.erro ?? '—'}</td>}
                  <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">{fmtDataHora(l.dataHora)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
