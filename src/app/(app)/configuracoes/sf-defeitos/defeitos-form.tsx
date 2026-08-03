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
import { cadastrarDefeitoAction, excluirDefeitoAction } from '@/modules/shopfloor/application/defeitos-actions'

export function DefeitoForm() {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(cadastrarDefeitoAction, undefined)

  useEffect(() => {
    if (!state) return
    if ('ok' in state && state.ok) {
      toast.success('Defeito criado', { description: state.codigo ?? '', position: 'bottom-center' })
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
            Novo defeito
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo defeito</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="codigo">Código</Label>
            <Input
              id="codigo"
              name="codigo"
              placeholder="1002 TRILHA ROMPIDA"
              className="uppercase"
              autoComplete="off"
              required
            />
            <p className="text-xs text-muted-foreground">Número + descrição, num campo só. Salvo em MAIÚSCULAS.</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Tipo</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="tipo" value="1" defaultChecked /> Peça
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="tipo" value="2" /> Teste
              </label>
            </div>
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

export function ExcluirDefeitoButton({
  codigo,
}: {
  codigo: string
}) {
  const [pending, startTransition] = useTransition()
  const { confirmar, dialog } = useConfirmacao()

  async function onClick() {
    const ok = await confirmar({
      titulo: `Excluir "${codigo}"?`,
      descricao: 'Não afeta o histórico — os registros já lançados guardam o texto do defeito.',
    })
    if (!ok) return
    startTransition(async () => {
      const r = await excluirDefeitoAction(codigo)
      if ('erro' in r) toast.error(r.erro, { position: 'bottom-center' })
      else toast.success(`Defeito ${codigo} excluído`, { position: 'bottom-center' })
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Excluir defeito"
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
