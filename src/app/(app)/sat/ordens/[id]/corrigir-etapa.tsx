'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { corrigirEtapaAction } from '@/modules/sat/application/ordens-actions'
import { ETAPAS, MAX_MOTIVO_CORRECAO, ROTULO_ETAPA, type Etapa } from '@/modules/sat/domain/ordem'

/** O administrador corrige a etapa da OS (sat.administrar). O motivo vai para a linha do tempo. */
export function CorrigirEtapa({ ordemId, etapaAtual }: { ordemId: string; etapaAtual: Etapa }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [etapa, setEtapa] = useState<Etapa>(etapaAtual)
  const [motivo, setMotivo] = useState('')
  const [pendente, iniciar] = useTransition()

  const confirmar = () => iniciar(async () => {
    const r = await corrigirEtapaAction(ordemId, etapa, motivo)
    if (!r.ok) { toast.error(r.erro); return }
    toast.success('Etapa corrigida.')
    setAberto(false)
    setMotivo('')
    router.refresh()
  })

  if (!aberto) return <div><Button variant="outline" onClick={() => setAberto(true)}>Corrigir etapa</Button></div>

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-white p-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">Nova etapa</span>
        <select aria-label="Nova etapa" value={etapa} onChange={(e) => setEtapa(e.target.value as Etapa)}
          className="h-9 rounded-md border bg-transparent px-2 text-sm">
          {ETAPAS.map((x) => <option key={x} value={x}>{ROTULO_ETAPA[x]}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">Motivo da correção</span>
        <Textarea aria-label="Motivo da correção" value={motivo} maxLength={MAX_MOTIVO_CORRECAO} onChange={(e) => setMotivo(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <Button onClick={confirmar} disabled={pendente || etapa === etapaAtual}>{pendente ? 'Salvando…' : 'Confirmar correção'}</Button>
        <Button variant="ghost" onClick={() => setAberto(false)}>Cancelar</Button>
      </div>
    </div>
  )
}
