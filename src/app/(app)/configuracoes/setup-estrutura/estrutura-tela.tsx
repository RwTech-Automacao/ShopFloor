'use client'

import { useCallback, useEffect, useState, useTransition, type ChangeEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRightIcon, SearchIcon, Trash2Icon } from 'lucide-react'
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
} from '@/components/ui/dialog'
import {
  adicionarComponenteAction,
  estruturaAtualAction,
  importarEstruturaAction,
  removerComponenteAction,
} from '@/modules/setup/application/cadastros-actions'
import type { ItemEstruturaCadastro } from '@/modules/setup/infra/setup-repository'
import type { Processo } from '@/modules/setup/domain/tipos'
import type { ResultadoComposicao } from '@/modules/setup/domain/composicao-erp'
import { lerComposicao } from '@/modules/setup/domain/composicao-erp'
import { lerComposicaoXlsx } from '@/modules/setup/domain/ler-composicao-xlsx'
import { compararEstrutura, type PreviaEstrutura } from '@/modules/setup/domain/estrutura-previa'

interface Importacao {
  pmo: string
  lido: ResultadoComposicao
  previa: PreviaEstrutura
}

/** Chip colorido de contagem (segue o padrão dos badges de `sf-defeitos`: `<span>` cru, sem o
 * componente `Badge` — ele já traz `bg-primary` no variant padrão e brigaria com a cor daqui). */
function Chip({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  )
}

const corSmd = 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'
const corPth = 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
const corNovo = 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
const corAlterado = 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'

function SecaoRecolhivel({
  titulo,
  contagem,
  defaultOpen,
  children,
}: {
  titulo: string
  contagem: number
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [aberto, setAberto] = useState(defaultOpen ?? false)
  if (contagem === 0) return null
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium"
      >
        <span>{titulo} ({contagem})</span>
        <ChevronRightIcon className={`size-4 shrink-0 text-muted-foreground transition-transform ${aberto ? 'rotate-90' : ''}`} />
      </button>
      {aberto && <div className="max-h-56 overflow-y-auto border-t border-border px-3 py-2">{children}</div>}
    </div>
  )
}

