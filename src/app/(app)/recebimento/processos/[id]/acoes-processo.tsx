'use client'

import { useState, useTransition } from 'react'
import { AlertTriangleIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { StatusProcesso } from '@/modules/recebimento/domain/ciclo-vida'
import {
  cancelarProcesso,
  finalizarProcesso,
  reabrirProcesso,
} from '@/modules/recebimento/application/transicoes-processo'

interface AcoesProcessoProps {
  processoId: string
  status: StatusProcesso
  podeFinalizar: boolean
  podeExcluir: boolean
  podeEditarFinalizado: boolean
}

/**
 * Botões contextuais de mudança de status, conforme o status atual e as
 * permissões do usuário. As Server Actions (`finalizarProcesso`,
 * `cancelarProcesso`, `reabrirProcesso`) são a única fonte de verdade sobre o
 * que é permitido — os `pode*` aqui só controlam a exibição/UX do botão.
 */
export function AcoesProcesso({
  processoId,
  status,
  podeFinalizar,
  podeExcluir,
  podeEditarFinalizado,
}: AcoesProcessoProps) {
  const mostrarFinalizar = status === 'em_conferencia' && podeFinalizar
  const mostrarCancelar = (status === 'aberto' || status === 'em_conferencia') && podeExcluir
  const mostrarReabrir = status === 'finalizado' && podeEditarFinalizado

  if (!mostrarFinalizar && !mostrarCancelar && !mostrarReabrir) return null

  return (
    <div className="flex flex-wrap items-start gap-3 border-t border-border pt-4">
      {mostrarFinalizar && <BotaoFinalizar processoId={processoId} />}
      {mostrarReabrir && <BotaoReabrir processoId={processoId} />}
      {mostrarCancelar && <BotaoCancelar processoId={processoId} />}
    </div>
  )
}

function BotaoFinalizar({ processoId }: { processoId: string }) {
  const [pending, startTransition] = useTransition()
  const [erro, setErro] = useState<string | null>(null)

  function onClick() {
    setErro(null)
    startTransition(async () => {
      const resultado = await finalizarProcesso(processoId)
      if (!resultado.ok) setErro(resultado.erro)
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <Button onClick={onClick} disabled={pending} className="bg-enterplak hover:bg-enterplak-700">
        {pending ? 'Finalizando...' : 'Finalizar'}
      </Button>
      {erro && (
        <p className="flex max-w-sm items-center gap-1.5 text-sm text-red-600">
          <AlertTriangleIcon className="size-4 shrink-0" /> {erro}
        </p>
      )}
    </div>
  )
}

function BotaoReabrir({ processoId }: { processoId: string }) {
  const [pending, startTransition] = useTransition()
  const [erro, setErro] = useState<string | null>(null)

  function onClick() {
    setErro(null)
    startTransition(async () => {
      const resultado = await reabrirProcesso(processoId)
      if (!resultado.ok) setErro(resultado.erro)
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="outline" onClick={onClick} disabled={pending}>
        {pending ? 'Reabrindo...' : 'Reabrir'}
      </Button>
      {erro && (
        <p className="flex max-w-sm items-center gap-1.5 text-sm text-red-600">
          <AlertTriangleIcon className="size-4 shrink-0" /> {erro}
        </p>
      )}
    </div>
  )
}

function BotaoCancelar({ processoId }: { processoId: string }) {
  const [open, setOpen] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [pending, startTransition] = useTransition()
  const [erro, setErro] = useState<string | null>(null)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    startTransition(async () => {
      const resultado = await cancelarProcesso(processoId, motivo)
      if (resultado.ok) {
        setOpen(false)
        setMotivo('')
      } else {
        setErro(resultado.erro)
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(novoAberto) => {
        setOpen(novoAberto)
        if (!novoAberto) {
          setErro(null)
          setMotivo('')
        }
      }}
    >
      <DialogTrigger render={<Button variant="destructive">Cancelar</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar processo</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="motivo-cancelamento">Motivo do cancelamento</Label>
            <Textarea
              id="motivo-cancelamento"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Descreva o motivo do cancelamento"
              required
            />
          </div>
          {erro && (
            <p className="flex items-center gap-1.5 text-sm text-red-600">
              <AlertTriangleIcon className="size-4 shrink-0" /> {erro}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? 'Cancelando...' : 'Confirmar cancelamento'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
