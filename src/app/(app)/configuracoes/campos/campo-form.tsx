'use client'

import { useState } from 'react'
import { useActionState } from 'react'
import { PencilIcon } from 'lucide-react'
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
import { salvarCampo } from '@/modules/configuracao-campos/application/actions'
import type { CampoRow } from '@/modules/configuracao-campos/infra/campo-repository'
import type { TipoCampo } from '@/modules/configuracao-campos/domain/regras-campo'

const ROTULOS_TIPO: Record<TipoCampo, string> = {
  texto: 'Texto',
  lista: 'Lista',
  numero: 'Número',
  data: 'Data',
}

interface CampoFormProps {
  campo: CampoRow
  listas: { chave: string; nome: string }[]
}

export function CampoForm({ campo, listas }: CampoFormProps) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(salvarCampo, undefined)

  // Fecha o dialog quando a action retorna sucesso. Ajuste de estado durante
  // a renderização (não em um efeito) evita o cascading render apontado
  // pelo eslint-plugin-react-hooks (set-state-in-effect).
  const [estadoProcessado, setEstadoProcessado] = useState(state)
  if (state !== estadoProcessado) {
    setEstadoProcessado(state)
    if (state && 'ok' in state && state.ok) setOpen(false)
  }

  // Campos cujo tipo hoje é numero/data têm o tipo fixo: não é permitido
  // transformá-los em texto/lista por aqui.
  const tipoFixo = campo.tipo === 'numero' || campo.tipo === 'data'
  const [tipo, setTipo] = useState<TipoCampo>(campo.tipo)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Editar campo">
            <PencilIcon />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar campo</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={campo.id} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="rotulo">Rótulo</Label>
            <Input id="rotulo" name="rotulo" defaultValue={campo.rotulo} required />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="tipo">Tipo</Label>
            {tipoFixo ? (
              <>
                <Input value={ROTULOS_TIPO[campo.tipo]} disabled readOnly />
                <input type="hidden" name="tipo" value={campo.tipo} />
                <p className="text-xs text-muted-foreground">
                  Campos do tipo número/data não podem ser convertidos.
                </p>
              </>
            ) : (
              <Select
                name="tipo"
                defaultValue={campo.tipo}
                onValueChange={(valor) => setTipo(valor as TipoCampo)}
              >
                <SelectTrigger id="tipo" className="w-full">
                  <SelectValue>
                    {(value: string | null) =>
                      value === 'texto' ? 'Texto' : value === 'lista' ? 'Lista' : String(value ?? '')
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="texto">Texto</SelectItem>
                  <SelectItem value="lista">Lista</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>

          {!tipoFixo && tipo === 'lista' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="lista_chave">Lista</Label>
              <Select
                name="lista_chave"
                defaultValue={campo.lista_chave ?? undefined}
                required
              >
                <SelectTrigger id="lista_chave" className="w-full">
                  <SelectValue placeholder="Selecione uma lista">
                    {(value: string | null) =>
                      value
                        ? (listas.find((l) => l.chave === value)?.nome ?? String(value))
                        : 'Selecione uma lista'
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {listas.map((lista) => (
                    <SelectItem key={lista.chave} value={lista.chave}>
                      {lista.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label>Obrigatoriedade</Label>
            <label
              htmlFor="obrigatorio_importacao"
              className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm"
            >
              Obrigatório na importação
              <Switch
                id="obrigatorio_importacao"
                name="obrigatorio_importacao"
                defaultChecked={campo.obrigatorio_importacao}
              />
            </label>
            <label
              htmlFor="obrigatorio_finalizacao"
              className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm"
            >
              Obrigatório na finalização
              <Switch
                id="obrigatorio_finalizacao"
                name="obrigatorio_finalizacao"
                defaultChecked={campo.obrigatorio_finalizacao}
              />
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ordem">Ordem</Label>
            <Input
              id="ordem"
              name="ordem"
              type="number"
              defaultValue={campo.ordem}
              required
            />
          </div>

          <label
            htmlFor="ativo"
            className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm"
          >
            Ativo
            <Switch id="ativo" name="ativo" defaultChecked={campo.ativo} />
          </label>

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