function PreviaImportacaoDialog({
  importacao,
  pendente,
  onFechar,
  onConfirmar,
}: {
  importacao: Importacao
  pendente: boolean
  onFechar: () => void
  onConfirmar: () => void
}) {
  const { pmo, lido, previa } = importacao
  const numImportar = previa.novos.length + previa.processoAlterado.length

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar() }}>
      <DialogContent className="sm:max-w-[min(56rem,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>Prévia da importação — PMO {pmo}</DialogTitle>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          <SecaoRecolhivel titulo="Novos" contagem={previa.novos.length} defaultOpen>
            <ul className="flex flex-col gap-1.5 text-sm">
              {previa.novos.map((i) => (
                <li key={i.componente} className="flex items-center justify-between gap-2">
                  <span className="font-mono">{i.componente}</span>
                  <Chip className={corNovo}>{i.processo}</Chip>
                </li>
              ))}
            </ul>
          </SecaoRecolhivel>

          <SecaoRecolhivel titulo="Processo alterado" contagem={previa.processoAlterado.length} defaultOpen>
            <ul className="flex flex-col gap-1.5 text-sm">
              {previa.processoAlterado.map((i) => (
                <li key={i.componente} className="flex items-center justify-between gap-2">
                  <span className="font-mono">{i.componente}</span>
                  <Chip className={corAlterado}>{i.processoAtual} → {i.processo}</Chip>
                </li>
              ))}
            </ul>
          </SecaoRecolhivel>

          <SecaoRecolhivel titulo="Já existentes" contagem={previa.iguais.length}>
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              {previa.iguais.map((i) => (
                <li key={i.componente}>{i.componente} · {i.processo}</li>
              ))}
            </ul>
          </SecaoRecolhivel>

          <SecaoRecolhivel titulo="Ignorados" contagem={lido.ignorados.length}>
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              {lido.ignorados.map((i, idx) => (
                <li key={`${i.codigo}-${i.linha}-${idx}`}>
                  {i.codigo} · linha {i.linha} · {i.motivo}
                </li>
              ))}
            </ul>
          </SecaoRecolhivel>

          <SecaoRecolhivel titulo="Duplicados no arquivo" contagem={lido.duplicados.length}>
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              {lido.duplicados.map((codigo) => (
                <li key={codigo}>{codigo}</li>
              ))}
            </ul>
          </SecaoRecolhivel>

          <SecaoRecolhivel
            titulo="Só no cadastro (não vieram no arquivo — não serão removidos)"
            contagem={previa.ausentesNoArquivo.length}
          >
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              {previa.ausentesNoArquivo.map((i) => (
                <li key={i.componente}>{i.componente} · {i.processo}</li>
              ))}
            </ul>
          </SecaoRecolhivel>
        </div>

        <DialogFooter>
          <Button
            onClick={onConfirmar}
            disabled={pendente || numImportar === 0}
            className="bg-enterplak hover:bg-enterplak-700"
          >
            {pendente ? 'Importando...' : `Importar ${numImportar} componentes`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AdicionarManualForm({ pmo, onAdicionado }: { pmo: string; onAdicionado: () => void }) {
  const [componente, setComponente] = useState('')
  const [processo, setProcesso] = useState<Processo>('SMD')
  const [pending, startTransition] = useTransition()

  function onAdicionar() {
    if (!componente.trim()) return
    startTransition(async () => {
      const r = await adicionarComponenteAction(pmo, componente, processo)
      if (!r.ok) { toast.error(r.erro, { position: 'bottom-center' }); return }
      toast.success(`Componente ${componente.trim().toUpperCase()} adicionado`, { position: 'bottom-center' })
      setComponente('')
      onAdicionado()
    })
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="novo-componente">Componente</Label>
        <Input
          id="novo-componente"
          value={componente}
          onChange={(e) => setComponente(e.target.value)}
          placeholder="Código do componente"
          className="uppercase"
          autoComplete="off"
        />
      </div>
      <div className="flex gap-4 pb-1.5">
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="processo-manual" checked={processo === 'SMD'} onChange={() => setProcesso('SMD')} />
          SMD
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="processo-manual" checked={processo === 'PTH'} onChange={() => setProcesso('PTH')} />
          PTH
        </label>
      </div>
      <Button onClick={onAdicionar} disabled={pending || !componente.trim()} className="bg-enterplak hover:bg-enterplak-700">
        {pending ? 'Adicionando...' : 'Adicionar'}
      </Button>
    </div>
  )
}

function RemoverComponenteButton({
  pmo,
  componente,
  onRemovido,
}: {
  pmo: string
  componente: string
  onRemovido: () => void
}) {
  const [pending, startTransition] = useTransition()
  const { confirmar, dialog } = useConfirmacao()

  async function onClick() {
    const ok = await confirmar({
      titulo: `Remover "${componente}"?`,
      descricao: 'O componente sai da estrutura da PMO. Não afeta setups já montados.',
    })
    if (!ok) return
    startTransition(async () => {
      const r = await removerComponenteAction(pmo, componente)
      if (!r.ok) { toast.error(r.erro, { position: 'bottom-center' }); return }
      toast.success(`Componente ${componente} removido`, { position: 'bottom-center' })
      onRemovido()
    })
  }

  return (
    <div className="flex justify-end">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Remover componente"
        disabled={pending}
        onClick={onClick}
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2Icon />
      </Button>
      {dialog}
    </div>
  )
}

export function EstruturaTela({
  pmos,
  comEstrutura,
}: {
  pmos: string[]
  comEstrutura: { pmo: string; total: number }[]
}) {
  const router = useRouter()
  const [pmoSel, setPmoSel] = useState('')
  const [itens, setItens] = useState<ItemEstruturaCadastro[]>([])
  const [busca, setBusca] = useState('')
  const [importacao, setImportacao] = useState<Importacao | null>(null)
  const [, startCarregando] = useTransition()
  const [lendo, startLendo] = useTransition()
  const [importando, startImportando] = useTransition()

  const recarregarItens = useCallback(async (pmo: string) => {
    if (!pmo) { setItens([]); return }
    const r = await estruturaAtualAction(pmo)
    if (r.ok) setItens(r.itens)
    else { toast.error(r.erro, { position: 'bottom-center' }); setItens([]) }
  }, [])

  // Carrega a estrutura sempre que a PMO escolhida muda (inclusive quando a importação troca a
  // seleção sozinha).
  useEffect(() => {
    let vivo = true
    startCarregando(async () => {
      if (!pmoSel) { setItens([]); return }
      const r = await estruturaAtualAction(pmoSel)
      if (!vivo) return
      if (r.ok) setItens(r.itens)
      else { toast.error(r.erro, { position: 'bottom-center' }); setItens([]) }
    })
    return () => { vivo = false }
  }, [pmoSel])

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    e.target.value = '' // permite escolher o mesmo arquivo de novo (ex.: depois de corrigir algo)
    if (!file) return
    startLendo(async () => {
      const linhas = await lerComposicaoXlsx(file)
      const lido = lerComposicao(linhas)
      if (lido.erro) { toast.error(lido.erro, { position: 'bottom-center' }); return }
      const pmoArquivo = lido.pmo
      if (!pmoArquivo) { toast.error('Não foi possível identificar a PMO do arquivo.', { position: 'bottom-center' }); return }

      let pmoAlvo = pmoSel
      if (pmoArquivo !== pmoSel) {
        if (!pmos.includes(pmoArquivo)) {
          toast.error(`A PMO ${pmoArquivo} do arquivo não existe no ShopFloor.`, { position: 'bottom-center' })
          return
        }
        pmoAlvo = pmoArquivo
        setPmoSel(pmoAlvo)
      }

      const atual = await estruturaAtualAction(pmoAlvo)
      if (!atual.ok) { toast.error(atual.erro, { position: 'bottom-center' }); return }
      const previa = compararEstrutura(atual.itens, lido.componentes)
      setImportacao({ pmo: pmoAlvo, lido, previa })
    })
  }

  function confirmarImportacao() {
    if (!importacao) return
    const { pmo, lido } = importacao
    startImportando(async () => {
      const r = await importarEstruturaAction(pmo, lido.componentes.map(({ componente, processo }) => ({ componente, processo })))
      if (!r.ok) { toast.error(r.erro, { position: 'bottom-center' }); return }
      toast.success(`Importado: ${r.novos} novos, ${r.atualizados} atualizados`, { position: 'bottom-center' })
      setImportacao(null)
      await recarregarItens(pmo)
      router.refresh()
    })
  }

  const filtro = busca.trim().toUpperCase()
  const listaFiltrada = filtro ? itens.filter((i) => i.componente.includes(filtro)) : itens
  const totalSmd = itens.filter((i) => i.processo === 'SMD').length
  const totalPth = itens.filter((i) => i.processo === 'PTH').length
  const mensagemVazia = itens.length === 0 ? 'Nenhum componente na estrutura.' : 'Nenhum componente encontrado para essa busca.'

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Estrutura da PMO</h1>

      <div className="flex flex-col gap-2 sm:max-w-sm">
        <Label htmlFor="pmo-select">PMO</Label>
        <Select value={pmoSel} onValueChange={(v) => setPmoSel(v ?? '')}>
          <SelectTrigger id="pmo-select" className="w-full">
            <SelectValue placeholder="Selecione uma PMO">
              {(value: string | null) => value || 'Selecione uma PMO'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {pmos.map((pmo) => {
              const total = comEstrutura.find((c) => c.pmo === pmo)?.total
              return (
                <SelectItem key={pmo} value={pmo}>
                  {pmo}{total ? ` (${total} componentes)` : ''}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </div>

      {pmoSel && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Chip className={corSmd}>SMD: {totalSmd}</Chip>
            <Chip className={corPth}>PTH: {totalPth}</Chip>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <Label htmlFor="arquivo-composicao">Importar composição do ERP</Label>
            <Input
              id="arquivo-composicao"
              type="file"
              accept=".xlsx"
              onChange={onFileChange}
              disabled={lendo}
              className="mt-2"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {lendo ? 'Lendo planilha...' : 'Lê a composição do produto exportada do ERP e mostra uma prévia antes de importar.'}
            </p>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <p className="mb-3 text-sm font-medium">Adicionar componente à mão</p>
            <AdicionarManualForm
              pmo={pmoSel}
              onAdicionado={() => { void recarregarItens(pmoSel); router.refresh() }}
            />
          </div>

          <div className="relative w-full max-w-xs">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por código…"
              className="pl-9"
              aria-label="Buscar componente"
            />
          </div>

          {/* Desktop: tabela */}
          <div className="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Componente</TableHead>
                  <TableHead>Processo</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Adicionado em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listaFiltrada.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      {mensagemVazia}
                    </TableCell>
                  </TableRow>
                )}
                {listaFiltrada.map((i) => (
                  <TableRow key={i.componente}>
                    <TableCell className="font-medium">{i.componente}</TableCell>
                    <TableCell>{i.processo}</TableCell>
                    <TableCell>{i.origem === 'importacao' ? 'Importação' : 'Manual'}</TableCell>
                    <TableCell>{new Date(i.criadoEm).toLocaleString('pt-BR')}</TableCell>
                    <TableCell className="text-right">
                      <RemoverComponenteButton
                        pmo={pmoSel}
                        componente={i.componente}
                        onRemovido={() => { void recarregarItens(pmoSel); router.refresh() }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: cards */}
          <div className="space-y-3 lg:hidden">
            {listaFiltrada.length === 0 && (
              <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
                {mensagemVazia}
              </p>
            )}
            {listaFiltrada.map((i) => (
              <div key={i.componente} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-col gap-1">
                    <span className="font-semibold">{i.componente}</span>
                    <span className="text-xs text-muted-foreground">
                      {i.processo} · {i.origem === 'importacao' ? 'Importação' : 'Manual'} · {new Date(i.criadoEm).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                  <RemoverComponenteButton
                    pmo={pmoSel}
                    componente={i.componente}
                    onRemovido={() => { void recarregarItens(pmoSel); router.refresh() }}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {importacao && (
        <PreviaImportacaoDialog
          importacao={importacao}
          pendente={importando}
          onFechar={() => setImportacao(null)}
          onConfirmar={confirmarImportacao}
        />
      )}
    </div>
  )
}
