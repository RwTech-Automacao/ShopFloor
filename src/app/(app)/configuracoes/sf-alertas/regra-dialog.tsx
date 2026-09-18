'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Canal } from '@/modules/alertas/domain/tipos'
import type { DestinatarioDisponivel, RegraAlerta } from '@/modules/alertas/domain/regra'
import { RegraForm } from './regra-form'

export function RegraDialog({
  aberto,
  regra,
  postos,
  destinatarios,
  configurados,
  onFechar,
  onRegraExcluida,
}: {
  aberto: boolean
  regra: RegraAlerta | null
  postos: string[]
  destinatarios: DestinatarioDisponivel[]
  configurados: Record<Canal, boolean>
  onFechar: () => void
  onRegraExcluida?: () => void
}) {
  return (
    <Dialog open={aberto} onOpenChange={(valor) => !valor && onFechar()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{regra ? 'Editar regra' : 'Nova regra'}</DialogTitle>
        </DialogHeader>
        <RegraForm
          regra={regra}
          postos={postos}
          destinatarios={destinatarios}
          configurados={configurados}
          onSalvo={onFechar}
          onCancelar={onFechar}
          onRegraExcluida={onRegraExcluida}
        />
      </DialogContent>
    </Dialog>
  )
}
