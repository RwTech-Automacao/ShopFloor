# ShopFloor Lançamento — Plano C2: Tela do operador — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A tela de **Lançamento** do operador (`/shopfloor/lancamento`): Colaborador bipado + Cliente→PMO→OP em cascata + Posto (filtrado pela OP) + Nº de Série com foco automático + campos dinâmicos por posto, chamando a action `lancar` (já testada no C1). É a última peça pro módulo funcionar de ponta a ponta.

**Architecture:** A página (server, guard `lancar`) carrega **todas as OPs ativas** (cliente/pmo/op/descrição/faixa/fluxo ordenado) + os defeitos, e passa pro form client. O form faz a **cascata localmente** (sem round-trip por seleção), monta os campos dinâmicos conforme o posto, valida no cliente (espelhando o servidor) e submete via `lancar`. Reusa o domínio puro (`serieDentroDaFaixa`, `postoTemStatus`) no cliente.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19 (client component + `useTransition`), Supabase/RLS, TypeScript strict, componentes `@/components/ui/*`, `sonner`.

## Global Constraints

- **Branch:** `feat/shopfloor-lancamento` (a mesma; continua nela). **SEM migração** (tudo já existe).
- Permissão: **`lancar`**. A page se guarda: `getSessao()` → se `!podeFazer(perfil,'lancar')` → `<SemPermissao/>`.
- **Posto = os postos DA OP** (do fluxo, na ordem). O operador só vê postos aplicáveis àquela OP.
- **Submeter o `posto` com a string EXATA do catálogo** (vem da lista de postos da OP — inerentemente exata; a `sf_lancar` compara literal).
- **Campos por posto:** sem status (Inicial/Montagem PTH/Integração/Embalagem/Extra máquina) → só SN; com status (SPI/SMD/PTH/Teste/Burn-in/Teste Final/Inspeção Final) → Status; reprovado → SPI: posições / demais: defeitos múltiplos; NQA → Visual+Funcional (status derivado no servidor).
- **Tipos de defeito** (campo `tipo`): SMD, PTH, Integração, TOP, BOT, Funcional, Elétrico. **Código** via datalist de todos os defeitos.
- **OP sem faixa de SN → o botão Enviar fica travado** (mensagem); o servidor também barra.
- Padrões: repositório `import 'server-only'` + `createServerSupabase()`.
- TS strict `noUncheckedIndexedAccess`. Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit via heredoc. **Sem push.**
- Verificação: `npx tsc --noEmit && npm run lint && npm run test`.

## File Structure

- Modify: `src/modules/shopfloor/infra/lancamento-repository.ts` (add `listarOrdensParaLancamento`)
- Modify: `src/modules/shopfloor/application/lancar-action.ts` (harden `qtdPorCaixa` numérico na Embalagem)
- Create: `src/app/(app)/shopfloor/lancamento/page.tsx`
- Create: `src/app/(app)/shopfloor/lancamento/lancamento-form.tsx`
- Modify: `src/shared/ui/app-shell.tsx` (item "Lançamento" na seção "Fluxo de Processos")

---

### Task 1: Repo `listarOrdensParaLancamento` + harden `qtdPorCaixa`

**Files:**
- Modify: `src/modules/shopfloor/infra/lancamento-repository.ts`
- Modify: `src/modules/shopfloor/application/lancar-action.ts`

**Interfaces:**
- Produces: `interface OrdemLancamentoLista { cliente; pmo; op; descricao; sn_ini; sn_fim; postos: string[] }`; `listarOrdensParaLancamento(): Promise<OrdemLancamentoLista[]>` (OPs ativas, postos ordenados).

- [ ] **Step 1: Repositório — adicionar a função e o tipo**

Em `src/modules/shopfloor/infra/lancamento-repository.ts`, adicionar (após as interfaces existentes / no fim do arquivo):

