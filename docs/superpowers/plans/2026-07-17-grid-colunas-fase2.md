# Grid Fase 2 — Colunas da Lista (admin) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao admin uma tela para escolher quais colunas aparecem no grid de Processos e em que ordem.

**Architecture:** O cliente envia **apenas a lista ordenada dos campos visíveis**; o servidor carrega o catálogo (whitelist) e uma função pura de domínio **deriva** o layout completo (visíveis 1..N, ocultas depois), forçando `numero`/`status` visíveis. Grava por upsert em `colunas_lista` (tabela que já existe) e revalida o grid. UI com duas listas e setas ↑↓ — sem biblioteca nova.

**Tech Stack:** Next.js 16 (Server Components/Actions), TypeScript strict (`noUncheckedIndexedAccess`), Supabase (RLS), Tailwind + base-ui, sonner, vitest.

## Global Constraints

- **AGENTS.md:** "This is NOT the Next.js you know — read `node_modules/next/dist/docs` before writing Next code." Next 16.
- **SEM MIGRAÇÃO.** `colunas_lista(campo text pk, visivel boolean, ordem int)` já existe (0021), com RLS: select = todo autenticado; **escrita = `tem_permissao('administrar')`**. PK em `campo` → **upsert** cobre campos sem linha.
- **`numero` e `status` são SEMPRE visíveis** (não podem ser ocultados) **mas podem ser reordenados**.
- **Whitelist:** campo vindo do cliente só vale se estiver no **catálogo carregado no servidor** (`carregarCatalogoColunas()` — colunas de sistema + campos ativos).
- **Contrato cliente→servidor:** a action recebe **só** `visiveis: string[]` (ordenado). Nada de `visivel` vindo do cliente.
- **`/configuracoes/*` já é guardado** por `administrar` no `configuracoes/layout.tsx`; a action **revalida** mesmo assim.
- **Auditoria:** `registrarLog({ entidade: 'colunas_lista', acao: 'alterar_campo', ... })` (padrão das outras telas de config; `acao` tem lista fixa no banco e `alterar_campo` é o encaixe).
- **Sem biblioteca nova** (reordenar é com setas ↑↓).
- TS strict `noUncheckedIndexedAccess`. Trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Subagentes NÃO dão `git push`.**
- **Verificação:** `npx tsc --noEmit` + `npm run lint` + `npm run build`; `npm run test`.

## File Structure

- **Create** `src/modules/recebimento/domain/layout-colunas.ts` — `ColunaLayout`, `COLUNAS_FIXAS`, `normalizarLayout` (puro).
- **Create** `src/modules/recebimento/domain/__tests__/layout-colunas.test.ts` — TDD.
- **Modify** `src/modules/recebimento/infra/processo-repository.ts` — `salvarColunasLista`.
- **Create** `src/modules/recebimento/application/colunas-lista-actions.ts` — Server Action.
- **Create** `src/app/(app)/configuracoes/colunas/page.tsx` — server: monta as duas listas.
- **Create** `src/app/(app)/configuracoes/colunas/colunas-form.tsx` — client: setas, ocultar/mostrar, salvar.
- **Modify** `src/shared/ui/app-shell.tsx` — item "Colunas da Lista" no accordion Recebimento.

---

### Task 1: Domínio — normalizarLayout (TDD)

**Files:**
- Create: `src/modules/recebimento/domain/layout-colunas.ts`
- Create: `src/modules/recebimento/domain/__tests__/layout-colunas.test.ts`

**Interfaces:**
- Produces:
  - `interface ColunaLayout { campo: string; visivel: boolean; ordem: number }`
  - `const COLUNAS_FIXAS: readonly string[]` (`['numero','status']`)
  - `normalizarLayout(visiveis: string[], catalogo: string[]): ColunaLayout[]`

- [ ] **Step 1: Escrever os testes (que falham)**

