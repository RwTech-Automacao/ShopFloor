'use client'

import { useState, useTransition } from 'react'
import { useActionState } from 'react'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useConfirmacao } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { PERMISSOES } from '@/modules/perfis/domain/regras-perfil'
import { MODULOS, PERMISSOES_POR_MODULO } from '@/modules/auth/domain/modulos'
import { salvarPerfil, excluirPerfil } from '@/modules/perfis/application/actions'
import type { PerfilRow } from '@/modules/auth/domain/mapear-perfil'

const ROTULO_PERMISSAO = new Map(PERMISSOES.map((p) => [p.chave, p.rotulo]))

interface PerfilFormProps {
  perfil?: PerfilRow
  grants?: { modulo: string; permissao: string }[]
}

export function PerfilForm({ perfil, grants = [] }: PerfilFormProps) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(salvarPerfil, undefined)
  const grantsMarcados = new Set(grants.map((g) => `${g.modulo}.${g.permissao}`))

  // Fecha o dialog quando a action retorna sucesso. Ajuste de estado durante
  // a renderização (não em um efeito) evita o cascading render apontado
  // pelo eslint-plugin-react-hooks (set-state-in-effect).
  const [estadoProcessado, setEstadoProcessado] = useState(state)
  if (state !== estadoProcessado) {
    setEstadoProcessado(state)
    if (state && 'ok' in state && state.ok) setOpen(false)
  }

  const ehEdicao = Boolean(perfil)

  return (
    <Dialog
      open={open}
      onOpenChange={(novoAberto) => {
        setOpen(novoAberto)
      }}
    >
      <DialogTrigger
        render={
          ehEdicao ? (
            <Button variant="ghost" size="icon-sm" aria-label="Editar perfil">
              <PencilIcon />
            </Button>
          ) : (
            <Button className="bg-enterplak hover:bg-enterplak-700">
              <PlusIcon />
              Novo perfil
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{ehEdicao ? 'Editar perfil' : 'Novo perfil'}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={perfil?.id ?? ''} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="nome">Nome</Label>
            <Input
              id="nome"
              name="nome"
              placeholder="Nome do perfil"
              defaultValue={perfil?.nome ?? ''}
              required
            />
          </div>
          <div className="flex flex-col gap-3">
            <Label>Permissões por módulo</Label>
            <div className="flex flex-col gap-2">
              {MODULOS.map((modulo) => (
                <details
                  key={modulo.chave}
                  className="group rounded-lg border border-border px-3 py-2"
                  open
                >
                  <summary className="cursor-pointer text-sm font-medium select-none">
                    {modulo.rotulo}
                  </summary>
                  <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {PERMISSOES_POR_MODULO[modulo.chave].map((permissao) => {
                      const nome = `${modulo.chave}.${permissao}`
                      const marcado = grantsMarcados.has(nome)
                      return (
                        <label
                          key={nome}
                          htmlFor={`flag-${nome}`}
                          className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm"
                        >
                          {ROTULO_PERMISSAO.get(permissao) ?? permissao}
                          <Switch id={`flag-${nome}`} name={nome} defaultChecked={marcado} />
                        </label>
                      )
                    })}
                  </div>
                </details>
              ))}
            </div>
          </div>
          {state && 'erro' in state && (
            <p className="text-sm text-red-600">{state.erro}</p>
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

interface ExcluirPerfilButtonProps {
  id: string
  nome: string
  sistema: boolean
}

export function ExcluirPerfilButton({ id, nome, sistema }: ExcluirPerfilButtonProps) {
  const [pending, startTransition] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const { confirmar, dialog } = useConfirmacao()

  async function onClick() {
    if (!(await confirmar({ titulo: `Excluir o perfil "${nome}"?` }))) return
    setErro(null)
    startTransition(async () => {
      const resultado = await excluirPerfil(id)
      if ('erro' in resultado) setErro(resultado.erro)
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Excluir perfil"
        disabled={sistema || pending}
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
