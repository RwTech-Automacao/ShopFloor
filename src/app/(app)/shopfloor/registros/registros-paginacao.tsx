'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeftIcon, ChevronRightIcon, ChevronsLeftIcon, ChevronsRightIcon, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/** Opções de "quantos por página". `todos` é limitado no servidor (ver TETO_TODOS na página). */
export const TAMANHOS = ['100', '250', '500', '750', 'todos'] as const

const JANELA = 10 // quantos números de página mostrar de uma vez

export function RegistrosPaginacao({
  pagina,
  totalPaginas,
  total,
  tamanho,
  truncado,
}: {
  pagina: number // 0-based
  totalPaginas: number
  total: number
  tamanho: string // '100' | '250' | ... | 'todos'
  truncado: boolean // "todos" bateu no teto → está mostrando só uma parte
}) {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()

  /** Mantém os filtros da URL e troca só o que mudou. */
  function href(novaPagina: number, novoTamanho?: string): string {
    const params = new URLSearchParams(searchParams.toString())
    if (novoTamanho) params.set('tamanho', novoTamanho)
    if (novaPagina > 0) params.set('pagina', String(novaPagina))
    else params.delete('pagina')
    const q = params.toString()
    return q ? `${pathname}?${q}` : pathname
  }

  // Janela de páginas centrada na atual, grudada nas pontas.
  let inicio = Math.max(1, pagina + 1 - Math.floor(JANELA / 2))
  const fim = Math.min(totalPaginas, inicio + JANELA - 1)
  inicio = Math.max(1, fim - JANELA + 1)
  const numeros = Array.from({ length: fim - inicio + 1 }, (_, i) => inicio + i)

  const naPrimeira = pagina === 0
  const naUltima = pagina + 1 >= totalPaginas
  const umaPaginaSo = totalPaginas <= 1

  return (
    // Fixo no rodapé: rolar a lista não esconde os controles.
    <div className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/95 px-1 py-2 backdrop-blur">
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>
          {total} registro{total === 1 ? '' : 's'}
          {!umaPaginaSo && <> · página <span className="font-medium text-foreground">{pagina + 1}</span> de {totalPaginas}</>}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs">Por página</span>
          <Select value={tamanho} onValueChange={(v) => router.push(href(0, v ?? '100'))}>
            <SelectTrigger className="h-8 w-24" aria-label="Registros por página"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TAMANHOS.map((t) => (
                <SelectItem key={t} value={t}>{t === 'todos' ? 'Todos' : t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {truncado && (
          <span className="text-xs text-amber-600">
            Mostrando parte do resultado — refine os filtros ou use Exportar.
          </span>
        )}
        <Button variant="outline" size="sm" render={<a href={`${pathname}/exportar?${searchParams.toString()}`} />}>
          <Download className="mr-1 size-4" /> Exportar
        </Button>
      </div>

      {!umaPaginaSo && (
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="outline" size="icon-sm" aria-label="Primeira página" disabled={naPrimeira} render={<Link href={href(0)} />}>
            <ChevronsLeftIcon />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Página anterior" disabled={naPrimeira} render={<Link href={href(pagina - 1)} />}>
            <ChevronLeftIcon />
          </Button>
          {numeros.map((n) => (
            <Button
              key={n}
              variant={n === pagina + 1 ? 'default' : 'outline'}
              size="icon-sm"
              aria-label={`Página ${n}`}
              aria-current={n === pagina + 1 ? 'page' : undefined}
              render={<Link href={href(n - 1)} />}
            >
              {n}
            </Button>
          ))}
          <Button variant="outline" size="icon-sm" aria-label="Próxima página" disabled={naUltima} render={<Link href={href(pagina + 1)} />}>
            <ChevronRightIcon />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Última página" disabled={naUltima} render={<Link href={href(totalPaginas - 1)} />}>
            <ChevronsRightIcon />
          </Button>
        </div>
      )}
    </div>
  )
}
