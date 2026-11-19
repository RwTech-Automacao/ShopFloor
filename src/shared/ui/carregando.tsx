/**
 * Peças do estado de carregamento das telas (o `loading.tsx` de cada rota e os `<Suspense fallback>`).
 * `Bloco` é o esqueleto (um retângulo cinza pulsando no lugar do que vai aparecer) e `Carregando` é o aviso
 * acessível (role="status", lido pelo leitor de tela) com o texto "Carregando…".
 */
export function Bloco({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-muted motion-reduce:animate-none ${className}`} />
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <span
        aria-hidden
        className="size-4 animate-spin rounded-full border-2 border-enterplak border-t-transparent motion-reduce:animate-none"
      />
      {texto}
    </p>
  )
}
