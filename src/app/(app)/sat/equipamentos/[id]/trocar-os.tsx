'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { associarOsAction } from '@/modules/sat/application/actions'
import type { OsDoNs } from '@/modules/sat/application/consultar-ns'
import { cn } from '@/lib/utils'
import { dia } from '../../formato'

/** "Trocar OS": liga o relógio a outra OS do mesmo NS, ou a nenhuma. sat.associar_os. */
export function TrocarOs({ entradaId, osAtualId, opcoes }: { entradaId: string; osAtualId: string | null; opcoes: OsDoNs[] }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [escolhida, setEscolhida] = useState<string | null>(osAtualId)
  const [pendente, iniciar] = useTransition()

  const abrir = () => { setEscolhida(osAtualId); setAberto(true) }

  const confirmar = () => iniciar(async () => {
    const r = await associarOsAction(entradaId, escolhida)
    if (!r.ok) { toast.error(r.erro); return }
    toast.success('OS trocada.')
    setAberto(false)
    router.refresh()
  })

  if (!aberto) {
    return <div><Button variant="outline" onClick={abrir}>Trocar OS</Button></div>
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2">
      {opcoes.map((o) => {
        const emOutra = o.emUso && o.id !== osAtualId
        return (
          <label key={o.id} className={cn('flex items-center gap-2 text-sm', emOutra && 'text-muted-foreground')}>
            <input
              type="radio" name="trocar-os" checked={escolhida === o.id} disabled={emOutra}
              onChange={() => setEscolhida(o.id)}
            />
            {[o.numero ? `OS ${o.numero}` : 'OS sem número', dia(o.data), o.solucao, o.garantia].filter(Boolean).join(' · ')}
            {emOutra && <span className="text-xs">(em outra entrada)</span>}
          </label>
        )
      })}
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="trocar-os" checked={escolhida === null} onChange={() => setEscolhida(null)} />
        Sem OS
      </label>
      <div className="flex gap-2">
        <Button onClick={confirmar} disabled={pendente || escolhida === osAtualId}>
          {pendente ? 'Salvando…' : 'Confirmar'}
        </Button>
        <Button variant="ghost" onClick={() => setAberto(false)}>Cancelar</Button>
      </div>
    </div>
  )
}
