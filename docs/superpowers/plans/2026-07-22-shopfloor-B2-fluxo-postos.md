# ShopFloor — Plano B2: Fluxo de postos por OP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Transformar a aplicabilidade de postos (hoje um conjunto de toggles) em um **fluxo ordenado por OP**: cada OP define quais postos aplicam **e em que sequência**. Inclui 2 postos novos (Burn-in, Extra máquina), a coluna `ordem` em `sf_ordem_postos`, a revisão da tela de Cadastro (lista reordenável + "puxar fluxo de OP existente") e o ajuste do domínio de sequência.

**Architecture:** `sf_ordem_postos` ganha `ordem` (a sequência por OP; substitui a lista global fixa no código). O Cadastro monta uma lista reordenável (setas ↑/↓) e persiste a ordem como o índice na lista. O domínio de sequência passa a receber a lista ordenada da OP. Revisa o que o Plano B construiu (`ordem-repository`, `ordens-actions`, `ordem-form`).

**Tech Stack:** Supabase/RLS, Next.js 16 (Server Actions), React 19 (`useActionState` + estado controlado p/ o fluxo), TypeScript strict, Vitest.

## Global Constraints

- **Branch:** `feat/shopfloor-lancamento` (a mesma; continua nela).
- **Catálogo de postos (`sf_postos`) — 14, ordem de exibição padrão:** Inicial(1), Inspeção SPI(2), Inspeção SMD(3), Montagem PTH(4), Inspeção PTH(5), Teste(6), **Burn-in(7)**, Integração(8), Teste Final(9), Inspeção Final(10), Embalagem(11), Inspeção NQA(12), **Extra máquina(13)**, Manutenção(14). (A `ordem` aqui é só default de catálogo; a sequência real é por OP.)
- **`sf_ordem_postos.ordem`** = posição do posto na sequência daquela OP (0-based, contígua).
- **Sequência por OP:** o "posto anterior" na trava de sequência = o imediatamente antes na **ordem da OP**.
- **"Puxar fluxo" é opcional:** botão que copia postos+ordem de uma OP existente (mesmo PMO por padrão); não é obrigatório.
- Padrões: repositórios `import 'server-only'` + `createServerSupabase()`; actions com `getSessao()`+`podeFazer('administrar')`.
- TS strict `noUncheckedIndexedAccess`. Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit via heredoc. **Sem push.**
- Verificação: `npx tsc --noEmit && npm run lint && npm run test`.

## File Structure

- Create: `supabase/migrations/0030_fluxo_postos.sql`
- Modify: `src/modules/shopfloor/domain/postos.ts` + `__tests__/postos.test.ts`
- Modify: `src/modules/shopfloor/infra/ordem-repository.ts`
- Modify: `src/modules/shopfloor/application/ordens-actions.ts`
- Modify: `src/app/(app)/shopfloor/ordens/ordem-form.tsx`
- Modify: `src/app/(app)/shopfloor/ordens/page.tsx`

---

### Task 1: Migração 0030 — `ordem` + postos Burn-in/Extra máquina + backfill

**Files:**
- Create: `supabase/migrations/0030_fluxo_postos.sql`

- [ ] **Step 1: Escrever a migração**

`supabase/migrations/0030_fluxo_postos.sql`:

```sql
-- =============================================================
-- ShopFloor Processo — fluxo de postos por OP.
-- sf_ordem_postos ganha `ordem` (sequência por OP); + 2 postos novos.
-- =============================================================

-- 1) Coluna de ordem por OP.
alter table public.sf_ordem_postos add column ordem int not null default 0;

-- 2) Abrir espaço no catálogo e inserir Burn-in (após Teste) e Extra máquina (antes de Manutenção).
update public.sf_postos set ordem = 8  where chave = 'Integração';
update public.sf_postos set ordem = 9  where chave = 'Teste Final';
update public.sf_postos set ordem = 10 where chave = 'Inspeção Final';
update public.sf_postos set ordem = 11 where chave = 'Embalagem';
update public.sf_postos set ordem = 12 where chave = 'Inspeção NQA';
update public.sf_postos set ordem = 14 where chave = 'Manutenção';
insert into public.sf_postos (chave, ordem) values ('Burn-in', 7), ('Extra máquina', 13)
  on conflict (chave) do nothing;

-- 3) Backfill: dá a cada OP uma sequência inicial coerente com a ordem global do catálogo.
update public.sf_ordem_postos op
set ordem = p.ordem
from public.sf_postos p
where op.posto = p.chave;
```

