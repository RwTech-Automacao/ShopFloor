# Burn-in por posto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O tempo mínimo de Burn-in passa a ser por **(OP, posto)** — cada posto de perfil `burnin` no fluxo tem seu próprio tempo mínimo, no Cadastro de OP e no gate de saída do Lançamento.

**Architecture:** Nova tabela `sf_ordem_burnin (ordem_id, posto, tempo_min)`; o tempo vira `tempoBurninPorPosto: Record<posto, number>` (minutos) da camada de dados até o form; o gate de saída usa o tempo do posto selecionado. Espelha o "receita por posto" (`sf_ordem_componentes`).

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TS strict, Supabase Postgres (RLS), Vitest 4.

## Global Constraints

- **Migração só no Dev** (`export SUPABASE_GO_BINARY="$HOME/.local/share/supabase/supabase-go"; supabase db push`). Nada no Prod/main.
- **Detecção de posto de Burn-in SEMPRE por perfil** (`perfilDo(p).recurso === 'burnin'` / `mapa[p]?.recurso === 'burnin'`), NUNCA por nome.
- **Backfill preserva o existente:** o tempo único da OP (`sf_ordens.tempo_min_burnin`) vai pra cada posto de Burn-in do fluxo dela.
- **Nomes canônicos** (idênticos em todas as tasks): `type TempoBurninPorPosto = Record<string, number>`; helpers `agruparTempoBurninPorPosto`, `temposParaLinhas`, `parseTempoBurninPorPosto` em `src/modules/shopfloor/domain/burnin-posto.ts`; campo `tempoBurninPorPosto` em `OrdemView` e `OrdemLancamentoLista`; `criarOrdem`/`atualizarOrdem` ganham 4º parâmetro `burnin: { posto: string; tempo_min: number }[]`.
- **Comportamento do aviso** (saída antes do mínimo → só avisa, permite) **inalterado**; só muda a fonte do tempo.
- **PT-BR**; commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Build/lint/test verdes ao fim de cada task:** `npm run build` (se der OOM, `NODE_OPTIONS=--max-old-space-size=6144 npm run build`), `npm run lint`, `npm test`.

---

## File Structure

- **Create** `supabase/migrations/0068_sf_ordem_burnin.sql` — tabela + RLS + backfill.
- **Create** `src/modules/shopfloor/domain/burnin-posto.ts` — tipo + 3 helpers.
- **Create** `src/modules/shopfloor/domain/__tests__/burnin-posto.test.ts` — testes.
- **Modify** `src/modules/shopfloor/infra/ordem-repository.ts` — select/insert `sf_ordem_burnin`; tira `tempo_min_burnin`.
- **Modify** `src/app/(app)/shopfloor/ordens/page.tsx` — mapeia `tempoBurninPorPosto`.
- **Modify** `src/app/(app)/shopfloor/ordens/ordem-form.tsx` — tempo por posto (estado `Record<posto,string>`).
- **Modify** `src/modules/shopfloor/application/ordens-actions.ts` — lê tempo por posto, perfil-driven.
- **Modify** `src/modules/shopfloor/infra/lancamento-repository.ts` — `OrdemLancamentoLista.tempoBurninPorPosto`.
- **Modify** `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx` — gate usa o tempo do posto.

> Coluna `sf_ordens.tempo_min_burnin` fica no schema, **não usada** pelo código novo (limpeza futura). Não tocar em `grade.ts`, `burnin-repository`, `burnin-painel`, `pesquisa-form` (não usam `tempo_min_burnin`).

---

## Task 1: Migração 0068 (tabela + RLS + backfill)

**Files:**
- Create: `supabase/migrations/0068_sf_ordem_burnin.sql`

**Interfaces:**
- Produces: tabela `sf_ordem_burnin (ordem_id, posto, tempo_min, PK(ordem_id,posto))`; linhas de backfill (tempo único da OP → cada posto burnin do fluxo).

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/0068_sf_ordem_burnin.sql`:
```sql
-- =============================================================
-- Tempo mínimo de Burn-in passa a ser por (OP, posto). Backfill:
-- tempo único da OP (sf_ordens.tempo_min_burnin) → cada posto de
-- perfil burnin no fluxo dela. Espelha sf_ordem_componentes.
-- =============================================================
create table public.sf_ordem_burnin (
  ordem_id  uuid not null references public.sf_ordens(id) on delete cascade,
  posto     text not null,
  tempo_min int  not null default 0,
  primary key (ordem_id, posto)
);
alter table public.sf_ordem_burnin enable row level security;
create policy sf_ordem_burnin_select on public.sf_ordem_burnin
  for select using (tem_permissao('visualizar'));
