'use client'

import { useState, useTransition } from 'react'
import { useActionState } from 'react'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { salvarCriticidade, excluirCriticidade } from '@/modules/recebimento/application/referencias-actions'
import type { CriticidadeRow } from '@/modules/recebimento/infra/referencias-admin-repository'

interface CriticidadeFormProps {
  registro?: CriticidadeRow
}

export function CriticidadeForm({ registro }: CriticidadeFormProps) {
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
          registro ? (
            <Button variant="ghost" size="icon-sm" aria-label="Editar fornecedor">
              <PencilIcon />
            </Button>
          ) : (
            <Button className="bg-enterplak hover:bg-enterplak-700">
              <PlusIcon />
              Novo fornecedor
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{registro ? 'Editar fornecedor' : 'Novo fornecedor'}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {registro && <input type="hidden" name="id" value={registro.id} />}

          <div className="flex flex-col gap-2">
            <Label htmlFor="fornecedor">Fornecedor</Label>
            <Input
              id="fornecedor"
              name="fornecedor"
              placeholder="Nome do fornecedor"
              defaultValue={registro?.fornecedor}
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="critico">Crítico</Label>
            <Select name="critico" defaultValue={registro?.critico ?? 'Não'}>
              <SelectTrigger id="critico" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Sim">Sim</SelectItem>
                <SelectItem value="Não">Não</SelectItem>
              </SelectContent>
            </Select>
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