- [ ] **Step 2: Sanidade** — `grep -c "add column ordem" supabase/migrations/0030_fluxo_postos.sql` → `1`. O controller aplica no Dev na Task 5.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0030_fluxo_postos.sql
git commit -F - << 'EOF'
feat(shopfloor): migração 0030 — ordem por OP + postos Burn-in/Extra máquina

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 2: Domínio — sequência pela ordem da OP (TDD)

**Files:**
- Modify: `src/modules/shopfloor/domain/postos.ts`
- Modify: `src/modules/shopfloor/domain/__tests__/postos.test.ts`

**Interfaces:**
- Produces: `postoAnteriorNaSequencia(postoAtual: string, postosOrdenados: string[]): string | null` — o posto imediatamente antes de `postoAtual` na lista ordenada da OP (ou null se for o primeiro / não estiver na lista). Substitui `postoAnteriorExigido`.
- Mantém: `gateSatisfeito` e `SnapshotPosto` (inalterados). Remove `postoAnteriorExigido` e `ORDEM_FLUXO_POSTOS` (a ordem agora é por OP; nada mais usa a global — Plano C1 ainda não foi construído).

- [ ] **Step 1: Atualizar os testes**

Em `src/modules/shopfloor/domain/__tests__/postos.test.ts`, SUBSTITUIR o bloco `describe('postoAnteriorExigido', ...)` inteiro por:

```ts
import { describe, it, expect } from 'vitest'
import { postoAnteriorNaSequencia, gateSatisfeito } from '../postos'

describe('postoAnteriorNaSequencia', () => {
  const fluxo = ['Inicial', 'Inspeção SMD', 'Teste', 'Embalagem']
  it('devolve o posto imediatamente anterior na ordem da OP', () => {
    expect(postoAnteriorNaSequencia('Teste', fluxo)).toBe('Inspeção SMD')
    expect(postoAnteriorNaSequencia('Embalagem', fluxo)).toBe('Teste')
  })
  it('primeiro da lista não tem anterior', () => {
    expect(postoAnteriorNaSequencia('Inicial', fluxo)).toBeNull()
  })
  it('posto fora da lista → null', () => {
    expect(postoAnteriorNaSequencia('Burn-in', fluxo)).toBeNull()
  })
})
```

(O bloco `describe('gateSatisfeito', ...)` existente permanece.)

- [ ] **Step 2: Rodar (FALHA)** — `npm run test -- shopfloor/domain/__tests__/postos` → FAIL (função inexistente).

- [ ] **Step 3: Atualizar `postos.ts`**

Em `src/modules/shopfloor/domain/postos.ts`, REMOVER `ORDEM_FLUXO_POSTOS` e `postoAnteriorExigido`, e adicionar (mantendo `SnapshotPosto` e `gateSatisfeito` como estão):

```ts
/** Posto imediatamente anterior a `postoAtual` na sequência ordenada da OP (ou null). */
export function postoAnteriorNaSequencia(postoAtual: string, postosOrdenados: string[]): string | null {
  const idx = postosOrdenados.findIndex((p) => p.toLowerCase() === postoAtual.toLowerCase())
  if (idx <= 0) return null
  return postosOrdenados[idx - 1] ?? null
}
```

- [ ] **Step 4: Rodar (PASSA)** — `npm run test -- shopfloor/domain/__tests__/postos` → PASS.

- [ ] **Step 5: Compila** — `npx tsc --noEmit` → sem erros (nada mais importa `postoAnteriorExigido`/`ORDEM_FLUXO_POSTOS`).

- [ ] **Step 6: Commit**

```bash
git add src/modules/shopfloor/domain/postos.ts src/modules/shopfloor/domain/__tests__/postos.test.ts
git commit -F - << 'EOF'
feat(shopfloor): sequência de postos pela ordem da OP (substitui a ordem global)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 3: Repositório + Actions — fluxo ordenado + "puxar fluxo"

**Files:**
- Modify: `src/modules/shopfloor/infra/ordem-repository.ts`
- Modify: `src/modules/shopfloor/application/ordens-actions.ts`

**Interfaces:**
- `OrdemRow.sf_ordem_postos` passa a ter `{ posto: string; ordem: number }[]`.
- `criarOrdem`/`atualizarOrdem`: o parâmetro `postos: string[]` é **ordenado** → grava `ordem = índice`.
- Novo: `listarFluxos(): Promise<{ pmo: string; op: string; postos: string[] }[]>` — todas as OPs com seus postos já ordenados (para o "puxar fluxo" na tela).
- Actions: `lerPostos` passa a ler um campo `fluxo` (JSON de chaves ordenadas) em vez dos toggles `posto_<chave>`.

- [ ] **Step 1: Repositório**

Em `src/modules/shopfloor/infra/ordem-repository.ts`:

(a) Na interface `OrdemRow`, trocar `sf_ordem_postos: { posto: string }[]` por:

```ts
  sf_ordem_postos: { posto: string; ordem: number }[]
