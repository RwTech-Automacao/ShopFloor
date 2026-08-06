export interface ChipResultado { rotulo?: string; valor: string; mono?: boolean; destaque?: boolean }
/** ok=✓ verde (aprovado/registro neutro) · reprova=✗ vermelho · aviso=! amarelo (erro/bloqueio). */
export type TipoResultado = 'ok' | 'reprova' | 'aviso'
export interface ResultadoAcao {
  tipo: TipoResultado
  titulo: string
  detalhe?: string
  chips?: ChipResultado[]
  dica?: string
}

const ICONE: Record<TipoResultado, { simbolo: string; cor: string }> = {
  ok: { simbolo: '✓', cor: 'bg-green-600' },
  reprova: { simbolo: '✗', cor: 'bg-red-600' },
  aviso: { simbolo: '!', cor: 'bg-amber-500' },
}

/** Painel grande de resultado da última ação — fundo neutro, só o ícone é colorido. Fica até a próxima. */
export function PainelResultado({ resultado }: { resultado: ResultadoAcao | null }) {
  if (!resultado) return null
  const ic = ICONE[resultado.tipo]
  const alerta = resultado.tipo === 'aviso'
  return (
    <div
      role={alerta ? 'alert' : 'status'}
      aria-live={alerta ? 'assertive' : 'polite'}
      className="flex gap-3 rounded-lg border border-border bg-muted/40 p-4"
    >
      <div className={`flex size-9 flex-none items-center justify-center rounded-lg text-lg font-bold text-white ${ic.cor}`}>
        {ic.simbolo}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-foreground">{resultado.titulo}</p>
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
