'use client'

import { useState, useTransition } from 'react'
import { useActionState } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { salvarLista, excluirListaAction } from '@/modules/listas/application/actions'

export function ListaForm() {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(salvarLista, undefined)

  // Fecha o dialog quando a action retorna sucesso. Ajuste de estado durante
  // a renderização (não em um efeito) evita o cascading render apontado
  // pelo eslint-plugin-react-hooks (set-state-in-effect).
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
            Nova lista
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova lista</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="chave">Chave</Label>
            <Input
              id="chave"
              name="chave"
              placeholder="ex: transportadora"
              pattern="[a-z0-9_]+"
              required
            />
            <p className="text-xs text-muted-foreground">
              Letras minúsculas, números e sublinhado. Não pode ser alterada depois.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="nome">Nome</Label>
            <Input id="nome" name="nome" placeholder="Nome da lista" required />
          </div>
          {state && 'erro' in state && <p className="text-sm text-red-600">{state.erro}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending} className="bg-enterplak hover:bg-enterplak-700">
              {pending ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface ExcluirListaButtonProps {
  id: string
  nome: string
  sistema: boolean
}

export function ExcluirListaButton({ id, nome, sistema }: ExcluirListaButtonProps) {
  const [pending, startTransition] = useTransition()
  const [erro, setErro] = useState<string | null>(null)

  function onClick() {
    if (typeof window !== 'undefined' && !window.confirm(`Excluir a lista "${nome}"?`)) {
      return
    }
    setErro(null)
    startTransition(async () => {
      const resultado = await excluirListaAction(id)
      if ('erro' in resultado) setErro(resultado.erro)
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Excluir lista"
        disabled={sistema || pending}
        onClick={onClick}
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2Icon />
      </Button>
      {erro && <p className="text-xs text-red-600">{erro}</p>}
    </div>
  )
}