```

(b) Em `listarOrdens`, trocar o select `...,sf_ordem_postos(posto)` por `...,sf_ordem_postos(posto,ordem)`.

(c) Trocar `criarOrdem` e `atualizarOrdem` para gravar a ordem (o array `postos` já vem ordenado):

```ts
export async function criarOrdem(dados: DadosOrdem, postos: string[]): Promise<string> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_ordens').insert(dados).select('id').single()
  if (error) throw error
  const id = (data as { id: string }).id
  if (postos.length > 0) {
    const { error: e2 } = await supabase
      .from('sf_ordem_postos')
      .insert(postos.map((posto, i) => ({ ordem_id: id, posto, ordem: i })))
    if (e2) throw e2
  }
  return id
}

export async function atualizarOrdem(id: string, dados: DadosOrdem, postos: string[]): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase
    .from('sf_ordens')
    .update({ ...dados, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
  const { error: eDel } = await supabase.from('sf_ordem_postos').delete().eq('ordem_id', id)
  if (eDel) throw eDel
  if (postos.length > 0) {
    const { error: eIns } = await supabase
      .from('sf_ordem_postos')
      .insert(postos.map((posto, i) => ({ ordem_id: id, posto, ordem: i })))
    if (eIns) throw eIns
  }
}
```

(d) Adicionar a função de fluxos (para o "puxar fluxo"):

```ts
export async function listarFluxos(): Promise<{ pmo: string; op: string; postos: string[] }[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('pmo,op,sf_ordem_postos(posto,ordem)')
    .order('pmo')
    .order('op')
  if (error) throw error
  const linhas = data as unknown as {
    pmo: string
    op: string
    sf_ordem_postos: { posto: string; ordem: number }[]
  }[]
  return linhas.map((l) => ({
    pmo: l.pmo,
    op: l.op,
    postos: [...l.sf_ordem_postos].sort((a, b) => a.ordem - b.ordem).map((p) => p.posto),
  }))
}
```

- [ ] **Step 2: Actions — `lerPostos` lê o fluxo ordenado**

Em `src/modules/shopfloor/application/ordens-actions.ts`, substituir a função `lerPostos` por (lê o campo `fluxo` = JSON de chaves ordenadas, valida contra o catálogo real preservando a ordem):

```ts
/** Fluxo ordenado enviado pelo form (campo `fluxo` = JSON de chaves), validado contra o catálogo. */
async function lerPostos(fd: FormData): Promise<string[]> {
  const catalogo = new Set((await listarPostos()).map((p) => p.chave))
  let bruto: unknown
  try {
    bruto = JSON.parse(String(fd.get('fluxo') ?? '[]'))
  } catch {
    return []
  }
  if (!Array.isArray(bruto)) return []
  const vistos = new Set<string>()
  const fluxo: string[] = []
  for (const item of bruto) {
    const chave = String(item)
    if (catalogo.has(chave) && !vistos.has(chave)) {
      vistos.add(chave)
      fluxo.push(chave)
    }
  }
  return fluxo
}
```

- [ ] **Step 3: Compila** — `npx tsc --noEmit` → sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/modules/shopfloor/infra/ordem-repository.ts src/modules/shopfloor/application/ordens-actions.ts
git commit -F - << 'EOF'
feat(shopfloor): fluxo de postos ordenado no repo/actions + listarFluxos

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 4: Cadastro de OP — lista reordenável + "puxar fluxo"

**Files:**
- Modify: `src/app/(app)/shopfloor/ordens/ordem-form.tsx`
- Modify: `src/app/(app)/shopfloor/ordens/page.tsx`

**Interfaces:**
- Consumes: `listarFluxos` (Task 3).
- `OrdemForm` passa a receber `fluxosExistentes: { pmo: string; op: string; postos: string[] }[]` e `ordem?.postos` já ordenado. Substitui os toggles por uma lista ordenável + botão "Puxar fluxo".

- [ ] **Step 1: `page.tsx` — carregar e passar os fluxos**

Em `src/app/(app)/shopfloor/ordens/page.tsx`:

(a) Importar e carregar `listarFluxos`:

```tsx
import { listarOrdens, listarPostos, listarFluxos } from '@/modules/shopfloor/infra/ordem-repository'
```
E trocar o `Promise.all` por:
```tsx
  const [ordens, postos, fluxos] = await Promise.all([listarOrdens(), listarPostos(), listarFluxos()])
```

(b) Montar `views` com os postos **ordenados**:
```tsx
    postos: [...o.sf_ordem_postos].sort((a, b) => a.ordem - b.ordem).map((x) => x.posto),
```

(c) Passar `fluxosExistentes={fluxos}` nas DUAS usagens de `<OrdemForm .../>` (a de "Nova OP" e a de editar). Ex.:
```tsx
        <OrdemForm postos={chavesPostos} fluxosExistentes={fluxos} />
```
```tsx
                    <OrdemForm postos={chavesPostos} ordem={o} fluxosExistentes={fluxos} />
```

- [ ] **Step 2: `ordem-form.tsx` — lista reordenável + puxar fluxo**

Substituir o bloco de "Postos aplicáveis" (a `<div>` com o `.map` de `<Switch>`) e ajustar o componente para estado controlado do fluxo. Arquivo completo `src/app/(app)/shopfloor/ordens/ordem-form.tsx`:

```tsx
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
}

