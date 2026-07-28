# Padrões de Fluxo no Cadastro de OP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Substituir o "puxar fluxo de OP crua" por **Padrões de Fluxo** — moldes nomeados por PMO (nome+descrição, postos+receita), criados/geridos inline no Cadastro de OP.

**Architecture:** Tabela nova `sf_padroes_fluxo` (jsonb pros postos/receita) + RLS `shopfloor.administrar`. Domínio puro pra validação; infra (listar/upsert/excluir); Server Actions (guard + revalidate). UI no `ordem-form.tsx`: dropdown de padrões do PMO + salvar/apagar inline. A page carrega TODOS os padrões e o form filtra por PMO client-side (espelha o `fontes` de hoje).

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TS strict, Supabase Postgres, Vitest.

## Global Constraints

- PT-BR em UI, mensagens e comentários.
- Domínio puro (sem I/O) pra validação; actions guardam `shopfloor.administrar` e `revalidatePath('/shopfloor/ordens')`.
- `postos`/`componentes` do padrão = `string[]` (mapeiam direto pro `fluxo`/`receita` do form).
- Escolher um padrão **substitui** o fluxo atual; salvar com nome existente **sobrescreve** (com confirmação); apagar **com confirmação**.
- Trailer de commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Spec: `docs/superpowers/specs/2026-07-28-padroes-fluxo-design.md`.

## File Structure

- Create: `supabase/migrations/0059_sf_padroes_fluxo.sql`
- Create: `src/modules/shopfloor/domain/validar-padrao.ts` + `__tests__/validar-padrao.test.ts`
- Create: `src/modules/shopfloor/infra/padroes-fluxo-repository.ts`
- Create: `src/modules/shopfloor/application/padroes-fluxo-actions.ts`
- Modify: `src/app/(app)/shopfloor/ordens/ordem-form.tsx` (troca puxar-de-OP → puxar-de-padrão + salvar/apagar)
- Modify: `src/app/(app)/shopfloor/ordens/page.tsx` e `ordens-lista.tsx` (passam `padroesExistentes`)
- Modify: `src/modules/shopfloor/infra/ordem-repository.ts` (remover `listarFluxos`, agora sem uso)

---

### Task 1: Migração 0059 — tabela `sf_padroes_fluxo`

**Files:** Create `supabase/migrations/0059_sf_padroes_fluxo.sql`

- [ ] **Step 1: Criar a migração** (confirmar antes que 0059 é o próximo nº livre — dir termina em 0058):

```sql
-- Padrões de Fluxo: moldes nomeados por PMO (postos + receita) para o Cadastro de OP.
create table public.sf_padroes_fluxo (
  id uuid primary key default gen_random_uuid(),
  pmo text not null,
  nome text not null,
  descricao text not null default '',
  postos jsonb not null default '[]'::jsonb,        -- array ORDENADO de nomes de posto
  componentes jsonb not null default '[]'::jsonb,   -- array de PMOs de placa (receita)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pmo, nome)
);
alter table public.sf_padroes_fluxo enable row level security;
create policy sf_padroes_fluxo_admin on public.sf_padroes_fluxo
  for all
  using (tem_permissao('shopfloor', 'administrar'))
  with check (tem_permissao('shopfloor', 'administrar'));
```

- [ ] **Step 2: Commit** (aplicação no Dev é coordenada pelo controller/humano depois)

```bash
git add supabase/migrations/0059_sf_padroes_fluxo.sql
git commit -m "$(cat <<'EOF'
feat(shopfloor): tabela sf_padroes_fluxo (padrões de fluxo por PMO) + RLS admin

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Domínio — `validarPadraoFluxo` (TDD)

**Files:** Create `src/modules/shopfloor/domain/validar-padrao.ts` + `__tests__/validar-padrao.test.ts`

**Interfaces:** Produces `validarPadraoFluxo(nome: string, postos: string[]): { ok: true } | { ok: false; erro: string }` — usado pela action (Task 3).

- [ ] **Step 1: Testes falhando** — `__tests__/validar-padrao.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { validarPadraoFluxo } from '../validar-padrao'

