'use client'

import { useActionState, useState } from 'react'
import { Plus, Pencil, ArrowUp, ArrowDown, X } from 'lucide-react'
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
  componentes: string[]
}

export interface FluxoExistente {
  pmo: string
  op: string
  postos: string[]
  componentes: string[]
}

export function OrdemForm({
  postos,
  ordem,
  fluxosExistentes,
  pmosExistentes,
}: {
  postos: string[]
  ordem?: OrdemView
  fluxosExistentes: FluxoExistente[]
  pmosExistentes: string[]
}) {
  const ehEdicao = ordem !== undefined
  const action = ehEdicao ? editarOrdemAction : criarOrdemAction
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<ResultadoOrdem | undefined, FormData>(action, undefined)

  const [pmo, setPmo] = useState(ordem?.pmo ?? '')
  const [fluxo, setFluxo] = useState<string[]>(ordem?.postos ?? [])
  const [receita, setReceita] = useState<string[]>(ordem?.componentes ?? [])

  const [processado, setProcessado] = useState(state)
  if (state !== processado) {
    setProcessado(state)
    if (state?.ok) setOpen(false)
  }

  const disponiveis = postos.filter((p) => !fluxo.includes(p))
  const fontes = fluxosExistentes.filter((f) => f.pmo === pmo && f.op !== ordem?.op && f.postos.length > 0)

  function mover(i: number, delta: number) {
    const j = i + delta
    if (j < 0 || j >= fluxo.length) return
    const copia = [...fluxo]
    const [item] = copia.splice(i, 1)
    copia.splice(j, 0, item!)
    setFluxo(copia)
  }
  function remover(i: number) {
    setFluxo(fluxo.filter((_, idx) => idx !== i))
  }
  function adicionar(posto: string) {
    if (!fluxo.includes(posto)) setFluxo([...fluxo, posto])
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
          <input type="hidden" name="fluxo" value={JSON.stringify(fluxo)} />
          <input type="hidden" name="componentes" value={JSON.stringify(fluxo.includes('Integração') ? receita : [])} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pmo">PMO *</Label>
              <Input id="pmo" name="pmo" value={pmo} onChange={(e) => setPmo(e.target.value)} required />
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

          {/* Fluxo de postos (ordenado) */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Fluxo de postos <span className="font-normal text-muted-foreground">· na ordem da linha</span></p>
              {fontes.length > 0 && (
                <Select value="" onValueChange={(op) => {
                  const fonte = fontes.find((f) => f.op === op)
                  if (fonte) { setFluxo(fonte.postos); setReceita(fonte.componentes) }
                }}>
                  <SelectTrigger className="h-8 w-auto text-xs">
                    <SelectValue placeholder="Puxar fluxo de OP…" />
                  </SelectTrigger>
                  <SelectContent>
                    {fontes.map((f) => (
                      <SelectItem key={f.op} value={f.op}>{`OP ${f.op}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <ol className="flex flex-col gap-1">
              {fluxo.map((posto, i) => (
                <li key={posto} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm">
                  <span className="w-5 text-center text-xs font-medium text-enterplak">{i + 1}</span>
                  <span className="flex-1">{posto}</span>
                  <button type="button" aria-label="Subir" onClick={() => mover(i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-tinta disabled:opacity-30">
                    <ArrowUp className="size-4" />
                  </button>
                  <button type="button" aria-label="Descer" onClick={() => mover(i, 1)} disabled={i === fluxo.length - 1} className="text-muted-foreground hover:text-tinta disabled:opacity-30">
                    <ArrowDown className="size-4" />
                  </button>
                  <button type="button" aria-label="Remover" onClick={() => remover(i)} className="text-muted-foreground hover:text-red-600">
                    <X className="size-4" />
                  </button>
                </li>
              ))}
              {fluxo.length === 0 && (
                <li className="rounded-lg border border-dashed border-border px-2.5 py-3 text-center text-xs text-muted-foreground">
                  Nenhum posto no fluxo. Adicione abaixo.
                </li>
              )}
            </ol>

            {disponiveis.length > 0 && (
              <div className="mt-2">
                <Select value="" onValueChange={(p) => p && adicionar(p)}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="+ Adicionar posto ao fluxo" />
                  </SelectTrigger>
                  <SelectContent>
                    {disponiveis.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Receita da Integração (só quando Integração está no fluxo) */}
          {fluxo.includes('Integração') && (
            <ReceitaIntegracao
              receita={receita}
              setReceita={setReceita}
              pmosDisponiveis={pmosExistentes.filter((p) => p !== pmo && !receita.includes(p))}
            />
          )}

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

function ReceitaIntegracao({
  receita,
  setReceita,
  pmosDisponiveis,
}: {
  receita: string[]
  setReceita: (r: string[]) => void
  pmosDisponiveis: string[]
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium">
        Receita da Integração{' '}
        <span className="font-normal text-muted-foreground">· PMOs de placa que compõem este produto</span>
      </p>
      {receita.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {receita.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full border border-border bg-accent px-2.5 py-1 text-xs">
              {c}
              <button type="button" aria-label={`Remover ${c}`} onClick={() => setReceita(receita.filter((x) => x !== c))} className="text-muted-foreground hover:text-red-600">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="mb-2 text-xs text-muted-foreground">Sem receita: a Integração aceita placas de qualquer PMO.</p>
      )}
      {pmosDisponiveis.length > 0 && (
        <Select value="" onValueChange={(p) => p && setReceita([...receita, p])}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="+ Adicionar PMO à receita" />
          </SelectTrigger>
          <SelectContent>
            {pmosDisponiveis.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