export interface FluxoExistente {
  pmo: string
  op: string
  postos: string[]
}

export function OrdemForm({
  postos,
  ordem,
  fluxosExistentes,
}: {
  postos: string[]
  ordem?: OrdemView
  fluxosExistentes: FluxoExistente[]
}) {
  const ehEdicao = ordem !== undefined
  const action = ehEdicao ? editarOrdemAction : criarOrdemAction
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<ResultadoOrdem | undefined, FormData>(action, undefined)

  const [pmo, setPmo] = useState(ordem?.pmo ?? '')
  const [fluxo, setFluxo] = useState<string[]>(ordem?.postos ?? [])

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
                  if (fonte) setFluxo(fonte.postos)
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
                <Select value="" onValueChange={adicionar}>
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
```

- [ ] **Step 3: Compila** — `npx tsc --noEmit` → sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/shopfloor/ordens/ordem-form.tsx src/app/\(app\)/shopfloor/ordens/page.tsx
git commit -F - << 'EOF'
feat(shopfloor): Cadastro de OP com fluxo de postos reordenável + puxar fluxo

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 5: Verificação final + review amplo + aplicação no Dev (controller)

**Files:** nenhum.

- [ ] **Step 1: Suíte** — `npx tsc --noEmit && npm run lint && npm run test` → verde (só o warning `<img>` pré-existente).

- [ ] **Step 2 (CONTROLLER): review amplo do branch** (subagent-driven-development → final review) — foco: a migração 0030 (ordem/backfill), a sequência-por-OP, a UI reordenável, e a coerência com o Cadastro do Plano B.

- [ ] **Step 3 (CONTROLLER): aplicar 0030 no Dev + smoke** — `supabase db push` (com `SUPABASE_GO_BINARY`); depois `npm run dev`: abrir uma OP migrada (o fluxo deve vir preenchido/ordenado pelo backfill), reordenar postos e salvar; criar OP nova puxando o fluxo de outra OP do mesmo PMO; conferir que Burn-in e Extra máquina aparecem no "+ Adicionar posto".

- [ ] **Step 4: NÃO push** — commits locais; o usuário valida.

---

## Notas de verificação (self-review)

- **Cobertura:** `ordem` por OP na migração + backfill (T1) ✅; 2 postos novos no catálogo (T1) ✅; sequência pela ordem da OP no domínio (T2, TDD) ✅; repo/actions gravando/lendo o fluxo ordenado (T3) ✅; tela reordenável + puxar fluxo (T4) ✅.
- **Coerência com o Plano B:** o `ordem-form` agora manda `fluxo` (JSON ordenado) no lugar dos toggles `posto_<chave>`; o `lerPostos` da action foi trocado junto (T3) — não sobra referência aos toggles antigos.
- **Tipos:** `OrdemView.postos`/`FluxoExistente.postos` são `string[]` ordenados; `OrdemRow.sf_ordem_postos` inclui `ordem`.
- **Sem placeholders:** migração e componentes completos.
- **Fora deste plano:** o Plano C1 (que usa `postoAnteriorNaSequencia` + a lista ordenada da OP na trava de sequência) será ajustado a seguir; a classificação com/sem status de Burn-in/Extra máquina entra no domínio do C1 (`lancamento-linhas`).
- **Provisório:** flow-builder visual estilo n8n = backlog; template nomeado por PMO (hoje o "modelo" = copiar de uma OP existente do mesmo PMO).