describe('validarPadraoFluxo', () => {
  it('exige nome', () => {
    expect(validarPadraoFluxo('', ['Teste']).ok).toBe(false)
    expect(validarPadraoFluxo('   ', ['Teste']).ok).toBe(false)
  })
  it('exige ao menos um posto', () => {
    expect(validarPadraoFluxo('Padrão X', []).ok).toBe(false)
  })
  it('aceita nome + postos', () => {
    expect(validarPadraoFluxo('Padrão X', ['Inicial', 'Teste']).ok).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/modules/shopfloor/domain/__tests__/validar-padrao.test.ts` → FAIL.

- [ ] **Step 3: Implementar** — `src/modules/shopfloor/domain/validar-padrao.ts`:
```ts
/** Validação pra salvar um Padrão de Fluxo. */
export function validarPadraoFluxo(
  nome: string,
  postos: string[],
): { ok: true } | { ok: false; erro: string } {
  if (nome.trim() === '') return { ok: false, erro: 'Informe o nome do padrão.' }
  if (postos.length === 0) {
    return { ok: false, erro: 'Adicione ao menos um posto ao fluxo antes de salvar como padrão.' }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Rodar e ver passar** — mesmo comando → PASS. Depois `npm run test` (suíte inteira) antes de commitar.

- [ ] **Step 5: Commit**
```bash
git add src/modules/shopfloor/domain/validar-padrao.ts src/modules/shopfloor/domain/__tests__/validar-padrao.test.ts
git commit -m "$(cat <<'EOF'
feat(shopfloor): validarPadraoFluxo (nome + ao menos um posto)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Infra + Actions

**Files:** Create `src/modules/shopfloor/infra/padroes-fluxo-repository.ts` + `src/modules/shopfloor/application/padroes-fluxo-actions.ts`

**Interfaces:**
- Consumes: `validarPadraoFluxo` (Task 2), `createServerSupabase`, `getSessao`, `podeNoModulo`.
- Produces: `PadraoFluxoRow`, `listarPadroes()`, `salvarPadraoAction(...)`, `excluirPadraoAction(id)` — usados pela UI (Task 4).

- [ ] **Step 1: Repositório** — `src/modules/shopfloor/infra/padroes-fluxo-repository.ts`:
```ts
import { createServerSupabase } from '@/shared/lib/supabase/server'

export interface PadraoFluxoRow {
  id: string
  pmo: string
  nome: string
  descricao: string
  postos: string[]
  componentes: string[]
}

export async function listarPadroes(): Promise<PadraoFluxoRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_padroes_fluxo')
    .select('id,pmo,nome,descricao,postos,componentes')
    .order('pmo')
    .order('nome')
  if (error) throw error
  return (data ?? []).map((r) => {
    const row = r as { id: string; pmo: string; nome: string; descricao: string; postos: unknown; componentes: unknown }
    return {
      id: row.id,
      pmo: row.pmo,
      nome: row.nome,
      descricao: row.descricao,
      postos: Array.isArray(row.postos) ? (row.postos as string[]) : [],
      componentes: Array.isArray(row.componentes) ? (row.componentes as string[]) : [],
    }
  })
}

export async function upsertPadrao(p: {
  pmo: string
  nome: string
  descricao: string
  postos: string[]
  componentes: string[]
}): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase
    .from('sf_padroes_fluxo')
    .upsert(
      { pmo: p.pmo, nome: p.nome, descricao: p.descricao, postos: p.postos, componentes: p.componentes, updated_at: new Date().toISOString() },
      { onConflict: 'pmo,nome' },
    )
  if (error) throw error
}

export async function excluirPadrao(id: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('sf_padroes_fluxo').delete().eq('id', id)
  if (error) throw error
}
```

- [ ] **Step 2: Actions** — `src/modules/shopfloor/application/padroes-fluxo-actions.ts`:
```ts
'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { validarPadraoFluxo } from '@/modules/shopfloor/domain/validar-padrao'
import { upsertPadrao, excluirPadrao } from '@/modules/shopfloor/infra/padroes-fluxo-repository'

type Resultado = { ok: true } | { ok: false; erro: string }

export async function salvarPadraoAction(dados: {
  pmo: string
  nome: string
  descricao: string
  postos: string[]
  componentes: string[]
}): Promise<Resultado> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { ok: false, erro: 'Você não tem permissão para gerenciar padrões.' }
  }
  if (dados.pmo.trim() === '') return { ok: false, erro: 'Selecione o PMO antes de salvar o padrão.' }
  const v = validarPadraoFluxo(dados.nome, dados.postos)
  if (!v.ok) return v
  try {
    await upsertPadrao({
      pmo: dados.pmo.trim(),
      nome: dados.nome.trim(),
      descricao: dados.descricao.trim(),
      postos: dados.postos,
      componentes: dados.componentes,
    })
  } catch {
    return { ok: false, erro: 'Erro ao salvar o padrão.' }
  }
  revalidatePath('/shopfloor/ordens')
  return { ok: true }
}

export async function excluirPadraoAction(id: string): Promise<Resultado> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { ok: false, erro: 'Você não tem permissão para gerenciar padrões.' }
  }
  try {
    await excluirPadrao(id)
  } catch {
    return { ok: false, erro: 'Erro ao excluir o padrão.' }
  }
  revalidatePath('/shopfloor/ordens')
  return { ok: true }
}
```

- [ ] **Step 3: Verificar tipos** — `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit` (sem erros nos arquivos novos).

- [ ] **Step 4: Commit**
```bash
git add src/modules/shopfloor/infra/padroes-fluxo-repository.ts src/modules/shopfloor/application/padroes-fluxo-actions.ts
git commit -m "$(cat <<'EOF'
feat(shopfloor): repo + actions de Padrões de Fluxo (listar/upsert/excluir)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: UI — form de OP (puxar-de-padrão + salvar/apagar) + wiring