create policy sf_ordem_burnin_admin on public.sf_ordem_burnin
  for all using (tem_permissao('administrar')) with check (tem_permissao('administrar'));

insert into public.sf_ordem_burnin (ordem_id, posto, tempo_min)
select o.id, op.posto, o.tempo_min_burnin
from public.sf_ordens o
join public.sf_ordem_postos op on op.ordem_id = o.id
join public.sf_postos p        on p.chave = op.posto
join public.sf_posto_perfis pf on pf.chave = p.perfil
where pf.recurso = 'burnin' and o.tempo_min_burnin > 0
on conflict (ordem_id, posto) do nothing;
```

- [ ] **Step 2: Dry-run**

Run: `export SUPABASE_GO_BINARY="$HOME/.local/share/supabase/supabase-go"; supabase db push --dry-run`
Expected: mostra `0068_sf_ordem_burnin.sql` como pendente, sem erro.

- [ ] **Step 3: Aplicar no Dev**

Run: `export SUPABASE_GO_BINARY="$HOME/.local/share/supabase/supabase-go"; supabase db push`
Expected: `0068` aplicada (Dev de 0067 → 0068).

- [ ] **Step 4: Verificar tabela + backfill**

Verificar (PostgREST/psql do Dev): a tabela `sf_ordem_burnin` existe; OPs que tinham `tempo_min_burnin > 0` têm uma linha por posto de Burn-in do fluxo, com o mesmo `tempo_min`.
Expected: tabela criada; backfill coerente.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/0068_sf_ordem_burnin.sql
git commit -m "feat(shopfloor): migração 0068 — tempo de Burn-in por posto (tabela + backfill)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Domínio `burnin-posto.ts` (helpers + testes)

**Files:**
- Create: `src/modules/shopfloor/domain/burnin-posto.ts`
- Test: `src/modules/shopfloor/domain/__tests__/burnin-posto.test.ts`

**Interfaces:**
- Consumes: `tempoParaMinutos` de `../tempo-burnin` (`'' → 0`, `'6:00' → 360`, `'1:30' → 90`, inválido → `null`).
- Produces:
  - `type TempoBurninPorPosto = Record<string, number>`
  - `agruparTempoBurninPorPosto(linhas: { posto: string; tempo_min: number }[]): TempoBurninPorPosto`
  - `temposParaLinhas(tempos: TempoBurninPorPosto): { posto: string; tempo_min: number }[]`
  - `parseTempoBurninPorPosto(json: string, postosBurnin: string[]): { ok: true; tempos: TempoBurninPorPosto } | { ok: false; posto: string }`

- [ ] **Step 1: Escrever os testes (falhando)**

Criar `src/modules/shopfloor/domain/__tests__/burnin-posto.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  agruparTempoBurninPorPosto,
  temposParaLinhas,
  parseTempoBurninPorPosto,
} from '../burnin-posto'

describe('agruparTempoBurninPorPosto', () => {
  it('linhas do banco → mapa posto→minutos', () => {
    expect(agruparTempoBurninPorPosto([
      { posto: 'Burn-in', tempo_min: 360 },
      { posto: 'Burn-in 2', tempo_min: 90 },
    ])).toEqual({ 'Burn-in': 360, 'Burn-in 2': 90 })
  })
  it('lista vazia → objeto vazio', () => {
    expect(agruparTempoBurninPorPosto([])).toEqual({})
  })
})

describe('temposParaLinhas', () => {
  it('mapa → linhas {posto,tempo_min}', () => {
    expect(temposParaLinhas({ 'Burn-in': 360, 'Burn-in 2': 90 })).toEqual([
      { posto: 'Burn-in', tempo_min: 360 },
      { posto: 'Burn-in 2', tempo_min: 90 },
    ])
  })
})