```ts
export interface OrdemLancamentoLista {
  cliente: string
  pmo: string
  op: string
  descricao: string
  sn_ini: string
  sn_fim: string
  postos: string[]
}

/** Todas as OPs ativas com config + fluxo ordenado, para a cascata da tela de Lançamento. */
export async function listarOrdensParaLancamento(): Promise<OrdemLancamentoLista[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('cliente,pmo,op,descricao,sn_ini,sn_fim,sf_ordem_postos(posto,ordem)')
    .neq('status', 'FINALIZADA')
    .order('cliente')
    .order('pmo')
    .order('op')
  if (error) throw error
  const rows = data as unknown as {
    cliente: string
    pmo: string
    op: string
    descricao: string
    sn_ini: string
    sn_fim: string
    sf_ordem_postos: { posto: string; ordem: number }[]
  }[]
  return rows.map((r) => ({
    cliente: r.cliente,
    pmo: r.pmo,
    op: r.op,
    descricao: r.descricao,
    sn_ini: r.sn_ini,
    sn_fim: r.sn_fim,
    postos: [...r.sf_ordem_postos].sort((a, b) => a.ordem - b.ordem).map((p) => p.posto),
  }))
}
```

- [ ] **Step 2: Action — validar `qtdPorCaixa` numérico na Embalagem**

Em `src/modules/shopfloor/application/lancar-action.ts`, logo APÓS a linha que calcula `const qtdPorCaixa = ...`, adicionar:

```ts
  // Embalagem exige quantidade por caixa numérica e positiva (evita NaN furar o limite).
  if (entrada.posto.toLowerCase() === 'embalagem') {
    if (qtdPorCaixa === null || !Number.isInteger(qtdPorCaixa) || qtdPorCaixa <= 0) {
      return { ok: false, erro: 'Informe uma quantidade por caixa válida (inteiro maior que zero).' }
    }
  }
```

- [ ] **Step 3: Compila** — `npx tsc --noEmit` → sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/modules/shopfloor/infra/lancamento-repository.ts src/modules/shopfloor/application/lancar-action.ts
git commit -F - << 'EOF'
feat(shopfloor): OPs para o Lançamento + guarda de qtd por caixa numérica

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 2: Página do Lançamento (server, guard) + item de menu

**Files:**
- Create: `src/app/(app)/shopfloor/lancamento/page.tsx`
- Modify: `src/shared/ui/app-shell.tsx`

**Interfaces:**
- Consumes: `listarOrdensParaLancamento` (Task 1), `listarDefeitos` (C1), `getSessao`, `podeFazer`, `SemPermissao`, `LancamentoForm` (Task 3).

- [ ] **Step 1: `page.tsx`**

`src/app/(app)/shopfloor/lancamento/page.tsx`:

```tsx
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarOrdensParaLancamento, listarDefeitos } from '@/modules/shopfloor/infra/lancamento-repository'
import { LancamentoForm } from './lancamento-form'

export default async function LancamentoPage() {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'lancar')) {
    return <SemPermissao descricao="Você não tem permissão para lançar." />
  }

  const [ordens, defeitos] = await Promise.all([listarOrdensParaLancamento(), listarDefeitos()])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Lançamento</h2>
        <p className="text-sm text-muted-foreground">Registro de peças por posto.</p>
      </div>
      <LancamentoForm ordens={ordens} defeitos={defeitos} />
    </div>
  )
}
```

- [ ] **Step 2: Item de menu em `app-shell.tsx`**

No array `SHOPFLOOR` de `src/shared/ui/app-shell.tsx`, adicionar o item de Lançamento ANTES do de Ordens (o operador vê Lançamento; o admin vê os dois). Adicionar `ScanLine` aos imports de `lucide-react` e:

```ts
const SHOPFLOOR: Folha[] = [
  { chave: 'lancamento', rotulo: 'Lançamento', href: '/shopfloor/lancamento', icone: ScanLine, perm: 'lancar' },
  { chave: 'op-ordens', rotulo: 'Ordens de Produção', href: '/shopfloor/ordens', icone: FileStack, perm: 'administrar' },
]
```

(O `tituloPagina` já inclui `...SHOPFLOOR`; o filtro por permissão já existe — o item de Lançamento aparece p/ quem tem `lancar`.)

