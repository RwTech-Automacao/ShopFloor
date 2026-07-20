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
  resetarSenha,
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

  // No cadastro, o sucesso traz a senha temporária — mantemos o dialog aberto
  // para mostrá-la uma vez. Na edição (sem temporária), fecha como antes.
  const [senhaTemp, setSenhaTemp] = useState<string | null>(null)
  const [estadoProcessado, setEstadoProcessado] = useState(state)
  if (state !== estadoProcessado) {
    setEstadoProcessado(state)
    if (state && 'ok' in state && state.ok) {
      if (state.senhaTemporaria) setSenhaTemp(state.senhaTemporaria)
      else setOpen(false)
    }
  }

  const ehEdicao = Boolean(usuario)

  return (
    <Dialog
      open={open}
      onOpenChange={(novoAberto) => {
        setOpen(novoAberto)
        // Limpa a temporária em qualquer transição (abrir OU fechar). O botão "Concluir"
        // fecha via setOpen direto e NÃO dispara este callback — então limpar ao reabrir
        // garante que a senha de um cadastro anterior não reapareça no próximo "Novo usuário".
        setSenhaTemp(null)
      }}
    >
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
        {senhaTemp ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Usuário criado. Entregue a senha temporária abaixo — ela{' '}
              <strong>não será exibida de novo</strong>. No primeiro acesso, a pessoa vai
              definir a própria senha.
            </p>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted px-3 py-2">
              <code className="font-mono text-base">{senhaTemp}</code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard?.writeText(senhaTemp)}
              >
                Copiar
              </Button>
            </div>
            <DialogFooter>
              <Button
                type="button"
                className="bg-enterplak hover:bg-enterplak-700"
                onClick={() => setOpen(false)}
              >
                Concluir
              </Button>
            </DialogFooter>
          </div>
        ) : (
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
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" name="email" type="email" placeholder="usuario@empresa.com" required />
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="perfilId">Perfil</Label>
              <Select name="perfilId" defaultValue={usuario?.perfis.id} required>
                <SelectTrigger id="perfilId" className="w-full">
                  <SelectValue placeholder="Selecione um perfil">
                    {(value: string | null) =>
                      value
                        ? (perfis.find((p) => p.id === value)?.nome ?? '')
                        : 'Selecione um perfil'
                    }
                  </SelectValue>
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
        )}
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
  const [senhaTemp, setSenhaTemp] = useState<string | null>(null)

  function resetar() {
    setErro(null)
    startTransition(async () => {
      const resultado = await resetarSenha(id)
      if ('erro' in resultado) setErro(resultado.erro)
      else setSenhaTemp(resultado.senhaTemporaria ?? null)
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(novoAberto) => {
        setOpen(novoAberto)
        // Limpa em qualquer transição (abrir OU fechar) — "Concluir" fecha via setOpen
        // direto sem disparar este callback, então limpar ao reabrir evita a senha
        // temporária anterior reaparecer no próximo reset.
        setErro(null)
        setSenhaTemp(null)
      }}
    >
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={`Resetar senha de ${nome}`}>
            <KeyRoundIcon />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Resetar senha de {nome}</DialogTitle>
        </DialogHeader>
        {senhaTemp ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Senha temporária gerada. Entregue-a — ela{' '}
              <strong>não será exibida de novo</strong>. {nome} vai definir a própria senha no
              próximo acesso.
            </p>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted px-3 py-2">
              <code className="font-mono text-base">{senhaTemp}</code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard?.writeText(senhaTemp)}
              >
                Copiar
              </Button>
            </div>
            <DialogFooter>
              <Button
                type="button"
                className="bg-enterplak hover:bg-enterplak-700"
                onClick={() => setOpen(false)}
              >
                Concluir
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Isto gera uma nova senha temporária para {nome}. A senha atual deixa de valer e a
              pessoa terá de definir uma nova no próximo acesso.
            </p>
            {erro && <p className="text-sm text-red-600">{erro}</p>}
            <DialogFooter>
              <Button
                type="button"
                disabled={pending}
                className="bg-enterplak hover:bg-enterplak-700"
                onClick={resetar}
              >
                {pending ? 'Gerando...' : 'Gerar senha temporária'}
              </Button>
            </DialogFooter>
          </div>
        )}
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