describe('parseTempoBurninPorPosto', () => {
  it('dois postos com tempos diferentes → mapa em minutos', () => {
    const json = JSON.stringify({ 'Burn-in': '6:00', 'Burn-in 2': '1:30' })
    expect(parseTempoBurninPorPosto(json, ['Burn-in', 'Burn-in 2'])).toEqual({
      ok: true,
      tempos: { 'Burn-in': 360, 'Burn-in 2': 90 },
    })
  })
  it('campo vazio e 0:00 são ignorados (sem mínimo)', () => {
    const json = JSON.stringify({ 'Burn-in': '', 'Burn-in 2': '0:00' })
    expect(parseTempoBurninPorPosto(json, ['Burn-in', 'Burn-in 2'])).toEqual({ ok: true, tempos: {} })
  })
  it('mantém só postos de burnin do fluxo', () => {
    const json = JSON.stringify({ 'Burn-in': '2:00', 'Teste': '3:00' })
    expect(parseTempoBurninPorPosto(json, ['Burn-in'])).toEqual({ ok: true, tempos: { 'Burn-in': 120 } })
  })
  it('tempo inválido → { ok:false, posto }', () => {
    const json = JSON.stringify({ 'Burn-in': 'abc' })
    expect(parseTempoBurninPorPosto(json, ['Burn-in'])).toEqual({ ok: false, posto: 'Burn-in' })
  })
  it('JSON inválido ou array → mapa vazio', () => {
    expect(parseTempoBurninPorPosto('nope', ['Burn-in'])).toEqual({ ok: true, tempos: {} })
    expect(parseTempoBurninPorPosto('[]', ['Burn-in'])).toEqual({ ok: true, tempos: {} })
  })
})
```

- [ ] **Step 2: Rodar (devem falhar)**

Run: `npm test -- burnin-posto`
Expected: FAIL — módulo `../burnin-posto` não existe.

- [ ] **Step 3: Implementar o módulo**

Criar `src/modules/shopfloor/domain/burnin-posto.ts`:
```ts
import { tempoParaMinutos } from './tempo-burnin'

/** Tempo mínimo de Burn-in por posto: chave do posto → minutos. */
export type TempoBurninPorPosto = Record<string, number>

/** Linhas do banco (sf_ordem_burnin) → mapa posto→minutos. */
export function agruparTempoBurninPorPosto(linhas: { posto: string; tempo_min: number }[]): TempoBurninPorPosto {
  const out: TempoBurninPorPosto = {}
  for (const l of linhas) out[l.posto] = l.tempo_min
  return out
}

/** Mapa → linhas {posto,tempo_min} para inserir no banco. */
export function temposParaLinhas(tempos: TempoBurninPorPosto): { posto: string; tempo_min: number }[] {
  return Object.entries(tempos).map(([posto, tempo_min]) => ({ posto, tempo_min }))
}

/**
 * Lê o tempo por posto vindo do form (JSON objeto posto→"hhh:mm"), mantendo só os postos de
 * Burn-in informados. Campo vazio ou 0:00 → sem mínimo (não entra). Tempo não-parseável →
 * { ok:false, posto } (nomeia o posto ruim). JSON inválido → mapa vazio.
 */
export function parseTempoBurninPorPosto(
  json: string,
  postosBurnin: string[],
): { ok: true; tempos: TempoBurninPorPosto } | { ok: false; posto: string } {
  let bruto: unknown
  try {
    bruto = JSON.parse(json)
  } catch {
    return { ok: true, tempos: {} }
  }
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) return { ok: true, tempos: {} }
  const permitido = new Set(postosBurnin)
  const tempos: TempoBurninPorPosto = {}
  for (const [posto, val] of Object.entries(bruto as Record<string, unknown>)) {
    if (!permitido.has(posto)) continue
    const s = String(val ?? '').trim()
    if (s === '') continue
    const min = tempoParaMinutos(s)
    if (min === null) return { ok: false, posto }
    if (min > 0) tempos[posto] = min
  }
  return { ok: true, tempos }
}
```

- [ ] **Step 4: Rodar (devem passar)**

Run: `npm test -- burnin-posto`
Expected: PASS (todos os describes).

- [ ] **Step 5: Commit**
```bash
git add src/modules/shopfloor/domain/burnin-posto.ts src/modules/shopfloor/domain/__tests__/burnin-posto.test.ts
git commit -m "feat(shopfloor): domínio burnin-posto (tempo de Burn-in por posto) + testes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Cadastro de OP — tempo por posto (repo + page + form + actions)