- [ ] **Step 3: Compila** — `npx tsc --noEmit` → sem erros (a page importa `LancamentoForm` que será criado na Task 3 — se rodar tsc antes da Task 3, vai acusar o import; ok, a Task 3 fecha).

- [ ] **Step 4: Commit** (junto com a Task 3, pois a page depende do form — ver Task 3 Step de commit).

---

### Task 3: Formulário de Lançamento (client)

**Files:**
- Create: `src/app/(app)/shopfloor/lancamento/lancamento-form.tsx`

**Interfaces:**
- Consumes: `lancar`, `EntradaLancamento` (C1); `serieDentroDaFaixa` (domain/serie); `postoTemStatus` (domain/lancamento-linhas); `OrdemLancamentoLista` (Task 1).

- [ ] **Step 1: Implementar o form**

`src/app/(app)/shopfloor/lancamento/lancamento-form.tsx`:

```tsx
'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { serieDentroDaFaixa } from '@/modules/shopfloor/domain/serie'
import { postoTemStatus } from '@/modules/shopfloor/domain/lancamento-linhas'
import { lancar } from '@/modules/shopfloor/application/lancar-action'
import type { OrdemLancamentoLista } from '@/modules/shopfloor/infra/lancamento-repository'

const TIPOS_DEFEITO = ['SMD', 'PTH', 'Integração', 'TOP', 'BOT', 'Funcional', 'Elétrico']
const OPCOES_STATUS = ['Aprovado', 'Reprovado']

interface DefeitoLinha {
  codigo: string
  posicao: string
  tipo: string
}

export function LancamentoForm({
  ordens,
  defeitos,
}: {
  ordens: OrdemLancamentoLista[]
  defeitos: { codigo: string; tipo: number }[]
}) {
  const [colaborador, setColaborador] = useState('')
  const [cliente, setCliente] = useState('')
  const [pmo, setPmo] = useState('')
  const [op, setOp] = useState('')
  const [posto, setPosto] = useState('')
  const [numeroSerie, setNumeroSerie] = useState('')
  const [status, setStatus] = useState('')
  const [numeroCaixa, setNumeroCaixa] = useState('')
  const [qtdPorCaixa, setQtdPorCaixa] = useState('')
  const [nqaVisual, setNqaVisual] = useState('')
  const [nqaFuncional, setNqaFuncional] = useState('')
  const [defeitosSel, setDefeitosSel] = useState<DefeitoLinha[]>([{ codigo: '', posicao: '', tipo: '' }])
  const [posicoesSPI, setPosicoesSPI] = useState<string[]>([''])
  const [enviando, startTransition] = useTransition()
  const snRef = useRef<HTMLInputElement>(null)

  const clientes = useMemo(() => [...new Set(ordens.map((o) => o.cliente))], [ordens])
  const pmos = useMemo(
    () => [...new Set(ordens.filter((o) => o.cliente === cliente).map((o) => o.pmo))],
    [ordens, cliente],
  )
  const ops = useMemo(
    () => ordens.filter((o) => o.cliente === cliente && o.pmo === pmo).map((o) => o.op),
    [ordens, cliente, pmo],
  )
  const ordemSel = useMemo(
    () => ordens.find((o) => o.cliente === cliente && o.pmo === pmo && o.op === op) ?? null,
    [ordens, cliente, pmo, op],
  )
  const postosDaOp = ordemSel?.postos ?? []

  const comStatus = posto !== '' && postoTemStatus(posto)
  const ehNqa = posto === 'Inspeção NQA'
  const ehSpi = posto === 'Inspeção SPI'
  const ehEmbalagem = posto === 'Embalagem'
  const reprovado = status.toLowerCase() === 'reprovado'
  const semFaixa = ordemSel !== null && (ordemSel.sn_ini.trim() === '' || ordemSel.sn_fim.trim() === '')

  function mudarCliente(v: string) {
    setCliente(v); setPmo(''); setOp(''); setPosto('')
  }
  function mudarPmo(v: string) {
    setPmo(v); setOp(''); setPosto('')
  }
  function mudarOp(v: string) {
    setOp(v); setPosto('')
  }
  function mudarPosto(v: string) {
    setPosto(v); setStatus(''); setDefeitosSel([{ codigo: '', posicao: '', tipo: '' }]); setPosicoesSPI([''])
  }

  const valido = useMemo(() => {
    if (!colaborador.trim() || !cliente || !pmo || !op || !posto || numeroSerie.trim() === '') return false
    if (!ordemSel || semFaixa) return false
    if (!serieDentroDaFaixa(ordemSel.sn_ini, ordemSel.sn_fim, numeroSerie)) return false
    if (ehEmbalagem && (numeroCaixa.trim() === '' || !(Number(qtdPorCaixa) > 0))) return false
    if (ehNqa && (nqaVisual === '' || nqaFuncional === '')) return false
    if (comStatus && !ehNqa && status === '') return false
    if (comStatus && !ehNqa && reprovado) {
      if (ehSpi) return posicoesSPI.some((p) => p.trim() !== '')
      return defeitosSel.some((d) => d.codigo.trim() !== '' || d.posicao.trim() !== '')
    }
    return true
  }, [colaborador, cliente, pmo, op, posto, numeroSerie, ordemSel, semFaixa, ehEmbalagem, numeroCaixa, qtdPorCaixa, ehNqa, nqaVisual, nqaFuncional, comStatus, status, reprovado, ehSpi, posicoesSPI, defeitosSel])

  function limparPeca() {
    setNumeroSerie(''); setStatus(''); setNqaVisual(''); setNqaFuncional('')
    setDefeitosSel([{ codigo: '', posicao: '', tipo: '' }]); setPosicoesSPI([''])
    setTimeout(() => snRef.current?.focus(), 0)
  }

  function onEnviar() {
    if (!valido || enviando) return
    startTransition(async () => {
      const r = await lancar({
        colaborador,
        posto,
        pmo,
        op,
        numeroSerie,
        status: comStatus && !ehNqa ? status : undefined,
        numeroCaixa: ehEmbalagem ? numeroCaixa : undefined,
        qtdPorCaixa: ehEmbalagem ? qtdPorCaixa : undefined,
        nqaVisual: ehNqa ? nqaVisual : undefined,
        nqaFuncional: ehNqa ? nqaFuncional : undefined,
        defeitos:
          reprovado && !ehSpi
            ? defeitosSel.filter((d) => d.codigo.trim() !== '' || d.posicao.trim() !== '')
            : undefined,
        posicoesSPI: reprovado && ehSpi ? posicoesSPI.filter((p) => p.trim() !== '') : undefined,
      })
      if (r.ok) {
        toast.success(
          ehEmbalagem && r.caixaCount != null
            ? `Registrado. Peças na caixa ${numeroCaixa}: ${r.caixaCount}`
            : 'Registrado.',
        )
        limparPeca()
      } else {
        toast.error(r.erro)
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Contexto */}
      <Card>
        <CardHeader>
          <CardTitle>Contexto</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="colaborador">Colaborador</Label>
            <Input id="colaborador" value={colaborador} onChange={(e) => setColaborador(e.target.value)} autoComplete="off" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Cliente</Label>
            <Select value={cliente} onValueChange={(v) => mudarCliente(v ?? '')}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{clientes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>PMO</Label>
            <Select value={pmo} onValueChange={(v) => mudarPmo(v ?? '')} disabled={cliente === ''}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{pmos.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>OP</Label>
            <Select value={op} onValueChange={(v) => mudarOp(v ?? '')} disabled={pmo === ''}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{ops.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Posto</Label>
            <Select value={posto} onValueChange={(v) => mudarPosto(v ?? '')} disabled={op === ''}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{postosDaOp.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Descrição</Label>
            <Input value={ordemSel?.descricao ?? ''} readOnly disabled />
          </div>
          {ehEmbalagem && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="caixa">Nº da Caixa</Label>
                <Input id="caixa" value={numeroCaixa} onChange={(e) => setNumeroCaixa(e.target.value)} autoComplete="off" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qtdcaixa">Qtd por caixa</Label>
                <Input id="qtdcaixa" type="number" value={qtdPorCaixa} onChange={(e) => setQtdPorCaixa(e.target.value)} />
              </div>
            </>
          )}
          {semFaixa && (
            <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-3">Esta OP não tem faixa de Nº de Série cadastrada — não é possível lançar.</p>
          )}
        </CardContent>
      </Card>

      {/* Bipagem */}
      <Card>
        <CardHeader>
          <CardTitle>Peça</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sn">Nº de Série</Label>
            <Input
              id="sn"
              ref={snRef}
              value={numeroSerie}
              onChange={(e) => setNumeroSerie(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnviar() } }}
              autoComplete="off"
              autoFocus
              className="h-12 text-lg"
              placeholder="Bipe o Nº de Série"
            />
          </div>

          {comStatus && !ehNqa && (
            <div className="flex flex-col gap-1.5 sm:max-w-xs">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v ?? '')}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{OPCOES_STATUS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}

          {ehNqa && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:max-w-lg">
              <div className="flex flex-col gap-1.5">
                <Label>Inspeção Visual</Label>
                <Select value={nqaVisual} onValueChange={(v) => setNqaVisual(v ?? '')}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{OPCOES_STATUS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Inspeção Funcional</Label>
                <Select value={nqaFuncional} onValueChange={(v) => setNqaFuncional(v ?? '')}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{OPCOES_STATUS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* SPI reprovado → posições */}
          {comStatus && ehSpi && reprovado && (
            <div className="flex flex-col gap-2">
              <Label>Posições reprovadas</Label>
              {posicoesSPI.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={p}
                    onChange={(e) => setPosicoesSPI(posicoesSPI.map((x, idx) => (idx === i ? e.target.value : x)))}
                    placeholder="Posição"
                    className="sm:max-w-xs"
                  />
                  <button type="button" aria-label="Remover posição" onClick={() => setPosicoesSPI(posicoesSPI.length > 1 ? posicoesSPI.filter((_, idx) => idx !== i) : posicoesSPI)} className="text-muted-foreground hover:text-red-600 disabled:opacity-30" disabled={posicoesSPI.length <= 1}>
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setPosicoesSPI([...posicoesSPI, ''])} className="self-start text-sm font-medium text-enterplak hover:underline">
                <Plus className="mr-1 inline size-4" /> Adicionar posição
              </button>
            </div>
          )}

          {/* Demais reprovado → defeitos múltiplos */}
          {comStatus && !ehSpi && !ehNqa && reprovado && (
            <div className="flex flex-col gap-2">
              <Label>Defeitos</Label>
              <datalist id="defeitos-list">
                {defeitos.map((d) => <option key={d.codigo} value={d.codigo} />)}
              </datalist>
              {defeitosSel.map((d, i) => (
                <div key={i} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                  <Input list="defeitos-list" value={d.codigo} onChange={(e) => setDefeitosSel(defeitosSel.map((x, idx) => (idx === i ? { ...x, codigo: e.target.value } : x)))} placeholder="Código" />
                  <Input value={d.posicao} onChange={(e) => setDefeitosSel(defeitosSel.map((x, idx) => (idx === i ? { ...x, posicao: e.target.value } : x)))} placeholder="Posição" />
                  <Select value={d.tipo} onValueChange={(v) => setDefeitosSel(defeitosSel.map((x, idx) => (idx === i ? { ...x, tipo: v ?? '' } : x)))}>
                    <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
                    <SelectContent>{TIPOS_DEFEITO.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                  <button type="button" aria-label="Remover defeito" onClick={() => setDefeitosSel(defeitosSel.length > 1 ? defeitosSel.filter((_, idx) => idx !== i) : defeitosSel)} className="pb-2 text-muted-foreground hover:text-red-600 disabled:opacity-30" disabled={defeitosSel.length <= 1}>
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setDefeitosSel([...defeitosSel, { codigo: '', posicao: '', tipo: '' }])} className="self-start text-sm font-medium text-enterplak hover:underline">
                <Plus className="mr-1 inline size-4" /> Adicionar defeito
              </button>
            </div>
          )}

          <div>
            <Button onClick={onEnviar} disabled={!valido || enviando} className="h-11 bg-enterplak px-8 hover:bg-enterplak-700">
              {enviando ? 'Enviando…' : 'Enviar'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Compila** — `npx tsc --noEmit` → sem erros. Se o `ref` no `Input` acusar tipo (o componente pode não repassar `ref`), abra `src/components/ui/input.tsx`: se ele NÃO for `forwardRef`, troque o `ref={snRef}` por um `id` + foco via `document.getElementById('sn')` no `limparPeca`/`autoFocus` (ajuste mínimo, sem inventar prop). Caso o `Input` já repasse `ref`, mantenha.

- [ ] **Step 3: Lint** — `npm run lint` → sem erros novos.

- [ ] **Step 4: Commit** (page + menu da Task 2 + form)

```bash
git add src/app/\(app\)/shopfloor/lancamento/ src/shared/ui/app-shell.tsx
git commit -F - << 'EOF'
feat(shopfloor): tela de Lançamento (operador) + item de menu