**Files:** Modify `ordem-form.tsx`, `page.tsx`, `ordens-lista.tsx`; remover `listarFluxos` de `ordem-repository.ts`.

**Interfaces:** Consumes `PadraoFluxoRow`, `listarPadroes`, `salvarPadraoAction`, `excluirPadraoAction` (Task 3); `useConfirmacao` (`src/components/ui/confirm-dialog.tsx`); `Dialog*` (`src/components/ui/dialog.tsx`).

**Padrões a espelhar (ler antes):** o bloco atual do "Puxar fluxo de OP…" em `ordem-form.tsx` (~linhas 196-213); o tipo `FluxoExistente` exportado do form; como `page.tsx`/`ordens-lista.tsx` passam `fluxosExistentes`; o uso de `Dialog` em `ordem-form.tsx` (o form já usa Dialog no modal principal); o hook `useConfirmacao`.

- [ ] **Step 1: Trocar o tipo + prop no form** — em `ordem-form.tsx`:
  - Renomear o tipo exportado `FluxoExistente` → `PadraoFluxo` com os campos `{ id: string; pmo: string; nome: string; descricao: string; postos: string[]; componentes: string[] }`.
  - Renomear a prop `fluxosExistentes` → `padroesExistentes: PadraoFluxo[]`.
  - Trocar `const fontes = fluxosExistentes.filter((f) => f.pmo === pmo && f.op !== ordem?.op && f.postos.length > 0)` por `const padroesDoPmo = padroesExistentes.filter((p) => p.pmo === pmo)`.

- [ ] **Step 2: Trocar o dropdown "puxar"** — substituir o `<Select>` do "Puxar fluxo de OP…" (mostrado quando `fontes.length > 0`) por um `<Select>` "Puxar de padrão…" mostrado quando `padroesDoPmo.length > 0`: `value=""`, cada `<SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>`; ao escolher, achar o padrão por id e `setFluxo(p.postos); setReceita(p.componentes)`.

