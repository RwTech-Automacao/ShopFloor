export interface ChipResultado { rotulo?: string; valor: string; mono?: boolean; destaque?: boolean }
export interface ResultadoAcao {
  tipo: 'ok' | 'erro'
  titulo: string
  detalhe?: string
  chips?: ChipResultado[]
  dica?: string
}

/** Painel grande de resultado da última ação (fica na tela até a próxima). */
export function PainelResultado({ resultado }: { resultado: ResultadoAcao | null }) {
  if (!resultado) return null
  const ok = resultado.tipo === 'ok'
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex gap-3 rounded-lg border border-l-4 p-4 ${
        ok ? 'border-green-600 bg-green-50 dark:bg-green-950/30' : 'border-red-600 bg-red-50 dark:bg-red-950/30'
      }`}
    >
      <div className={`flex size-9 flex-none items-center justify-center rounded-lg text-lg font-bold text-white ${ok ? 'bg-green-600' : 'bg-red-600'}`}>
        {ok ? '✓' : '!'}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-base font-semibold ${ok ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'}`}>
          {resultado.titulo}
        </p>
        {resultado.detalhe && <p className="mt-0.5 text-sm text-muted-foreground">{resultado.detalhe}</p>}
        {resultado.chips && resultado.chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {resultado.chips.map((c, i) => (
              <span
                key={i}
                className={`inline-flex items-baseline gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                  c.destaque
                    ? 'border-green-600 bg-green-100 font-semibold text-green-800 dark:bg-green-900/40 dark:text-green-300'
                    : 'border-border bg-card'
                }`}
              >
                {c.rotulo && <span className="text-[0.68rem] uppercase tracking-wide text-muted-foreground">{c.rotulo}</span>}
                <span className={`font-medium ${c.mono ? 'font-mono' : ''}`}>{c.valor}</span>
              </span>
            ))}
          </div>
        )}
        {resultado.dica && <p className="mt-2 text-sm text-muted-foreground">O que fazer: {resultado.dica}</p>}
      </div>
    </div>
  )
}