Criar `src/modules/recebimento/domain/__tests__/layout-colunas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { COLUNAS_FIXAS, normalizarLayout } from '../layout-colunas'

const CATALOGO = ['numero', 'status', 'fornecedor', 'tipo', 'atraso']

const visiveisDe = (r: { campo: string; visivel: boolean }[]) =>
  r.filter((c) => c.visivel).map((c) => c.campo)
const ocultasDe = (r: { campo: string; visivel: boolean }[]) =>
  r.filter((c) => !c.visivel).map((c) => c.campo)

describe('COLUNAS_FIXAS', () => {
  it('são numero e status', () => {
    expect([...COLUNAS_FIXAS]).toEqual(['numero', 'status'])
  })
})

describe('normalizarLayout', () => {
  it('numera as visíveis 1..N na ordem dada e as ocultas depois', () => {
    expect(normalizarLayout(['numero', 'fornecedor', 'status'], CATALOGO)).toEqual([
      { campo: 'numero', visivel: true, ordem: 1 },
      { campo: 'fornecedor', visivel: true, ordem: 2 },
      { campo: 'status', visivel: true, ordem: 3 },
      { campo: 'tipo', visivel: false, ordem: 4 },
      { campo: 'atraso', visivel: false, ordem: 5 },
    ])
  })

  it('descarta campo fora do catálogo', () => {
    const r = normalizarLayout(['numero', 'hacker', 'status'], CATALOGO)
    expect(visiveisDe(r)).toEqual(['numero', 'status'])
    expect(r.some((c) => c.campo === 'hacker')).toBe(false)
  })

  it('descarta duplicatas', () => {
    const r = normalizarLayout(['numero', 'numero', 'status'], CATALOGO)
    expect(visiveisDe(r)).toEqual(['numero', 'status'])
  })

  it('força as fixas visíveis quando omitidas (entram no fim)', () => {
    const r = normalizarLayout(['fornecedor'], CATALOGO)
    expect(visiveisDe(r)).toEqual(['fornecedor', 'numero', 'status'])
  })

  it('lista vazia → só as fixas visíveis', () => {
    const r = normalizarLayout([], CATALOGO)
    expect(visiveisDe(r)).toEqual(['numero', 'status'])
    expect(ocultasDe(r)).toEqual(['fornecedor', 'tipo', 'atraso'])
  })

  it('ocultas seguem a ordem do catálogo', () => {
    const r = normalizarLayout(['numero', 'status'], CATALOGO)
    expect(ocultasDe(r)).toEqual(['fornecedor', 'tipo', 'atraso'])
  })

  it('cobre o catálogo inteiro, sem duplicar', () => {
    const r = normalizarLayout(['tipo', 'numero'], CATALOGO)
    expect(r).toHaveLength(CATALOGO.length)
    expect(new Set(r.map((c) => c.campo)).size).toBe(CATALOGO.length)
  })

  it('não muta as entradas', () => {
    const vis = ['numero', 'fornecedor']
    const cat = [...CATALOGO]
    normalizarLayout(vis, cat)
    expect(vis).toEqual(['numero', 'fornecedor'])
    expect(cat).toEqual(CATALOGO)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- layout-colunas`
Expected: FAIL (módulo `../layout-colunas` não existe).

- [ ] **Step 3: Implementar**

Criar `src/modules/recebimento/domain/layout-colunas.ts`:

