import Link from 'next/link'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Vizinho } from '@/modules/recebimento/domain/vizinhos'

/** Setas ‹ › para o processo anterior/próximo na MESMA ordem e filtros do grid.
 *  `null` → seta desabilitada (ponta da lista, ou sem como saber). O estado do grid
 *  (`g`) e a posição do vizinho (`i`) seguem no href para a navegação continuar. */
export function NavegacaoProcesso({
  anterior,
  proximo,
  g,
}: {
  anterior: Vizinho | null
  proximo: Vizinho | null
  g: string
}) {
  const href = (v: Vizinho) => {
    const q = new URLSearchParams()
    if (g) q.set('g', g)
    q.set('i', String(v.posicao))
    return `/recebimento/processos/${v.id}?${q.toString()}`
  }

  return (
    <div className="ml-auto flex gap-1">
      <Button
        variant="outline"
        size="icon-sm"
        className="border-enterplak text-enterplak hover:bg-enterplak hover:text-white"
        aria-label="Processo anterior"
        disabled={!anterior}
        render={anterior ? <Link href={href(anterior)} /> : undefined}
      >
        <ChevronLeftIcon />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        className="border-enterplak text-enterplak hover:bg-enterplak hover:text-white"
        aria-label="Próximo processo"
        disabled={!proximo}
        render={proximo ? <Link href={href(proximo)} /> : undefined}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  )
}
