'use client'

import { useState, useTransition, useActionState, type FormEvent } from 'react'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConfirmacao } from '@/components/ui/confirm-dialog'
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
import {
  cadastrarPostoAction,
  atualizarPostoAction,
  excluirPostoAction,
} from '@/modules/shopfloor/application/sf-postos-actions'
import type { PostoRow } from '@/modules/shopfloor/infra/ordem-repository'
import { perfilAtribuivel, type PerfilPosto } from '@/modules/shopfloor/domain/perfil-posto'

interface PerfilSelectProps {
  id: string
  perfis: PerfilPosto[]
  defaultValue?: string
}

function PerfilSelect({ id, perfis, defaultValue }: PerfilSelectProps) {
  return (
    <Select name="perfil" defaultValue={defaultValue} required>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Selecione um perfil">
          {(value: string | null) => (value ? (perfis.find((p) => p.chave === value)?.nome ?? '') : 'Selecione um perfil')}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {perfis.map((perfil) => (
          <SelectItem key={perfil.chave} value={perfil.chave}>
            {perfil.nome}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function PostoForm({ perfis }: { perfis: PerfilPosto[] }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(cadastrarPostoAction, undefined)

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
            Novo posto
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo posto</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="chave">Nome</Label>
            <Input id="chave" name="chave" placeholder="Nome do posto" autoComplete="off" required />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="perfil">Perfil</Label>
            <PerfilSelect id="perfil" perfis={perfis.filter(perfilAtribuivel)} />
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

interface EditarPostoButtonProps {
  posto: PostoRow
  perfis: PerfilPosto[]
  bloqueado: boolean
}

export function EditarPostoButton({ posto, perfis, bloqueado }: EditarPostoButtonProps) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [erro, setErro] = useState<string | null>(null)

  // Só perfis atribuíveis no dropdown — mais o perfil ATUAL do posto (caso seja um bespoke,
  // p/ ele aparecer e poder ser mantido). Assim não dá pra atribuir Manutenção/Burn-in/Integração.
  const atribuiveis = perfis.filter(perfilAtribuivel)
  const atual = perfis.find((p) => p.chave === posto.perfil)
  const perfisEdicao = atual && !atribuiveis.some((p) => p.chave === atual.chave) ? [...atribuiveis, atual] : atribuiveis

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const perfil = String(formData.get('perfil') ?? '')
    setErro(null)
    startTransition(async () => {
      const r = await atualizarPostoAction(posto.chave, { perfil })
      if ('erro' in r) setErro(r.erro)
      else setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Editar posto"
            disabled={bloqueado}
            title={bloqueado ? 'Em uso em uma OP' : undefined}
          >
            <PencilIcon />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar posto</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Nome</Label>
            <Input value={posto.chave} disabled readOnly />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="perfil-editar">Perfil</Label>
            <PerfilSelect id="perfil-editar" perfis={perfisEdicao} defaultValue={posto.perfil} />
          </div>

          {erro && <p className="text-sm text-red-600">{erro}</p>}
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

export function ExcluirPostoButton({ chave, bloqueado }: { chave: string; bloqueado: boolean }) {
  const [pending, startTransition] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const { confirmar, dialog } = useConfirmacao()

  async function onClick() {
    const ok = await confirmar({
      titulo: `Excluir "${chave}"?`,
      descricao: 'Essa ação não pode ser desfeita.',
    })
    if (!ok) return
    setErro(null)
    startTransition(async () => {
      const r = await excluirPostoAction(chave)
      if ('erro' in r) setErro(r.erro)
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Excluir posto"
        disabled={pending || bloqueado}
        title={bloqueado ? 'Em uso em uma OP' : undefined}
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