```ts
/** Uma coluna do layout da lista de Processos, como fica no banco. */
export interface ColunaLayout {
  campo: string
  visivel: boolean
  ordem: number
}

/** Colunas que o admin NÃO pode ocultar (mas pode reordenar). */
export const COLUNAS_FIXAS: readonly string[] = ['numero', 'status']

/**
 * Deriva o layout completo a partir da lista ordenada de campos visíveis vinda do
 * cliente. O `catalogo` é a whitelist (carregada no servidor):
 * - campo fora do catálogo, ou repetido, é descartado;
 * - `COLUNAS_FIXAS` são forçadas visíveis (se vierem ausentes, entram no fim);
 * - visíveis recebem ordem 1..N na ordem dada; as ocultas (catálogo − visíveis) vêm
 *   depois, na ordem do catálogo.
 * Não muta as entradas.
 */
export function normalizarLayout(visiveis: string[], catalogo: string[]): ColunaLayout[] {
  const noCatalogo = new Set(catalogo)
  const escolhidas: string[] = []
  const jaVisivel = new Set<string>()

  for (const campo of visiveis) {
    if (!noCatalogo.has(campo) || jaVisivel.has(campo)) continue
    jaVisivel.add(campo)
    escolhidas.push(campo)
  }

  // A UI não deixa ocultar as fixas, mas o cliente não é confiável.
  for (const fixa of COLUNAS_FIXAS) {
    if (!noCatalogo.has(fixa) || jaVisivel.has(fixa)) continue
    jaVisivel.add(fixa)
    escolhidas.push(fixa)
  }

  const layout: ColunaLayout[] = escolhidas.map((campo, i) => ({
    campo,
    visivel: true,
    ordem: i + 1,
  }))

  let ordem = escolhidas.length
  for (const campo of catalogo) {
    if (jaVisivel.has(campo)) continue
    ordem += 1
    layout.push({ campo, visivel: false, ordem })
  }

  return layout
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- layout-colunas`
Expected: PASS (9 casos).

- [ ] **Step 5: Verificar tipos e commit**

Run: `npx tsc --noEmit`
Expected: sem erros.

```bash
git add src/modules/recebimento/domain/layout-colunas.ts src/modules/recebimento/domain/__tests__/layout-colunas.test.ts
git commit -m "feat(grid): domínio normalizarLayout das colunas da lista (TDD)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Servidor — repositório + Server Action

**Files:**
- Modify: `src/modules/recebimento/infra/processo-repository.ts`
- Create: `src/modules/recebimento/application/colunas-lista-actions.ts`

**Interfaces:**
- Consumes: `ColunaLayout`, `normalizarLayout` (Task 1); `carregarCatalogoColunas` e `createServerSupabase` (já existem no repositório); `getSessao`, `podeFazer`, `registrarLog`.
- Produces:
  - `salvarColunasLista(layout: ColunaLayout[]): Promise<void>` (infra)
  - `type ResultadoLayout = { ok: true } | { ok: false; erro: string }`
  - `salvarLayoutColunas(visiveis: string[]): Promise<ResultadoLayout>` (action)

- [ ] **Step 1: Repositório — upsert do layout**

Em `src/modules/recebimento/infra/processo-repository.ts`, adicionar o import do tipo do domínio no topo (junto dos outros imports):

```ts
import type { ColunaLayout } from '../domain/layout-colunas'
```

E acrescentar a função logo **depois** de `listarColunasLista`:

```ts
/** Grava o layout inteiro da lista (upsert por `campo`). A RLS exige `administrar`. */
export async function salvarColunasLista(layout: ColunaLayout[]): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase
    .from('colunas_lista')
    .upsert(
      layout.map((c) => ({ campo: c.campo, visivel: c.visivel, ordem: c.ordem })),
      { onConflict: 'campo' },
    )
  if (error) throw error
}
```

- [ ] **Step 2: Server Action**

Criar `src/modules/recebimento/application/colunas-lista-actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { normalizarLayout } from '../domain/layout-colunas'
import { carregarCatalogoColunas, salvarColunasLista } from '../infra/processo-repository'

export type ResultadoLayout = { ok: true } | { ok: false; erro: string }

/**
 * Salva o layout das colunas do grid de Processos. Gate `administrar`. O catálogo é
 * carregado no SERVIDOR e é a whitelist: o cliente só diz **quais** campos quer visíveis
 * e **em que ordem** — o resto (ocultas, numeração, travas) o domínio deriva.
 */
