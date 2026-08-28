'use client'

import { useEffect, useState, useTransition, useActionState, type FormEvent } from 'react'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
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
import { perfilAtribuivel, perfilSuportaColetivo, type PerfilPosto } from '@/modules/shopfloor/domain/perfil-posto'

interface PerfilSelectProps {
  id: string
  perfis: PerfilPosto[]
  value: string
  onValueChange: (value: string | null) => void
}

function PerfilSelect({ id, perfis, value, onValueChange }: PerfilSelectProps) {
  return (
    <Select name="perfil" value={value} onValueChange={onValueChange} required>
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
  const [perfilSel, setPerfilSel] = useState('')
  const [state, formAction, pending] = useActionState(cadastrarPostoAction, undefined)

  useEffect(() => {
    if (!state) return
    if ('ok' in state && state.ok) {
      toast.success('Posto criado', { description: state.nome ?? '', position: 'bottom-center' })
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false)
      setPerfilSel('')
    } else if ('erro' in state) {
      toast.error(state.erro, { position: 'bottom-center' })
    }
  }, [state])

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) setPerfilSel('')
      }}
    >
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
            <PerfilSelect
              id="perfil"
              perfis={perfis.filter(perfilAtribuivel)}
              value={perfilSel}
              onValueChange={(v) => setPerfilSel(v ?? '')}
            />
          </div>

          {perfilSuportaColetivo(perfilSel) && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="coletivo" className="size-4" />
              Lançamento coletivo (bipa vários SNs e envia junto)
            </label>
          )}

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
  const [perfilSel, setPerfilSel] = useState(posto.perfil)

  // Só perfis atribuíveis no dropdown — mais o perfil ATUAL do posto (caso seja um bespoke,
  // p/ ele aparecer e poder ser mantido). Assim não dá pra atribuir Manutenção/Burn-in/Integração.
  const atribuiveis = perfis.filter(perfilAtribuivel)
  const atual = perfis.find((p) => p.chave === posto.perfil)
  const perfisEdicao = atual && !atribuiveis.some((p) => p.chave === atual.chave) ? [...atribuiveis, atual] : atribuiveis

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const perfil = String(formData.get('perfil') ?? '')
    const coletivo = formData.get('coletivo') === 'on'
    startTransition(async () => {
      const r = await atualizarPostoAction(posto.chave, { perfil, coletivo })
      if ('erro' in r) {
        toast.error(r.erro, { position: 'bottom-center' })
      } else {
        toast.success('Posto editado', { description: r.nome ?? posto.chave, position: 'bottom-center' })
        setOpen(false)
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) setPerfilSel(posto.perfil)
      }}
    >
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
            <PerfilSelect
              id="perfil-editar"
              perfis={perfisEdicao}
              value={perfilSel}
              onValueChange={(v) => setPerfilSel(v ?? '')}
            />
          </div>

          {perfilSuportaColetivo(perfilSel) && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="coletivo" className="size-4" defaultChecked={posto.coletivo} />
              Lançamento coletivo (bipa vários SNs e envia junto)
            </label>
          )}

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

export function ExcluirPostoButton({
  chave,
  bloqueado,
}: {
  chave: string
  bloqueado: boolean
}) {
  const [pending, startTransition] = useTransition()
  const { confirmar, dialog } = useConfirmacao()

  async function onClick() {
    const ok = await confirmar({
      titulo: `Excluir "${chave}"?`,
      descricao: 'Essa ação não pode ser desfeita.',
    })
    if (!ok) return
    startTransition(async () => {
      const r = await excluirPostoAction(chave)
      if ('erro' in r) toast.error(r.erro, { position: 'bottom-center' })
      else toast.success(`Posto ${chave} excluído`, { position: 'bottom-center' })
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
      {dialog}
    </div>
  )
}
