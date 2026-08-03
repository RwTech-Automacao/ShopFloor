'use client'

import { useState, useTransition } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { excluirOrdemAction } from '@/modules/shopfloor/application/ordens-actions'

export function ExcluirOrdemBotao({ id, rotulo }: { id: string; rotulo: string }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function onExcluir() {
    startTransition(async () => {
      const r = await excluirOrdemAction(id)
      if (r.ok) {
        toast.success(`OP ${rotulo} excluída`, { position: 'bottom-center' })
        setOpen(false)
      } else {
        toast.error(r.erro, { position: 'bottom-center' })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={`Excluir OP ${rotulo}`}>
            <Trash2 className="size-4 text-red-600" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Excluir OP {rotulo}?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Esta ação não pode ser desfeita.</p>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancelar</Button>} />
          <Button variant="destructive" disabled={pending} onClick={onExcluir}>
            {pending ? 'Excluindo…' : 'Excluir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