**Files:**
- Modify: `src/modules/shopfloor/infra/ordem-repository.ts`
- Modify: `src/app/(app)/shopfloor/ordens/page.tsx`
- Modify: `src/app/(app)/shopfloor/ordens/ordem-form.tsx`
- Modify: `src/modules/shopfloor/application/ordens-actions.ts`

**Interfaces:**
- Consumes (Task 2): `TempoBurninPorPosto`, `agruparTempoBurninPorPosto`, `temposParaLinhas`, `parseTempoBurninPorPosto`.
- Consumes (existente): `mapaPostoPerfil()`; `minutosParaTempo`/`mascararTempoFiltro` de `domain/tempo-burnin`; `perfilDo` no form.
- Produces: `OrdemView.tempoBurninPorPosto: TempoBurninPorPosto`; `criarOrdem`/`atualizarOrdem(dados, postos, receita, burnin: { posto: string; tempo_min: number }[])`.

> Troca `tempo_min_burnin: number` (único) por `tempoBurninPorPosto` em toda a fatia de Cadastro de OP de uma vez, build verde. Sem teste novo (server/client); verificação = build+lint+test (os testes da Task 2 seguem verdes).

- [ ] **Step 1: `ordem-repository.ts` — tabela burnin no select/insert**

Em `OrdemRow`, remover `tempo_min_burnin: number` e trocar por (junto dos outros embeds):
```ts
  sf_ordem_burnin: { posto: string; tempo_min: number }[]
```
Em `DadosOrdem`, **remover** a linha `tempo_min_burnin: number`.
No `select` de `listarOrdens`, remover `tempo_min_burnin,` e acrescentar `sf_ordem_burnin(posto,tempo_min)`:
```ts
    .select('id,pmo,op,cliente,qtd,descricao,acp,status,sn_ini,sn_fim,created_at,sf_ordem_postos(posto,ordem),sf_ordem_componentes(posto,pmo_componente),sf_ordem_burnin(posto,tempo_min)')
```
`criarOrdem` e `atualizarOrdem` ganham 4º parâmetro e inserem em `sf_ordem_burnin` (mesmo padrão do componentes):
```ts
export async function criarOrdem(dados: DadosOrdem, postos: string[], receita: { posto: string; pmo: string }[], burnin: { posto: string; tempo_min: number }[]): Promise<string> {
  // ...igual até o insert de sf_ordem_componentes...
  if (burnin.length > 0) {
    const { error: e4 } = await supabase
      .from('sf_ordem_burnin')
      .insert(burnin.map((b) => ({ ordem_id: id, posto: b.posto, tempo_min: b.tempo_min })))
    if (e4) throw e4
  }
  return id
}

export async function atualizarOrdem(id: string, dados: DadosOrdem, postos: string[], receita: { posto: string; pmo: string }[], burnin: { posto: string; tempo_min: number }[]): Promise<void> {
  // ...igual até o reinsert de sf_ordem_componentes...
  const { error: eDelB } = await supabase.from('sf_ordem_burnin').delete().eq('ordem_id', id)
  if (eDelB) throw eDelB
  if (burnin.length > 0) {
    const { error: eInsB } = await supabase
      .from('sf_ordem_burnin')
      .insert(burnin.map((b) => ({ ordem_id: id, posto: b.posto, tempo_min: b.tempo_min })))
    if (eInsB) throw eInsB
  }
}
```
(O `insert(dados)`/`update({...dados})` de `sf_ordens` continua igual — como `DadosOrdem` não tem mais `tempo_min_burnin`, a coluna fica no default.)

- [ ] **Step 2: `ordens/page.tsx` — mapear `tempoBurninPorPosto`**

Importar o helper e trocar a linha `tempo_min_burnin: o.tempo_min_burnin`:
```ts
import { agruparTempoBurninPorPosto } from '@/modules/shopfloor/domain/burnin-posto'
// no map de views:
    tempoBurninPorPosto: agruparTempoBurninPorPosto(o.sf_ordem_burnin),
```

- [ ] **Step 3: `ordem-form.tsx` — tempo por posto**

Import:
```ts
import { minutosParaTempo, mascararTempoFiltro } from '@/modules/shopfloor/domain/tempo-burnin'
import type { TempoBurninPorPosto } from '@/modules/shopfloor/domain/burnin-posto'
```
(`minutosParaTempo`/`mascararTempoFiltro` já são importados — garantir que continuem.)

Em `OrdemView`, trocar `tempo_min_burnin: number` por:
```ts
  tempoBurninPorPosto: TempoBurninPorPosto
```

