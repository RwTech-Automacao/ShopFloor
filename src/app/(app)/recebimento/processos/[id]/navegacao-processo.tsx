import Link from 'next/link'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { queryProcessos } from '@/modules/recebimento/domain/busca-processo'
import type { FiltrosProcessos } from '@/modules/recebimento/infra/processo-repository'

/** Setas ‹ › para o processo anterior/próximo na ordem da lista filtrada. `null`
 *  → seta desabilitada (ponta da lista). Os filtros vão no href para manter a
 *  navegação dentro da mesma ordem. */
export function NavegacaoProcesso({
  anterior,
  proximo,
  filtros,
}: {
  anterior: string | null
  proximo: string | null
  filtros: FiltrosProcessos
}) {
  const q = queryProcessos(filtros)
  return (
    <div className="ml-auto flex gap-1">
      <Button
        variant="outline"
        size="icon-sm"
        className="border-enterplak text-enterplak hover:bg-enterplak hover:text-white"
        aria-label="Processo anterior"
        disabled={!anterior}
        render={anterior ? <Link href={`/recebimento/processos/${anterior}${q}`} /> : undefined}
      >
        <ChevronLeftIcon />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        className="border-enterplak text-enterplak hover:bg-enterplak hover:text-white"
        aria-label="Próximo processo"
        disabled={!proximo}
        render={proximo ? <Link href={`/recebimento/processos/${proximo}${q}`} /> : undefined}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  )
}