export async function salvarLayoutColunas(visiveis: string[]): Promise<ResultadoLayout> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return { ok: false, erro: 'Você não tem permissão para alterar as colunas da lista.' }
  }

  try {
    const catalogo = await carregarCatalogoColunas()
    const layout = normalizarLayout(
      visiveis,
      catalogo.map((c) => c.campo),
    )
    await salvarColunasLista(layout)

    await registrarLog({
      entidade: 'colunas_lista',
      acao: 'alterar_campo',
      descricao: 'Colunas da lista de Processos alteradas',
      dados: { visiveis: layout.filter((c) => c.visivel).map((c) => c.campo) },
    })

    revalidatePath('/recebimento/processos')
    revalidatePath('/configuracoes/colunas')
    return { ok: true }
  } catch {
    return { ok: false, erro: 'Não foi possível salvar o layout.' }
  }
}
```

- [ ] **Step 3: Verificar e commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros (o único warning aceitável é o pré-existente de `<img>` em `anexos-processo.tsx`).

```bash
git add src/modules/recebimento/infra/processo-repository.ts src/modules/recebimento/application/colunas-lista-actions.ts
git commit -m "feat(grid): repositório e Server Action do layout de colunas (gate administrar)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: UI — tela Colunas da Lista + item de menu

**Files:**
- Create: `src/app/(app)/configuracoes/colunas/page.tsx`
- Create: `src/app/(app)/configuracoes/colunas/colunas-form.tsx`
- Modify: `src/shared/ui/app-shell.tsx`

**Interfaces:**
- Consumes: `carregarCatalogoColunas`, `listarColunasLista` (infra, já existem); `COLUNAS_FIXAS` (Task 1); `salvarLayoutColunas` (Task 2).
- Produces: `interface ColunaItem { campo: string; rotulo: string }` e o componente `ColunasForm`.

- [ ] **Step 1: Página (server)**

Criar `src/app/(app)/configuracoes/colunas/page.tsx`:

```tsx
import {
  carregarCatalogoColunas,
  listarColunasLista,
} from '@/modules/recebimento/infra/processo-repository'
import { ColunasForm } from './colunas-form'

export default async function ColunasPage() {
  const [catalogo, layout] = await Promise.all([carregarCatalogoColunas(), listarColunasLista()])

  const porCampo = new Map(catalogo.map((c) => [c.campo, c]))

  // Visíveis na ordem salva, restritas ao catálogo (linha órfã de campo desativado some).
  const visiveis = layout
    .filter((c) => c.visivel)
    .map((c) => porCampo.get(c.campo))
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
    .map((c) => ({ campo: c.campo, rotulo: c.rotulo }))

  // Disponíveis = catálogo − visíveis (inclui campo novo que ainda não tem linha), A→Z.
  const jaVisivel = new Set(visiveis.map((c) => c.campo))
  const disponiveis = catalogo
    .filter((c) => !jaVisivel.has(c.campo))
    .map((c) => ({ campo: c.campo, rotulo: c.rotulo }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'))

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Colunas da Lista</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Escolha quais colunas aparecem na lista de Processos e em que ordem. Vale para todos os
          usuários.
        </p>
      </div>
      <ColunasForm visiveisIniciais={visiveis} disponiveisIniciais={disponiveis} />
    </div>
  )
}
```

- [ ] **Step 2: Formulário (client)**

