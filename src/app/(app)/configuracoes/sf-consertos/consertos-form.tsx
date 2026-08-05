'use client'

import { useEffect, useState, useTransition, useActionState } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConfirmacao } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cadastrarConservoAction, excluirConservoAction } from '@/modules/shopfloor/application/consertos-actions'

export function ConsertoForm() {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(cadastrarConservoAction, undefined)

  useEffect(() => {
    if (!state) return
    if ('ok' in state && state.ok) {
      toast.success('Conserto criado', { description: state.codigo ?? '', position: 'bottom-center' })
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false)
    } else if ('erro' in state) {
      toast.error(state.erro, { position: 'bottom-center' })
    }
  }, [state])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button className="bg-enterplak hover:bg-enterplak-700">
            <PlusIcon />
            Novo conserto
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo conserto</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="codigo">Código</Label>
            <Input
              id="codigo"
              name="codigo"
              placeholder="2001 RESSOLDA DE COMPONENTE"
              className="uppercase"
              autoComplete="off"
              required
            />
            <p className="text-xs text-muted-foreground">Número + descrição, num campo só. Salvo em MAIÚSCULAS.</p>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending} className="bg-enterplak hover:bg-enterplak-700">
              {pending ? 'Salvando...' : 'Cadastrar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ExcluirConservoButton({
  codigo,
}: {
  codigo: string
}) {
  const [pending, startTransition] = useTransition()
  const { confirmar, dialog } = useConfirmacao()

  async function onClick() {
    const ok = await confirmar({
      titulo: `Excluir "${codigo}"?`,
      descricao: 'Não afeta o histórico — os reparos já lançados guardam o texto do conserto.',
    })
    if (!ok) return
    startTransition(async () => {
      const r = await excluirConservoAction(codigo)
      if ('erro' in r) toast.error(r.erro, { position: 'bottom-center' })
      else toast.success(`Conserto ${codigo} excluído`, { position: 'bottom-center' })
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Excluir conserto"
        disabled={pending}
        onClick={onClick}
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2Icon />
      </Button>
      {dialog}
    </div>
  )
}
