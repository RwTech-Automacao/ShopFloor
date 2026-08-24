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

/** Log da sessão (mais recente no topo). Cada linha = um lançamento efetivo.
 *  Com `titulo`, vira uma coluna de altura flexível (positivo/negativo) e mostra o cabeçalho
 *  mesmo vazio; sem `titulo`, mantém o comportamento antigo (some quando não há linhas). */
export function HistoricoLancamentos({ linhas, titulo }: { linhas: LinhaHistorico[]; titulo?: string }) {
  if (linhas.length === 0 && !titulo) return null
  return (
    <div className="mt-3 flex flex-col">
      {titulo && (
        <p className="mb-1 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</p>
      )}
      <div className={`overflow-y-auto rounded-lg border border-border ${titulo ? 'max-h-[16rem]' : 'max-h-[8rem]'}`}>
        {linhas.length === 0 ? (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">Nenhum ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-muted-foreground shadow-[0_1px_0_var(--color-border,#e5e7eb)]">
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
        )}
      </div>
    </div>
  )
}
