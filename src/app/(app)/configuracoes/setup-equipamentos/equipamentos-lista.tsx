'use client'

import { useEffect, useState, useTransition, useActionState } from 'react'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cadastrarEquipamentoAction, alternarEquipamentoAction } from '@/modules/setup/application/cadastros-actions'
import type { Equipamento } from '@/modules/setup/infra/setup-repository'
import { rotuloEquipamento, rotulosPosicao, type Processo } from '@/modules/setup/domain/tipos'

function AtivoSwitch({ id, ativo }: { id: string; ativo: boolean }) {
  const [pending, startTransition] = useTransition()

  function onCheckedChange() {
    startTransition(async () => {
      const r = await alternarEquipamentoAction(id, !ativo)
      if (!r.ok) toast.error(r.erro, { position: 'bottom-center' })
    })
  }

  return (
    <Switch
      checked={ativo}
      disabled={pending}
      onCheckedChange={onCheckedChange}
      aria-label={ativo ? 'Desativar equipamento' : 'Ativar equipamento'}
    />
  )
}

function NovoEquipamentoForm() {
  const [open, setOpen] = useState(false)
  const [processo, setProcesso] = useState<Processo>('SMD')
  const [state, formAction, pending] = useActionState(cadastrarEquipamentoAction, undefined)

  useEffect(() => {
    if (!state) return
    if ('ok' in state && state.ok) {
      toast.success('Equipamento cadastrado', { position: 'bottom-center' })
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false)
    } else if ('erro' in state) {
      toast.error(state.erro, { position: 'bottom-center' })
    }
  }, [state])

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) setProcesso('SMD')
      }}
    >
      <DialogTrigger
        render={
          <Button className="bg-enterplak hover:bg-enterplak-700">
            <PlusIcon />
            Novo equipamento
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo equipamento</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Processo</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="processo"
                  value="SMD"
                  defaultChecked
                  onChange={() => setProcesso('SMD')}
                />
                SMD
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="processo"
                  value="PTH"
                  onChange={() => setProcesso('PTH')}
                />
                PTH
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="linha">Linha</Label>
            <Input id="linha" name="linha" placeholder="Linha" autoComplete="off" required />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="equipamento">{rotulosPosicao(processo).equipamento}</Label>
            <Input
              id="equipamento"
              name="equipamento"
              placeholder={rotulosPosicao(processo).equipamento}
              autoComplete="off"
              required
            />
          </div>

          {processo === 'SMD' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="posicoes">Nº de posições</Label>
              <Input id="posicoes" name="posicoes" type="number" min={1} step={1} placeholder="Opcional" autoComplete="off" />
            </div>
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

export function EquipamentosLista({ equipamentos }: { equipamentos: Equipamento[] }) {
  const vazio = 'Nenhum equipamento cadastrado.'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Linhas e máquinas</h1>
        <NovoEquipamentoForm />
      </div>

      {/* Desktop: tabela */}
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Processo</TableHead>
              <TableHead>Linha</TableHead>
              <TableHead>Máquina/Bloco</TableHead>
              <TableHead>Posições</TableHead>
              <TableHead className="text-right">Ativo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {equipamentos.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {vazio}
                </TableCell>
              </TableRow>
            )}
            {equipamentos.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-medium">{e.processo}</TableCell>
                <TableCell>{e.linha}</TableCell>
                <TableCell>{rotuloEquipamento(e.processo, e.equipamento)}</TableCell>
                <TableCell>{e.posicoes ?? '—'}</TableCell>
                <TableCell className="text-right">
                  <AtivoSwitch id={e.id} ativo={e.ativo} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 lg:hidden">
        {equipamentos.length === 0 && (
          <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
            {vazio}
          </p>
        )}
        {equipamentos.map((e) => (
          <div key={e.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col gap-1">
                <span className="font-semibold">{rotuloEquipamento(e.processo, e.equipamento)}</span>
                <span className="text-xs text-muted-foreground">
                  {e.processo} · Linha {e.linha}
                  {e.posicoes !== null ? ` · ${e.posicoes} posições` : ''}
                </span>
              </div>
              <AtivoSwitch id={e.id} ativo={e.ativo} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
