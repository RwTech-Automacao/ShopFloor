'use client'

import { useState, useTransition } from 'react'
import { useActionState } from 'react'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  salvarItem,
  alternarItemAtivo,
  excluirItemAction,
} from '@/modules/listas/application/actions'
import type { ItemRow } from '@/modules/listas/infra/lista-repository'

interface ItemFormProps {
  listaId: string
  listaChave: string
  item?: ItemRow
  proximaOrdem?: number
}

export function ItemForm({ listaId, listaChave, item, proximaOrdem }: ItemFormProps) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(salvarItem, undefined)

  // Fecha o dialog quando a action retorna sucesso. Ajuste de estado durante
  // a renderização (não em um efeito) evita o cascading render apontado
  // pelo eslint-plugin-react-hooks (set-state-in-effect).
  const [estadoProcessado, setEstadoProcessado] = useState(state)
  if (state !== estadoProcessado) {
    setEstadoProcessado(state)
    if (state && 'ok' in state && state.ok) setOpen(false)
  }

  const ehEdicao = Boolean(item)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          ehEdicao ? (
            <Button variant="ghost" size="icon-sm" aria-label="Editar item">
              <PencilIcon />
            </Button>
          ) : (
            <Button className="bg-enterplak hover:bg-enterplak-700">
              <PlusIcon />
              Novo item
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{ehEdicao ? 'Editar item' : 'Novo item'}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="listaId" value={listaId} />
          <input type="hidden" name="listaChave" value={listaChave} />
          <input type="hidden" name="id" value={item?.id ?? ''} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="valor">Valor</Label>
            <Input
              id="valor"
              name="valor"
              placeholder="Valor do item"
              defaultValue={item?.valor ?? ''}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ordem">Ordem</Label>
            <Input
              id="ordem"
              name="ordem"
              type="number"
              defaultValue={item?.ordem ?? proximaOrdem ?? 0}
              required
            />
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

interface AlternarItemAtivoProps {
  id: string
  ativo: boolean
}

export function AlternarItemAtivo({ id, ativo }: AlternarItemAtivoProps) {
  const [pending, startTransition] = useTransition()
  const [erro, setErro] = useState<string | null>(null)

  function onCheckedChange() {
    setErro(null)
    startTransition(async () => {
      const resultado = await alternarItemAtivo(id)
      if ('erro' in resultado) setErro(resultado.erro)
    })
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <Switch
        checked={ativo}
        disabled={pending}
        onCheckedChange={onCheckedChange}
        aria-label={ativo ? 'Desativar item' : 'Ativar item'}
      />
      {erro && <p className="text-xs text-red-600">{erro}</p>}
    </div>
  )
}

interface ExcluirItemButtonProps {
  id: string
  valor: string
}

export function ExcluirItemButton({ id, valor }: ExcluirItemButtonProps) {
  const [pending, startTransition] = useTransition()
  const [erro, setErro] = useState<string | null>(null)

  function onClick() {
    if (typeof window !== 'undefined' && !window.confirm(`Excluir o item "${valor}"?`)) {
      return
    }
    setErro(null)
    startTransition(async () => {
      const resultado = await excluirItemAction(id)
      if ('erro' in resultado) setErro(resultado.erro)
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Excluir item"
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
