export interface LinhaHistorico {
  lancamento: boolean // registrou (true) ou deu erro (false)
  status: 'aprovado' | 'reprovado' | null // null = posto sem status ou registro falhou
  sn: string
}

/** ✓ verde / ✗ vermelho. */
function SimboloBool({ ok }: { ok: boolean }) {
  return <span className={`font-bold ${ok ? 'text-green-600' : 'text-red-600'}`}>{ok ? '✓' : '✗'}</span>
}

/** ✓ verde (aprovado) / ✗ vermelho (reprovado) / — cinza (sem status). */
function SimboloStatus({ status }: { status: 'aprovado' | 'reprovado' | null }) {
  if (status === null) return <span className="text-muted-foreground">—</span>
  return <SimboloBool ok={status === 'aprovado'} />
}

/** Log da sessão (mais recente no topo). Cada linha = um lançamento efetivo. */
export function HistoricoLancamentos({ linhas }: { linhas: LinhaHistorico[] }) {
  if (linhas.length === 0) return null
  return (
    <div className="mt-3 max-h-[8rem] overflow-y-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-center font-medium">Lançamento</th>
            <th className="px-3 py-2 text-center font-medium">Status</th>
            <th className="px-3 py-2 text-left font-medium">Nº de Série</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i} className="border-t border-border">
              <td className="px-3 py-1.5 text-center"><SimboloBool ok={l.lancamento} /></td>
              <td className="px-3 py-1.5 text-center"><SimboloStatus status={l.status} /></td>
              <td className="px-3 py-1.5 font-mono">{l.sn}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