- [ ] **Step 3: Botão "Salvar como padrão" + Dialog** — perto do dropdown (na mesma linha do cabeçalho "Fluxo de postos"), um `<Button size="sm" variant="outline">Salvar como padrão</Button>` (só faz sentido com `pmo` definido e `fluxo.length > 0`). Abre um `<Dialog>` com dois `<Input>` (Nome, Descrição). Ao confirmar:
  - Se já existe padrão com esse nome em `padroesDoPmo` → confirmar via `useConfirmacao` ("Já existe um padrão «nome» para este PMO. Sobrescrever?").
  - Chamar `salvarPadraoAction({ pmo, nome, descricao, postos: fluxo, componentes: receita })` (via `useTransition`). Em `ok`, fechar o dialog e limpar os inputs; em erro, mostrar a mensagem (toast `sonner` — o projeto usa; ou inline). O `revalidatePath` da action atualiza `padroesExistentes`.

- [ ] **Step 4: Apagar padrão** — abaixo do dropdown, quando `padroesDoPmo.length > 0`, uma listinha discreta dos padrões do PMO com o nome + um `×` (botão) em cada. Ao clicar `×` → `useConfirmacao` ("Apagar o padrão «nome»?") → `excluirPadraoAction(p.id)` (via `useTransition`); em erro, toast.

- [ ] **Step 5: Wiring da page e da lista**
  - `page.tsx`: trocar `listarFluxos` por `listarPadroes` (import de `@/modules/shopfloor/infra/padroes-fluxo-repository`); renomear `fluxos` → `padroes`; passar `padroesExistentes={padroes}` pro `<OrdemForm>` e pro `<OrdensLista>`.
  - `ordens-lista.tsx`: trocar o import/tipo `FluxoExistente` → `PadraoFluxo`; a prop `fluxos: FluxoExistente[]` → `padroes: PadraoFluxo[]`; passar `padroesExistentes={padroes}` pro `<OrdemForm>` interno.
  - `ordem-repository.ts`: **remover** `listarFluxos` (agora sem uso). Rodar `npm run lint` pra confirmar que não sobrou referência.

- [ ] **Step 6: Lint + build**

Run: `npm run lint && NODE_OPTIONS="--max-old-space-size=4096" npm run build`
Expected: sem erros.

- [ ] **Step 7: Commit**
```bash
git add "src/app/(app)/shopfloor/ordens" src/modules/shopfloor/infra/ordem-repository.ts
git commit -m "$(cat <<'EOF'
feat(shopfloor): Cadastro de OP puxa de Padrões de Fluxo (+ salvar/apagar inline)

Substitui o "puxar de OP crua" pelo dropdown de padrões do PMO; adiciona salvar
fluxo atual como padrão (nome+descrição, sobrescreve com confirmação) e apagar
padrão (com confirmação). Remove listarFluxos (sem uso).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Verificação final (após as tasks)
- [ ] `npm run test` — suíte verde (inclui `validarPadraoFluxo`).
- [ ] `NODE_OPTIONS="--max-old-space-size=4096" npm run build` — build limpo.
- [ ] Aplicar a **migração 0059 no Dev** (controller/humano) antes do smoke.
- [ ] Smoke no preview: no Cadastro de OP com um PMO, "Salvar como padrão" (nome+descrição) → aparece no "Puxar de padrão…"; puxar → preenche fluxo+receita; salvar com nome existente → confirma sobrescrever; apagar → confirma e some; o "puxar de OP crua" não existe mais.

## Self-review (feito ao escrever)
- **Cobertura do spec:** tabela+RLS (T1) · validação (T2) · listar/upsert/excluir + actions guard+revalidate (T3) · UI puxar/salvar/apagar + wiring + remover listarFluxos (T4). ✓
- **Sem placeholders:** código completo em T1–T3; T4 dá o tipo/prop/replacement exatos + os componentes a usar (Dialog/useConfirmacao) e o comportamento preciso.
- **Consistência de tipos:** `PadraoFluxo`/`PadraoFluxoRow` (mesmos campos) atravessa infra→page→form→lista; `postos`/`componentes` = `string[]` casam com `fluxo`/`receita`.
- **Nota:** `page.tsx` e `ordens-lista.tsx` DEVEM trocar a prop juntas (senão o build quebra) — tratado no mesmo Step 5.
