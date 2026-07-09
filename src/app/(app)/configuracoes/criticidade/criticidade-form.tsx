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
import { salvarCriticidade, excluirCriticidade } from '@/modules/recebimento/application/referencias-actions'

export function CriticidadeForm() {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(salvarCriticidade, undefined)

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
            Novo fornecedor
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo fornecedor crítico</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="fornecedor">Fornecedor</Label>
            <Input id="fornecedor" name="fornecedor" placeholder="Nome do fornecedor" required />
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

interface ExcluirCriticidadeButtonProps {
  id: string
  fornecedor: string
}

export function ExcluirCriticidadeButton({ id, fornecedor }: ExcluirCriticidadeButtonProps) {
  const [pending, startTransition] = useTransition()
  const [erro, setErro] = useState<string | null>(null)

  function onClick() {
    if (typeof window !== 'undefined' && !window.confirm(`Excluir a criticidade de "${fornecedor}"?`)) {
      return
    }
    setErro(null)
    startTransition(async () => {
      const resultado = await excluirCriticidade(id)
      if ('erro' in resultado) setErro(resultado.erro)
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Excluir fornecedor"
        disabled={pending}
        onClick={onClick}
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2Icon />
      </Button>
      {erro && <p className="text-xs text-red-600">{erro}</p>}
    </div>
  )
}