Cascata Cliente→PMO→OP, Posto filtrado pela OP, Nº de Série com foco automático,
campos dinâmicos por posto (status/defeitos/NQA/caixa), chama a action lancar.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 4: Verificação final + review amplo + smoke (controller)

**Files:** nenhum.

- [ ] **Step 1: Suíte** — `npx tsc --noEmit && npm run lint && npm run test` → verde (só o warning `<img>` pré-existente).

- [ ] **Step 2 (CONTROLLER): review amplo do branch** (subagent-driven-development → final review) — foco: a coerência da cascata + campos dinâmicos, a validação client espelhando o servidor, e o envio via `lancar`.

- [ ] **Step 3 (CONTROLLER): smoke no Dev** — `npm run dev`, logar (admin tem `lancar`), **Fluxo de Processos → Lançamento**:
  - escolher Cliente→PMO→OP; o Posto lista só os postos da OP;
  - Inicial: bipar um SN dentro da faixa → "Registrado", limpa e volta o foco;
  - Teste sem o posto anterior → erro de sequência; Reprovado com 2 defeitos → registra;
  - SN fora da faixa → botão travado; OP sem faixa → aviso;
  - Embalagem: Nº caixa + qtd → registra e mostra "peças na caixa X: N".

- [ ] **Step 4: NÃO push** — commits locais; o usuário valida.

