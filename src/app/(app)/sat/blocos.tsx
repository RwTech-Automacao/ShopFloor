/** Os blocos das fichas do SAT: uma seção com título e uma grade de rótulo/valor. */
export function Dados({ linhas }: { linhas: [string, string][] }) {
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

export function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-white p-3">
      <h3 className="text-sm font-semibold text-tinta">{titulo}</h3>
      {children}
    </section>
  )
}
