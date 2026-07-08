'use client'

import { useState, useTransition } from 'react'
import { useActionState } from 'react'
import { PencilIcon, PlusIcon, KeyRoundIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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
  criarUsuario,
  editarUsuario,
  redefinirSenha,
  alternarAtivo,
} from '@/modules/usuarios/application/actions'
import type { UsuarioRow } from '@/modules/usuarios/infra/usuario-admin-repository'

interface PerfilOpcao {
  id: string
  nome: string
}

interface UsuarioFormProps {
  usuario?: UsuarioRow
  perfis: PerfilOpcao[]
}

export function UsuarioForm({ usuario, perfis }: UsuarioFormProps) {
  const [open, setOpen] = useState(false)
  const action = usuario ? editarUsuario : criarUsuario
  const [state, formAction, pending] = useActionState(action, undefined)

  // Fecha o dialog quando a action retorna sucesso. Ajuste de estado durante
  // a renderização (não em um efeito) evita o cascading render apontado
  // pelo eslint-plugin-react-hooks (set-state-in-effect).
  const [estadoProcessado, setEstadoProcessado] = useState(state)
  if (state !== estadoProcessado) {
    setEstadoProcessado(state)
    if (state && 'ok' in state && state.ok) setOpen(false)
  }

  const ehEdicao = Boolean(usuario)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          ehEdicao ? (
            <Button variant="ghost" size="icon-sm" aria-label="Editar usuário">
              <PencilIcon />
            </Button>
          ) : (
            <Button className="bg-enterplak hover:bg-enterplak-700">
              <PlusIcon />
              Novo usuário
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{ehEdicao ? 'Editar usuário' : 'Novo usuário'}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {ehEdicao && <input type="hidden" name="id" value={usuario?.id} />}

          <div className="flex flex-col gap-2">
            <Label htmlFor="nome">Nome</Label>
            <Input
              id="nome"
              name="nome"
              placeholder="Nome do usuário"
              defaultValue={usuario?.nome ?? ''}
              required
            />
          </div>

          {!ehEdicao && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" name="email" type="email" placeholder="usuario@empresa.com" required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="senha">Senha</Label>
                <Input
                  id="senha"
                  name="senha"
                  type="password"
                  placeholder="Mínimo 6 caracteres"
                  minLength={6}
                  required
                />
              </div>
            </>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="perfilId">Perfil</Label>
            <Select name="perfilId" defaultValue={usuario?.perfis.id} required>
              <SelectTrigger id="perfilId" className="w-full">
                <SelectValue placeholder="Selecione um perfil" />
              </SelectTrigger>
              <SelectContent>
                {perfis.map((perfil) => (
                  <SelectItem key={perfil.id} value={perfil.id}>
                    {perfil.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {ehEdicao && (
            <label
              htmlFor="ativo"
              className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm"
            >
              Ativo
              <Switch id="ativo" name="ativo" defaultChecked={usuario?.ativo} />
            </label>
          )}

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

interface RedefinirSenhaButtonProps {
  id: string
  nome: string
}

export function RedefinirSenhaButton({ id, nome }: RedefinirSenhaButtonProps) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const [senha, setSenha] = useState('')

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    startTransition(async () => {
      const resultado = await redefinirSenha(id, senha)
      if ('erro' in resultado) {
        setErro(resultado.erro)
      } else {
        setSenha('')
        setOpen(false)
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
          setSenha('')
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={`Redefinir senha de ${nome}`}>
            <KeyRoundIcon />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Redefinir senha de {nome}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="nova-senha">Nova senha</Label>
            <Input
              id="nova-senha"
              type="password"
              placeholder="Mínimo 6 caracteres"
              minLength={6}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
            />
          </div>
          {erro && <p className="text-sm text-red-600">{erro}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending} className="bg-enterplak hover:bg-enterplak-700">
              {pending ? 'Salvando...' : 'Redefinir'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface AlternarAtivoUsuarioProps {
  id: string
  ativo: boolean
}

export function AlternarAtivoUsuario({ id, ativo }: AlternarAtivoUsuarioProps) {
  const [pending, startTransition] = useTransition()
  const [erro, setErro] = useState<string | null>(null)

  function onCheckedChange(novoAtivo: boolean) {
    setErro(null)
    startTransition(async () => {
      const resultado = await alternarAtivo(id, novoAtivo)
      if ('erro' in resultado) setErro(resultado.erro)
    })
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <Switch
        checked={ativo}
        disabled={pending}
        onCheckedChange={onCheckedChange}
        aria-label={ativo ? 'Desativar usuário' : 'Ativar usuário'}
      />
      {erro && <p className="text-xs text-red-600">{erro}</p>}
    </div>
  )
}