---

## Notas de verificação (self-review)

- **Cobertura da spec (Lançamento):** cascata Cliente→PMO→OP (T3) ✅; Posto filtrado pela OP (T3) ✅; Nº de Série foco automático + Enter envia (T3) ✅; campos dinâmicos por posto incl. NQA e defeitos múltiplos e SPI (T3) ✅; validação client espelhando o servidor (T3) ✅; após enviar limpa + refoca + contagem de caixa (T3) ✅; item de menu por `lancar` (T2) ✅; sem migração (dados do C1) ✅.
- **Follow-ups do C1 tratados:** `qtdPorCaixa` numérico (T1) ✅; `posto` sempre string exata do catálogo (vem de `postosDaOp`) ✅.
- **Tipos:** `OrdemLancamentoLista` compartilhado repo↔page↔form; `EntradaLancamento` (C1) é o payload de `lancar`.
- **Domínio no cliente:** `serieDentroDaFaixa`/`postoTemStatus` são módulos puros (sem `server-only`) — import no client é seguro.
- **Sem placeholders:** page e form completos; o único ajuste condicional é o `ref` do Input (Step 2 da T3, com instrução exata).
- **Fora deste plano:** Grade Geral, Dashboard, Integração, Manutenção, Pesquisa, histórico; a limpeza do `gateSatisfeito` morto e a policy de insert direto (higiene, commit à parte).