Criar `src/app/(app)/configuracoes/colunas/colunas-form.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { ChevronDownIcon, ChevronUpIcon, LockIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { salvarLayoutColunas } from '@/modules/recebimento/application/colunas-lista-actions'
import { COLUNAS_FIXAS } from '@/modules/recebimento/domain/layout-colunas'

export interface ColunaItem {
  campo: string
  rotulo: string
}

/**
 * Duas listas: "Visíveis" (na ordem do grid, com setas ↑↓) e "Disponíveis" (ocultas).
 * Edita em memória; o botão "Salvar alterações" manda ao servidor só a lista ordenada
 * dos campos visíveis — o servidor deriva o resto.
 */
export function ColunasForm({
  visiveisIniciais,
  disponiveisIniciais,
}: {
  visiveisIniciais: ColunaItem[]
  disponiveisIniciais: ColunaItem[]
}) {
  const [visiveis, setVisiveis] = useState<ColunaItem[]>(visiveisIniciais)
  const [disponiveis, setDisponiveis] = useState<ColunaItem[]>(disponiveisIniciais)
  const [sujo, setSujo] = useState(false)
  const [salvando, startSalvar] = useTransition()

  function mover(i: number, delta: number) {
    const j = i + delta
    if (j < 0 || j >= visiveis.length) return
    setVisiveis((atual) => {
      const copia = [...atual]
      const a = copia[i]
      const b = copia[j]
      if (!a || !b) return atual
      copia[i] = b
      copia[j] = a
      return copia
    })
    setSujo(true)
  }

  function ocultar(campo: string) {
    if (COLUNAS_FIXAS.includes(campo)) return
    const col = visiveis.find((c) => c.campo === campo)
    if (!col) return
    setVisiveis((atual) => atual.filter((c) => c.campo !== campo))
    setDisponiveis((atual) =>
      [...atual, col].sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR')),
    )
    setSujo(true)
  }

  function mostrar(campo: string) {
    const col = disponiveis.find((c) => c.campo === campo)
    if (!col) return
    setDisponiveis((atual) => atual.filter((c) => c.campo !== campo))
    setVisiveis((atual) => [...atual, col])
    setSujo(true)
  }

  function salvar() {
    startSalvar(async () => {
      const r = await salvarLayoutColunas(visiveis.map((c) => c.campo))
      if (r.ok) {
        setSujo(false)
        toast.success('Colunas salvas. A lista de Processos já reflete a mudança.')
      } else {
        toast.error(r.erro)
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide">Visíveis</h2>
              <p className="text-xs text-muted-foreground">Na ordem em que aparecem na lista</p>
            </div>
            <span className="text-sm text-muted-foreground">{visiveis.length}</span>
          </div>
          <ul className="max-h-[28rem] overflow-y-auto">
            {visiveis.map((col, i) => {
              const fixa = COLUNAS_FIXAS.includes(col.campo)
              return (
                <li
                  key={col.campo}
                  className="flex items-center gap-2 border-b border-border px-2 py-2 last:border-b-0"
                >
                  <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">
                    {i + 1}
                  </span>
                  <div className="flex shrink-0 gap-0.5">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Mover ${col.rotulo} para cima`}
                      disabled={i === 0}
                      onClick={() => mover(i, -1)}
                    >
                      <ChevronUpIcon />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Mover ${col.rotulo} para baixo`}
                      disabled={i === visiveis.length - 1}
                      onClick={() => mover(i, 1)}
                    >
                      <ChevronDownIcon />
                    </Button>
                  </div>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate">{col.rotulo}</span>
                    {fixa && (
                      <Badge variant="secondary" className="shrink-0 font-normal">
                        sempre visível
                      </Badge>
                    )}
                  </span>
                  {fixa ? (
                    <LockIcon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-label={`${col.rotulo} não pode ser ocultada`}
                    />
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => ocultar(col.campo)}>
                      Ocultar
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide">Disponíveis</h2>
              <p className="text-xs text-muted-foreground">Ocultas — clique em Mostrar para usar</p>
            </div>
            <span className="text-sm text-muted-foreground">{disponiveis.length}</span>
          </div>
          <ul className="max-h-[28rem] overflow-y-auto">
            {disponiveis.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                Todas as colunas estão na lista.
              </li>
            )}
            {disponiveis.map((col) => (
              <li
                key={col.campo}
                className="flex items-center gap-2 border-b border-border px-4 py-2 last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate">{col.rotulo}</span>
                <Button variant="ghost" size="sm" onClick={() => mostrar(col.campo)}>
                  Mostrar
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <span className="text-sm text-muted-foreground">
          {sujo ? 'Alterações não salvas' : 'Tudo salvo'}
        </span>
        <Button
          className="bg-enterplak hover:bg-enterplak-700"
          disabled={!sujo || salvando}
          onClick={salvar}
        >
          {salvando ? 'Salvando…' : 'Salvar alterações'}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Item no menu**

Em `src/shared/ui/app-shell.tsx`:

1. Acrescentar `Columns3` à lista de ícones importados de `lucide-react` (o import já existe; só adicione o nome, mantendo os demais):

```tsx
  SlidersHorizontal,
  Columns3,
