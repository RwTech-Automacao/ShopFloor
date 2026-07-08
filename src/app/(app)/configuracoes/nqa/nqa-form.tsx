'use client'

import { useState } from 'react'
import { useActionState } from 'react'
import { PencilIcon } from 'lucide-react'
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
import { salvarTamanhoNqa } from '@/modules/recebimento/application/referencias-actions'
import type { NqaRow } from '@/modules/recebimento/infra/referencias-admin-repository'

function rotuloFaixa(min: number, max: number | null): string {
  return max === null ? `${min}+` : `${min}–${max}`
}

interface NqaFormProps {
  faixa: NqaRow
}

export function NqaForm({ faixa }: NqaFormProps) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(salvarTamanhoNqa, undefined)

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
          <Button variant="ghost" size="icon-sm" aria-label="Editar tamanho da amostra">
            <PencilIcon />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Faixa {rotuloFaixa(faixa.quantidadeMin, faixa.quantidadeMax)}
          </DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={faixa.id} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="tamanho_amostra">Tamanho da amostra</Label>
            <Input
              id="tamanho_amostra"
              name="tamanho_amostra"
              type="number"
              min={0}
              step="any"
              defaultValue={faixa.tamanhoAmostra ?? undefined}
              placeholder="Não definido"
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