Helper de estado inicial (fora do componente, perto de `CLIENTE_NOVO`):
```ts
function tempoBurninInicial(ordem?: OrdemView): Record<string, string> {
  const m: Record<string, string> = {}
  for (const [posto, min] of Object.entries(ordem?.tempoBurninPorPosto ?? {})) m[posto] = minutosParaTempo(min)
  return m
}
```

Estado (trocar o `useState` atual de `tempoBurnin`):
```ts
const [tempoBurnin, setTempoBurnin] = useState<Record<string, string>>(tempoBurninInicial(ordem))
```
Reset ao abrir (onde hoje re-seta `setTempoBurnin(...)`):
```ts
setTempoBurnin(tempoBurninInicial(ordem))
```

`adicionar` (semear 6:00 num posto burnin recém-adicionado):
```ts
function adicionar(posto: string) {
  if (fluxo.includes(posto)) return
  setFluxo([...fluxo, posto])
  if (perfilDo(posto).recurso === 'burnin' && (tempoBurnin[posto] ?? '') === '') {
    setTempoBurnin((prev) => ({ ...prev, [posto]: '6:00' }))
  }
}
```

Tempo filtrado + hidden input (perto do hidden de `componentes`, dentro do componente antes do `return`):
```ts
const postosBurnin = fluxo.filter((p) => perfilDo(p).recurso === 'burnin')
const tempoFiltrado: Record<string, string> = Object.fromEntries(
  postosBurnin.map((p) => [p, tempoBurnin[p] ?? '']).filter(([, v]) => v !== ''),
)
```
```tsx
<input type="hidden" name="tempo_burnin" value={JSON.stringify(tempoFiltrado)} />
```

O `<Input>` inline do posto burnin (hoje linhas ~361-370) — tirar `id`/`name="tempo_min_burnin"` e ligar ao mapa:
```tsx
<Input
  value={tempoBurnin[posto] ?? ''}
  onChange={(e) => setTempoBurnin((prev) => ({ ...prev, [posto]: mascararTempoFiltro(e.target.value) }))}
  inputMode="numeric"
  placeholder="hhh:mm"
  className="h-7 w-20 text-sm"
  autoComplete="off"
/>
```

- [ ] **Step 4: `ordens-actions.ts` — ler tempo por posto**

Imports: acrescentar
```ts
import { parseTempoBurninPorPosto, temposParaLinhas } from '../domain/burnin-posto'
```
e **remover** o import agora não usado `tempoParaMinutos` (de `../domain/tempo-burnin`).

Em `lerDados`, **remover** a linha `tempo_min_burnin: 0, // placeholder...`.

Novo helper (perto de `lerReceita`):
```ts
/** Tempo mínimo de Burn-in por posto vindo do form; mantém só postos de Burn-in (perfil) do fluxo. */
async function lerBurnin(fd: FormData, postos: string[]): Promise<{ ok: true; rows: { posto: string; tempo_min: number }[] } | { ok: false; erro: string }> {
  const mapa = await mapaPostoPerfil()
  const postosBurnin = postos.filter((p) => mapa[p]?.recurso === 'burnin')
  if (postosBurnin.length === 0) return { ok: true, rows: [] }
  const r = parseTempoBurninPorPosto(String(fd.get('tempo_burnin') ?? '{}'), postosBurnin)
  if (!r.ok) return { ok: false, erro: `Tempo mínimo de Burn-in inválido no posto ${r.posto} (use hhh:mm).` }
  return { ok: true, rows: temposParaLinhas(r.tempos) }
}
```

Em `criarOrdemAction` e `editarOrdemAction`: **remover** o bloco
```ts
const tempoMin = tempoParaMinutos(String(formData.get('tempo_min_burnin') ?? ''))
if (tempoMin === null) return { ok: false, erro: 'Tempo mínimo de Burn-in inválido (use hh:mm).' }
dados.tempo_min_burnin = tempoMin
```
e trocar a montagem final por:
```ts
const postos = await lerPostos(formData)
const receita = await lerReceita(formData, postos)
const burnin = await lerBurnin(formData, postos)
if (!burnin.ok) return { ok: false, erro: burnin.erro }
```
e passar `burnin.rows` para `criarOrdem`/`atualizarOrdem`:
```ts
id = await criarOrdem(dados, postos, receita, burnin.rows)     // criar
await atualizarOrdem(id, dados, postos, receita, burnin.rows)  // editar
```