```

2. Em `CONFIG_RECEBIMENTO`, inserir o item **depois** de `campos`:

```tsx
  { chave: 'colunas', rotulo: 'Colunas da Lista', href: '/configuracoes/colunas', icone: Columns3, perm: 'administrar' },
```

- [ ] **Step 4: Verificar e commit**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sem erros; a rota `/configuracoes/colunas` aparece no output do build. (Se o build der `JavaScript heap out of memory` nesta máquina, rode `NODE_OPTIONS="--max-old-space-size=4096" npm run build` — é RAM do ambiente, não código.)

```bash
git add "src/app/(app)/configuracoes/colunas/page.tsx" "src/app/(app)/configuracoes/colunas/colunas-form.tsx" src/shared/ui/app-shell.tsx
git commit -m "feat(grid): tela Colunas da Lista (admin) + item no menu

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Verificação final

**Files:** nenhum (só verificação).

- [ ] **Step 1: Suite completo**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm run test`
Expected: tudo verde; os testes de `layout-colunas` (9 casos) entre eles. O único warning aceitável é o pré-existente de `<img>` em `anexos-processo.tsx`.

- [ ] **Step 2: Smoke (anotar; NÃO fazer push)**

Com `npm run dev`, logado como admin, em **Configurações → Colunas da Lista**:
1. **Ocultar** uma coluna (ex.: "Tipo") → **Salvar alterações** → abrir `/recebimento/processos` → a coluna sumiu do grid.
2. **Mostrar** uma coluna (ex.: "Volumes") → ela entra no **fim** das visíveis → subir com as **setas** → **Salvar** → o grid reflete a nova ordem.
3. Conferir que em **Número** e **Status** aparece a etiqueta "sempre visível" + **cadeado** (sem botão Ocultar), **mas as setas funcionam** (dá para movê-los).
4. Conferir o indicador: muda para **"Alterações não salvas"** ao mexer, e o botão **só acende** quando há mudança; volta a "Tudo salvo" após salvar.
5. Conferir que um perfil **sem `administrar`** não vê o item no menu e é redirecionado ao acessar `/configuracoes/colunas`.

- [ ] **Step 3: NÃO fazer push**

Commits ficam locais; o usuário valida o smoke e decide.

---

## Notas de verificação (self-review do plano)

**Cobertura da spec:**
- Tela em Configurações → Recebimento → "Colunas da Lista" → Task 3 (página + item de menu). ✅
- Duas listas; setas ↑↓; "Ocultar"/"Mostrar" (entra no fim) → Task 3 (form). ✅
- `numero`/`status` sempre visíveis mas reordenáveis → Task 1 (`COLUNAS_FIXAS` + força no domínio) e Task 3 (cadeado + setas ativas). ✅
- Salvar em bloco + indicador de não salvo → Task 3 (`sujo`, botão desabilitado). ✅
- Campos novos aparecem em "Disponíveis" → Task 3 (página monta disponíveis = catálogo − visíveis). ✅
- Sem migração; upsert → Task 2 (`salvarColunasLista`). ✅
- Segurança em 3 camadas (RLS; action revalida; whitelist do catálogo no servidor) → Task 2. ✅
- Auditoria → Task 2 (`registrarLog`). ✅
- `revalidatePath('/recebimento/processos')` → Task 2. ✅

**Consistência de tipos:** `ColunaLayout`/`COLUNAS_FIXAS`/`normalizarLayout` (Task 1) consumidos em 2 e 3; `salvarColunasLista(layout: ColunaLayout[])` (Task 2) usado pela action (Task 2); `salvarLayoutColunas(visiveis: string[]): ResultadoLayout` (Task 2) chamado no form (Task 3); `ColunaItem {campo, rotulo}` (Task 3) alimentado pela página com `{campo, rotulo}` do `ColunaGrid`. ✅

**Sem placeholders:** todo passo de código traz o código completo. ✅
