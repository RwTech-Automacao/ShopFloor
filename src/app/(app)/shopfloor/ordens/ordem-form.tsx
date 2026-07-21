'use client'

import { useActionState, useState } from 'react'
import { Plus, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  criarOrdemAction,
  editarOrdemAction,
  type ResultadoOrdem,
} from '@/modules/shopfloor/application/ordens-actions'

export interface OrdemView {
  id: string
  pmo: string
  op: string
  cliente: string
  qtd: number | null
  descricao: string
  acp: string
  status: string
  sn_ini: string
  sn_fim: string
  postos: string[]
}

export function OrdemForm({ postos, ordem }: { postos: string[]; ordem?: OrdemView }) {
  const ehEdicao = ordem !== undefined
  const action = ehEdicao ? editarOrdemAction : criarOrdemAction
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<ResultadoOrdem | undefined, FormData>(action, undefined)

  // Fecha o dialog quando a action retorna ok (ajuste durante a render, sem useEffect).
  const [processado, setProcessado] = useState(state)
  if (state !== processado) {
    setProcessado(state)
    if (state?.ok) setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          ehEdicao ? (
            <Button variant="ghost" size="icon-sm" aria-label="Editar OP">
              <Pencil className="size-4" />
            </Button>
          ) : (
            <Button className="bg-enterplak hover:bg-enterplak-700">
              <Plus className="size-4" /> Nova OP
            </Button>
          )
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{ehEdicao ? 'Editar OP' : 'Nova OP'}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {ehEdicao && <input type="hidden" name="id" value={ordem.id} />}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pmo">PMO *</Label>
              <Input id="pmo" name="pmo" defaultValue={ordem?.pmo ?? ''} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op">Nº OP *</Label>
              <Input id="op" name="op" defaultValue={ordem?.op ?? ''} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cliente">Cliente *</Label>
              <Input id="cliente" name="cliente" defaultValue={ordem?.cliente ?? ''} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qtd">Quantidade</Label>
              <Input id="qtd" name="qtd" type="number" defaultValue={ordem?.qtd ?? ''} />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="descricao">Descrição</Label>
              <Input id="descricao" name="descricao" defaultValue={ordem?.descricao ?? ''} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="acp">ACP</Label>
              <Input id="acp" name="acp" defaultValue={ordem?.acp ?? ''} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="status">Status</Label>
              <Select name="status" defaultValue={ordem?.status?.toUpperCase() === 'FINALIZADA' ? 'FINALIZADA' : 'ATIVA'}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ATIVA">Ativa</SelectItem>
                  <SelectItem value="FINALIZADA">Finalizada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sn_ini">SN inicial</Label>
              <Input id="sn_ini" name="sn_ini" defaultValue={ordem?.sn_ini ?? ''} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sn_fim">SN final</Label>
              <Input id="sn_fim" name="sn_fim" defaultValue={ordem?.sn_fim ?? ''} />
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Postos aplicáveis</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {postos.map((posto) => (
                <label
                  key={posto}
                  htmlFor={`posto_${posto}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm"
                >
                  {posto}
                  <Switch id={`posto_${posto}`} name={`posto_${posto}`} defaultChecked={ordem?.postos.includes(posto) ?? false} />
                </label>
              ))}
            </div>
          </div>

          {state && !state.ok && <p className="text-sm text-red-600">{state.erro}</p>}

          <DialogFooter>
            <Button type="submit" disabled={pending} className="bg-enterplak hover:bg-enterplak-700">
              {pending ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