- [ ] **Step 5: Build + lint + testes**

Run: `npm run build && npm run lint && npm test`
Expected: verdes (incl. burnin-posto da Task 2).

- [ ] **Step 6: Commit**
```bash
git add src/modules/shopfloor/infra/ordem-repository.ts "src/app/(app)/shopfloor/ordens/page.tsx" "src/app/(app)/shopfloor/ordens/ordem-form.tsx" src/modules/shopfloor/application/ordens-actions.ts
git commit -m "feat(shopfloor): Cadastro de OP com tempo de Burn-in por posto (perfil-driven)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Lançamento — gate usa o tempo do posto selecionado

**Files:**
- Modify: `src/modules/shopfloor/infra/lancamento-repository.ts`
- Modify: `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx`

**Interfaces:**
- Consumes (Task 2): `TempoBurninPorPosto`, `agruparTempoBurninPorPosto`.
- Produces: `OrdemLancamentoLista.tempoBurninPorPosto: TempoBurninPorPosto`.

- [ ] **Step 1: `lancamento-repository.ts` — `tempoBurninPorPosto`**

Import:
```ts
import { agruparTempoBurninPorPosto, type TempoBurninPorPosto } from '@/modules/shopfloor/domain/burnin-posto'
```
Em `OrdemLancamentoLista`, trocar `tempo_min_burnin: number` por:
```ts
  tempoBurninPorPosto: TempoBurninPorPosto
```
No `select` de `listarOrdensParaLancamento`, remover `tempo_min_burnin,` e acrescentar `sf_ordem_burnin(posto,tempo_min)`. No tipo inline das `rows`, remover `tempo_min_burnin: number` e acrescentar `sf_ordem_burnin: { posto: string; tempo_min: number }[]`. No `map`, trocar `tempo_min_burnin: r.tempo_min_burnin` por:
```ts
    tempoBurninPorPosto: agruparTempoBurninPorPosto(r.sf_ordem_burnin),
```

- [ ] **Step 2: `lancamento-form.tsx` — gate por posto**

No `onEnviar`, trocar as duas referências (linhas ~132 e ~136):
```ts
if (ehBurnin && burninEvento === 'saida' && (ordemSel?.tempoBurninPorPosto?.[posto] ?? 0) > 0) {
  // ...
  const min = ordemSel!.tempoBurninPorPosto[posto]!
```
(`posto` é o posto selecionado, já em escopo; o resto do bloco de aviso é idêntico.)

- [ ] **Step 3: Build + lint + testes**

Run: `npm run build && npm run lint && npm test`
Expected: verdes.

- [ ] **Step 4: Commit**
```bash
git add src/modules/shopfloor/infra/lancamento-repository.ts "src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx"
git commit -m "feat(shopfloor): gate de saída do Burn-in usa o tempo mínimo do posto selecionado

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Smoke (manual, ao fim da feature)

1. **Paridade (1 Burn-in):** OP com 1 posto de Burn-in — tempo salva, reabre (carrega), saída antes do tempo avisa, depois não. Igual a antes.
2. **2 Burn-in (o alvo):** OP com 2 postos de Burn-in — **2 tempos independentes**; salva; reabre (os dois carregam). No Lançamento, a saída de **cada** posto compara com **o tempo daquele posto** (aviso correto em cada).
3. **Backfill:** uma OP antiga (pré-0068) com Burn-in segue avisando com o tempo migrado.

---

## Self-Review (checagem do autor)

- **Cobertura da spec:** §1 migração → T1; §2 domínio → T2; §3 infra/§4 form/§5 actions → T3; §6 gate → T4. ✔
- **Sem placeholders:** todo passo com código traz o código real. ✔
- **Consistência de tipos:** `TempoBurninPorPosto`/helpers definidos na T2 e usados idênticos nas T3-T4; `criarOrdem`/`atualizarOrdem` recebem `{posto;tempo_min}[]` (de `temposParaLinhas`); `OrdemView`/`OrdemLancamentoLista.tempoBurninPorPosto` batem com os consumidores. ✔
- **Perfil, não nome:** T3-T4 detectam Burn-in por `recurso === 'burnin'`; nenhum `=== 'Burn-in'` novo (o literal só aparece no backfill/migração). ✔
