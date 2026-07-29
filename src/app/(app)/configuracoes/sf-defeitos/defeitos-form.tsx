'use client'

import { useState, useTransition, useActionState } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
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

  // Fecha o dialog quando a action retorna sucesso (ajuste de estado na
  // renderização, não em efeito — evita o cascading render do eslint).
  const [estadoProcessado, setEstadoProcessado] = useState(state)
  if (state !== estadoProcessado) {
    setEstadoProcessado(state)
    if (state && 'ok' in state && state.ok) setOpen(false)
  }

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

          {state && 'erro' in state && <p className="text-sm text-red-600">{state.erro}</p>}
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

export function ExcluirDefeitoButton({ codigo }: { codigo: string }) {
  const [pending, startTransition] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const { confirmar, dialog } = useConfirmacao()

  async function onClick() {
    const ok = await confirmar({
      titulo: `Excluir "${codigo}"?`,
      descricao: 'Não afeta o histórico — os registros já lançados guardam o texto do defeito.',
    })
    if (!ok) return
    setErro(null)
    startTransition(async () => {
      const r = await excluirDefeitoAction(codigo)
      if ('erro' in r) setErro(r.erro)
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
      {erro && <p className="text-xs text-red-600">{erro}</p>}
      {dialog}
    </div>
  )
}
