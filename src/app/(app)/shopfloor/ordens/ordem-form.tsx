'use client'

import { useActionState, useState, useTransition } from 'react'
import { Plus, Pencil, ArrowUp, ArrowDown, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useConfirmacao } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  criarOrdemAction,
  editarOrdemAction,
  type ResultadoOrdem,
} from '@/modules/shopfloor/application/ordens-actions'
import { salvarPadraoAction, excluirPadraoAction } from '@/modules/shopfloor/application/padroes-fluxo-actions'

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

export interface PadraoFluxo {
  id: string
  pmo: string
  nome: string
  descricao: string
  postos: string[]
  componentes: string[]
}

const CLIENTE_NOVO = '__novo_cliente__'

export function OrdemForm({
  postos,
  ordem,
  padroesExistentes,
  pmosExistentes,
  clientesExistentes,
  dadosPorPmo,
}: {
  postos: string[]
  ordem?: OrdemView
  padroesExistentes: PadraoFluxo[]
  pmosExistentes: string[]
  clientesExistentes: string[]
  dadosPorPmo: Record<string, { cliente: string; descricao: string }>
}) {
  const ehEdicao = ordem !== undefined
  const action = ehEdicao ? editarOrdemAction : criarOrdemAction
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<ResultadoOrdem | undefined, FormData>(action, undefined)

  const [pmo, setPmo] = useState(ordem?.pmo ?? '')
  const [fluxo, setFluxo] = useState<string[]>(ordem?.postos ?? [])
  const [receita, setReceita] = useState<string[]>(ordem?.componentes ?? [])
  const [cliente, setCliente] = useState(ordem?.cliente ?? '')
  const [descricao, setDescricao] = useState(ordem?.descricao ?? '')
  const [instanciaForm, setInstanciaForm] = useState(0)
  const [modoNovoCliente, setModoNovoCliente] = useState(false)
  // Reaproveita a grafia existente se o "novo" bater com um cadastrado (evita LINCE vs Lince).
  const clienteFinal = modoNovoCliente
    ? clientesExistentes.find((c) => c.toLowerCase() === cliente.trim().toLowerCase()) ?? cliente.trim()
    : cliente

  const [processado, setProcessado] = useState(state)
  const [mostrarErro, setMostrarErro] = useState(false)
  if (state !== processado) {
    setProcessado(state)
    setMostrarErro(true)
    if (state?.ok) setOpen(false)
  }

  const disponiveis = postos.filter((p) => !fluxo.includes(p))
  const padroesDoPmo = padroesExistentes.filter((p) => p.pmo === pmo)

  const [salvarAberto, setSalvarAberto] = useState(false)
  const [nomePadrao, setNomePadrao] = useState('')
  const [pmoPadrao, setPmoPadrao] = useState('')
  const [salvandoPadrao, startSalvarPadrao] = useTransition()
  const [padraoSelecionado, setPadraoSelecionado] = useState('')
  const [excluindoPadrao, startExcluirPadrao] = useTransition()
  const { confirmar, dialog: dialogConfirmacao } = useConfirmacao()

  function abrirSalvarPadrao() {
    setNomePadrao('')
    setPmoPadrao(pmo)
    setSalvarAberto(true)
  }

  async function onConfirmarSalvarPadrao() {
    const nome = nomePadrao.trim()
    const pmoAlvo = pmoPadrao.trim()
    if (nome === '') {
      toast.error('Informe o nome do padrão.')
      return
    }
    if (pmoAlvo === '') {
      toast.error('Informe a PMO à qual associar o padrão.')
      return
    }
    const existente = padroesExistentes.find((p) => p.pmo === pmoAlvo && p.nome === nome)
    if (existente) {
      const ok = await confirmar({
        titulo: `Já existe um padrão "${nome}" para a PMO ${pmoAlvo}. Sobrescrever?`,
        rotuloConfirmar: 'Sobrescrever',
      })
      if (!ok) return
    }
    startSalvarPadrao(async () => {
      const r = await salvarPadraoAction({
        pmo: pmoAlvo,
        nome,
        descricao: '',
        postos: fluxo,
        componentes: receita,
      })
      if (r.ok) {
        setSalvarAberto(false)
      } else {
        toast.error(r.erro)
      }
    })
  }

  async function onApagarPadraoSelecionado() {
    const p = padroesDoPmo.find((x) => x.id === padraoSelecionado)
    if (!p) return
    const ok = await confirmar({ titulo: `Apagar o padrão "${p.nome}"?`, rotuloConfirmar: 'Apagar' })
    if (!ok) return
    startExcluirPadrao(async () => {
      const r = await excluirPadraoAction(p.id)
      if (r.ok) setPadraoSelecionado('')
      else toast.error(r.erro)
    })
  }

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
    <>
      <Dialog open={open} onOpenChange={(v) => {
        setOpen(v)
        if (v) {
          // Reset ao abrir: "Nova OP" limpa; edição recarrega a OP (fix do "cache").
          setPmo(ordem?.pmo ?? '')
          setFluxo(ordem?.postos ?? [])
          setReceita(ordem?.componentes ?? [])
          setCliente(ordem?.cliente ?? '')
          setDescricao(ordem?.descricao ?? '')
          setModoNovoCliente(false)
          setPadraoSelecionado('')
          setMostrarErro(false)
          setInstanciaForm((n) => n + 1)
        }
      }}>
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
          <form key={instanciaForm} action={formAction} className="flex flex-col gap-4">
            {ehEdicao && <input type="hidden" name="id" value={ordem.id} />}
            <input type="hidden" name="fluxo" value={JSON.stringify(fluxo)} />
            <input type="hidden" name="componentes" value={JSON.stringify(fluxo.includes('Integração') ? receita : [])} />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pmo">PMO *</Label>
                <Input id="pmo" name="pmo" value={pmo} onChange={(e) => {
                  const novo = e.target.value
                  setPmo(novo)
                  const dados = dadosPorPmo[novo.trim()]
                  if (dados) { setCliente(dados.cliente); setDescricao(dados.descricao); setModoNovoCliente(false) }
                }} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="op">Nº OP *</Label>
                <Input id="op" name="op" defaultValue={ordem?.op ?? ''} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Cliente *</Label>
                <input type="hidden" name="cliente" value={clienteFinal} />
                <Select
                  value={modoNovoCliente ? CLIENTE_NOVO : cliente}
                  onValueChange={(v) => {
                    if (v === CLIENTE_NOVO) { setModoNovoCliente(true); setCliente('') }
                    else { setModoNovoCliente(false); setCliente(v ?? '') }
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
                  <SelectContent>
                    {clientesExistentes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    <SelectItem value={CLIENTE_NOVO}>＋ Novo cliente…</SelectItem>
                  </SelectContent>
                </Select>
                {modoNovoCliente && (
                  <Input
                    aria-label="Nome do novo cliente"
                    value={cliente}
                    onChange={(e) => setCliente(e.target.value)}
                    placeholder="Nome do novo cliente"
                    autoFocus
                  />
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qtd">Quantidade</Label>
                <Input id="qtd" name="qtd" type="number" defaultValue={ordem?.qtd ?? ''} />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="descricao">Descrição</Label>
                <Input id="descricao" name="descricao" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
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
                <Label htmlFor="sn_ini">SN inicial *</Label>
                <Input id="sn_ini" name="sn_ini" defaultValue={ordem?.sn_ini ?? ''} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sn_fim">SN final *</Label>
                <Input id="sn_fim" name="sn_fim" defaultValue={ordem?.sn_fim ?? ''} required />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Faixa de SN obrigatória — mesmo formato nos dois limites (ex.: <code>SN0001</code> a <code>SN0500</code>).
              </p>
            </div>

            {/* Fluxo de postos (ordenado) */}
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Fluxo de postos <span className="font-normal text-muted-foreground">· na ordem da linha</span></p>
                <div className="flex flex-wrap items-center gap-2">
                  {padroesDoPmo.length > 0 && (
                    <div className="flex items-center gap-1">
                      <Select value={padraoSelecionado} onValueChange={(id) => {
                        setPadraoSelecionado(id ?? '')
                        const padrao = padroesDoPmo.find((p) => p.id === id)
                        if (padrao) { setFluxo(padrao.postos); setReceita(padrao.componentes) }
                      }}>
                        <SelectTrigger className="h-8 w-auto text-xs">
                          <SelectValue>
                            {(value: string | null) => {
                              const p = padroesDoPmo.find((x) => x.id === value)
                              return p ? p.nome : 'Puxar de padrão…'
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {padroesDoPmo.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {padraoSelecionado !== '' && padroesDoPmo.some((p) => p.id === padraoSelecionado) && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={onApagarPadraoSelecionado}
                          disabled={excluindoPadrao}
                          className="h-8 text-xs text-red-600 hover:text-red-700"
                        >
                          Excluir padrão
                        </Button>
                      )}
                    </div>
                  )}
                  {pmo.trim() !== '' && fluxo.length > 0 && (
                    <Button type="button" size="sm" variant="outline" onClick={abrirSalvarPadrao}>
                      Salvar como padrão
                    </Button>
                  )}
                </div>
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

            {mostrarErro && state && !state.ok && <p className="text-sm text-red-600">{state.erro}</p>}

            <DialogFooter>
              <Button type="submit" disabled={pending} className="bg-enterplak hover:bg-enterplak-700">
                {pending ? 'Salvando…' : 'Salvar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={salvarAberto} onOpenChange={setSalvarAberto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Salvar como padrão</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nomePadrao">Nome *</Label>
              <Input
                id="nomePadrao"
                value={nomePadrao}
                onChange={(e) => setNomePadrao(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pmoPadrao">Associar à PMO *</Label>
              <Input
                id="pmoPadrao"
                value={pmoPadrao}
                onChange={(e) => setPmoPadrao(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSalvarAberto(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={salvandoPadrao}
              onClick={onConfirmarSalvarPadrao}
              className="bg-enterplak hover:bg-enterplak-700"
            >
              {salvandoPadrao ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {dialogConfirmacao}
    </>
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
