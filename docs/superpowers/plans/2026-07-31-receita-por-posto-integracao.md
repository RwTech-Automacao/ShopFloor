# Receita por posto de Integração — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A receita da Integração passa a ser por **(OP, posto)** — cada posto de perfil `integracao` no fluxo tem sua receita própria, no Cadastro de OP e no registro por bipe.

**Architecture:** Coluna `posto` em `sf_ordem_componentes` (PK `ordem_id + posto + pmo`); receita vira `Record<posto, string[]>` (`ReceitaPorPosto`) da camada de dados até o form; RPC `sf_integrar` filtra a receita por `p_posto`; painel/resolver/`integrar` operam sobre o **posto selecionado**. Detecção sempre por **perfil** (`recurso === 'integracao'`), nunca por nome.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TS strict, Supabase Postgres (RLS + RPC security-definer), Vitest 4.

## Global Constraints

- **Migração só no Dev** (`export SUPABASE_GO_BINARY="$HOME/.local/share/supabase/supabase-go"; supabase db push`). Nada no Prod/main nesta feature.
- **Detecção de posto de Integração SEMPRE por perfil** (`perfilDo(p).recurso === 'integracao'` / `mapa[p]?.recurso === 'integracao'`), NUNCA por nome (`=== 'Integração'` / `.includes('Integração')`).
- **Backfill preserva o existente:** receitas de OP e de padrões existentes viram do posto literal `'Integração'`.
- **Nomes canônicos** (usar idênticos em todas as tasks): tipo `ReceitaPorPosto = Record<string, string[]>`; helpers `agruparReceitaPorPosto`, `receitaParaLinhas`, `parseReceitaPorPosto`, `coagirReceitaPadrao` em `src/modules/shopfloor/domain/receita-posto.ts`; campo `receitaPorPosto` em `OrdemView` e `OrdemLancamentoLista`; param `posto` acrescentado a `resolverPlacaIntegracaoAction`, `EntradaIntegracao` e à prop de `IntegracaoPanel`.
- **PT-BR** em UI e mensagens. Commits com trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Build/lint/testes verdes ao fim de cada task:** `npm run build` (ou `npx tsc --noEmit`), `npm run lint`, `npm test`.

---

## File Structure

- **Create** `supabase/migrations/0065_receita_por_posto.sql` — coluna `posto` + PK + backfill (OP e padrões) + `sf_integrar` receita por posto.
- **Create** `src/modules/shopfloor/domain/receita-posto.ts` — tipo `ReceitaPorPosto` + 4 helpers puros.
- **Create** `src/modules/shopfloor/domain/__tests__/receita-posto.test.ts` — testes dos helpers.
- **Modify** `src/modules/shopfloor/infra/ordem-repository.ts` — select/insert com `posto`.
- **Modify** `src/app/(app)/shopfloor/ordens/page.tsx` — mapeia `receitaPorPosto`.
- **Modify** `src/app/(app)/shopfloor/ordens/ordem-form.tsx` — `OrdemView`/`PadraoFluxo` + N seções de receita + padrão.
- **Modify** `src/modules/shopfloor/application/ordens-actions.ts` — receita por posto, perfil-driven.
- **Modify** `src/modules/shopfloor/infra/padroes-fluxo-repository.ts` — `componentes: ReceitaPorPosto`.
- **Modify** `src/modules/shopfloor/application/padroes-fluxo-actions.ts` — `componentes: ReceitaPorPosto`.
- **Modify** `src/modules/shopfloor/infra/lancamento-repository.ts` — `OrdemLancamentoLista.receitaPorPosto`.
- **Modify** `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx` — passa `posto` + receita do posto.
- **Modify** `src/app/(app)/shopfloor/operar/lancamento/integracao-panel.tsx` — prop `posto`.
- **Modify** `src/modules/shopfloor/application/integracao-actions.ts` — `integrar`/resolver por posto.

> **Dead code intocado:** `listarOrdensParaIntegracao`/`OrdemIntegracao` (aba removida) continuam com `componentes: string[]` e `select sf_ordem_componentes(pmo_componente)` — a coluna `pmo_componente` permanece, então compila. Limpeza é item de backlog separado — **não** mexer aqui.

---

## Task 1: Migração 0065 (schema + backfill + RPC)

**Files:**
- Create: `supabase/migrations/0065_receita_por_posto.sql`

**Interfaces:**
- Produces: coluna `sf_ordem_componentes.posto` (PK `ordem_id, posto, pmo_componente`); `sf_integrar(...)` com receita filtrada por `p_posto`; padrões existentes com `componentes` em objeto.

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/0065_receita_por_posto.sql`:

```sql
-- =============================================================
-- Receita da Integração passa a ser por (OP, posto). Backfill:
-- receitas de OP e de padrões existentes → posto 'Integração'.
-- sf_integrar filtra a receita pelo posto que está registrando.
-- =============================================================

-- ---------- sf_ordem_componentes: + coluna posto na PK ----------
alter table public.sf_ordem_componentes add column if not exists posto text not null default '';
update public.sf_ordem_componentes set posto = 'Integração' where posto = '';
alter table public.sf_ordem_componentes alter column posto drop default;
alter table public.sf_ordem_componentes drop constraint sf_ordem_componentes_pkey;
alter table public.sf_ordem_componentes add primary key (ordem_id, posto, pmo_componente);

-- ---------- sf_padroes_fluxo.componentes: array legado → objeto por posto ----------
update public.sf_padroes_fluxo
set componentes = jsonb_build_object('Integração', componentes)
where jsonb_typeof(componentes) = 'array' and jsonb_array_length(componentes) > 0;
update public.sf_padroes_fluxo
set componentes = '{}'::jsonb
where jsonb_typeof(componentes) = 'array';

-- ---------- sf_integrar: receita filtrada por p_posto (mesma assinatura do 0064 → replace puro) ----------
create or replace function public.sf_integrar(
  p_colaborador           text,
  p_cliente               text,
  p_pmo                   text,
  p_op                    text,
  p_produto_sn            text,
  p_produto_sn_norm       text,
  p_prev_posto            text,
  p_prev_precisa_aprovado boolean,
  p_placas                jsonb,
  p_posto                 text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo     text;
  v_id         uuid;
  v_placa_dup  text;
  v_cod_dup    text;
  v_ordem_id   uuid;
  v_receita    text[];
  v_placa_fora text;
  v_prev_ok    boolean;
begin
  if not tem_permissao('lancar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;

  perform pg_advisory_xact_lock(hashtext('sf_integracao')::bigint);

  if p_prev_posto <> '' then
    if p_prev_precisa_aprovado then
      select exists(
        select 1 from sf_registros
        where pmo = p_pmo and op = p_op and numero_serie_norm = p_produto_sn_norm
          and posto = p_prev_posto and lower(status) = 'aprovado'
      ) into v_prev_ok;
    else
      select exists(
        select 1 from sf_registros
        where pmo = p_pmo and op = p_op and numero_serie_norm = p_produto_sn_norm
          and posto = p_prev_posto
      ) into v_prev_ok;
    end if;
    if not v_prev_ok then
      return jsonb_build_object('ok', false, 'erro', 'SEQUENCIA', 'posto', p_prev_posto);
    end if;
  end if;

  select codigo into v_codigo
  from sf_integracoes
  where produto_sn_norm = p_produto_sn_norm and status = 'ATIVA'
  limit 1;
  if v_codigo is not null then
    return jsonb_build_object('ok', false, 'erro', 'PRODUTO_JA_INTEGRADO', 'codigo', v_codigo);
  end if;

  select i.placa_sn, g.codigo into v_placa_dup, v_cod_dup
  from sf_integracao_itens i
  join sf_integracoes g on g.id = i.integracao_id and g.status = 'ATIVA'
  where i.placa_sn_norm in (select x->>'sn_norm' from jsonb_array_elements(p_placas) x)
  limit 1;
  if v_placa_dup is not null then
    return jsonb_build_object('ok', false, 'erro', 'PLACA_JA_VINCULADA', 'placa', v_placa_dup, 'codigo', v_cod_dup);
  end if;

  -- receita (BOM por PMO) DO POSTO que está registrando: placa de PMO fora dela barra
  select id into v_ordem_id from sf_ordens where pmo = p_pmo and op = p_op limit 1;
  if v_ordem_id is not null then
    select array_agg(lower(trim(pmo_componente))) into v_receita
    from sf_ordem_componentes where ordem_id = v_ordem_id and posto = p_posto;
    if v_receita is not null and array_length(v_receita, 1) > 0 then
      select x->>'pmo' into v_placa_fora
      from jsonb_array_elements(p_placas) x
      where lower(trim(coalesce(x->>'pmo',''))) <> all (v_receita)
      limit 1;
      if v_placa_fora is not null then
        return jsonb_build_object('ok', false, 'erro', 'PLACA_FORA_DA_RECEITA', 'pmo', v_placa_fora);
      end if;
    end if;
  end if;

  v_codigo := 'INT-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' ||
              upper(substr(md5(random()::text), 1, 4));

  insert into sf_integracoes (codigo, colaborador, cliente, pmo, op, produto_sn, produto_sn_norm, qtd_placas)
  values (v_codigo, p_colaborador, p_cliente, p_pmo, p_op, p_produto_sn, p_produto_sn_norm,
          coalesce(jsonb_array_length(p_placas), 0))
  returning id into v_id;

  insert into sf_integracao_itens (integracao_id, placa_pmo, placa_op, placa_sn, placa_sn_norm)
  select v_id, coalesce(x->>'pmo',''), coalesce(x->>'op',''), x->>'sn', x->>'sn_norm'
  from jsonb_array_elements(p_placas) x;

  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm, id_integracao)
  values (p_colaborador, p_posto, p_pmo, p_op, p_cliente, p_produto_sn, p_produto_sn_norm, v_codigo);

  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm, id_integracao)
  select p_colaborador, p_posto, coalesce(x->>'pmo',''), coalesce(x->>'op',''), p_cliente,
         x->>'sn', x->>'sn_norm', v_codigo
  from jsonb_array_elements(p_placas) x;

  return jsonb_build_object('ok', true, 'codigo', v_codigo);
end;
$$;
```

- [ ] **Step 2: Dry-run**

Run: `export SUPABASE_GO_BINARY="$HOME/.local/share/supabase/supabase-go"; supabase db push --dry-run`
Expected: mostra `0065_receita_por_posto.sql` como pendente, sem erro de parsing.

- [ ] **Step 3: Aplicar no Dev**

Run: `export SUPABASE_GO_BINARY="$HOME/.local/share/supabase/supabase-go"; supabase db push`
Expected: `0065` aplicada (Dev passa de 0064 → 0065).

- [ ] **Step 4: Verificar schema + backfill**

Verificar (via PostgREST/psql do Dev) que:
- `sf_ordem_componentes` tem coluna `posto` e a PK inclui `posto` (`\d sf_ordem_componentes` ou consulta a `information_schema`).
- linhas antigas de `sf_ordem_componentes` têm `posto = 'Integração'`.
- `sf_padroes_fluxo.componentes` que eram array não-vazio agora são objeto `{"Integração": [...]}`.

Expected: coluna e PK presentes; backfill aplicado.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0065_receita_por_posto.sql
git commit -m "feat(shopfloor): migração 0065 — receita da Integração por posto (schema + backfill + sf_integrar)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Domínio `receita-posto.ts` (helpers puros + testes)

**Files:**
- Create: `src/modules/shopfloor/domain/receita-posto.ts`
- Test: `src/modules/shopfloor/domain/__tests__/receita-posto.test.ts`

**Interfaces:**
- Produces:
  - `type ReceitaPorPosto = Record<string, string[]>`
  - `agruparReceitaPorPosto(linhas: { posto: string; pmo_componente: string }[]): ReceitaPorPosto`
  - `receitaParaLinhas(receita: ReceitaPorPosto): { posto: string; pmo: string }[]`
  - `parseReceitaPorPosto(json: string, postosIntegracao: string[]): ReceitaPorPosto`
  - `coagirReceitaPadrao(bruto: unknown): ReceitaPorPosto`

- [ ] **Step 1: Escrever os testes (falhando)**

Criar `src/modules/shopfloor/domain/__tests__/receita-posto.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  agruparReceitaPorPosto,
  receitaParaLinhas,
  parseReceitaPorPosto,
  coagirReceitaPadrao,
} from '../receita-posto'

describe('agruparReceitaPorPosto', () => {
  it('agrupa linhas por posto preservando ordem e sem duplicar', () => {
    const linhas = [
      { posto: 'Integração', pmo_componente: 'PMOA' },
      { posto: 'Integração', pmo_componente: 'PMOB' },
      { posto: 'Teste Integração', pmo_componente: 'PMOC' },
      { posto: 'Integração', pmo_componente: 'PMOA' },
    ]
    expect(agruparReceitaPorPosto(linhas)).toEqual({
      'Integração': ['PMOA', 'PMOB'],
      'Teste Integração': ['PMOC'],
    })
  })
  it('lista vazia → objeto vazio', () => {
    expect(agruparReceitaPorPosto([])).toEqual({})
  })
})

describe('receitaParaLinhas', () => {
  it('achata o mapa em linhas {posto,pmo}', () => {
    expect(receitaParaLinhas({ 'Integração': ['PMOA', 'PMOB'], 'Teste Integração': ['PMOC'] })).toEqual([
      { posto: 'Integração', pmo: 'PMOA' },
      { posto: 'Integração', pmo: 'PMOB' },
      { posto: 'Teste Integração', pmo: 'PMOC' },
    ])
  })
})

describe('parseReceitaPorPosto', () => {
  it('mantém só postos de integração e remove PMO vazia/duplicada (case-insensitive)', () => {
    const json = JSON.stringify({
      'Integração': ['PMOA', 'pmoa', '', 'PMOB'],
      'Teste Integração': ['PMOC'],
      'Teste': ['PMOX'],
    })
    expect(parseReceitaPorPosto(json, ['Integração', 'Teste Integração'])).toEqual({
      'Integração': ['PMOA', 'PMOB'],
      'Teste Integração': ['PMOC'],
    })
  })
  it('JSON inválido ou array → objeto vazio', () => {
    expect(parseReceitaPorPosto('nope', ['Integração'])).toEqual({})
    expect(parseReceitaPorPosto('[]', ['Integração'])).toEqual({})
  })
  it('posto sem PMO válida some do resultado', () => {
    expect(parseReceitaPorPosto(JSON.stringify({ 'Integração': ['', '  '] }), ['Integração'])).toEqual({})
  })
})

describe('coagirReceitaPadrao', () => {
  it('array legado vira receita do posto Integração', () => {
    expect(coagirReceitaPadrao(['PMOA', 'PMOB'])).toEqual({ 'Integração': ['PMOA', 'PMOB'] })
  })
  it('objeto é mantido (limpando PMOs vazias)', () => {
    expect(coagirReceitaPadrao({ 'Integração': ['PMOA', ''], 'Teste Integração': ['PMOC'] })).toEqual({
      'Integração': ['PMOA'],
      'Teste Integração': ['PMOC'],
    })
  })
  it('array vazio / valor inesperado → objeto vazio', () => {
    expect(coagirReceitaPadrao([])).toEqual({})
    expect(coagirReceitaPadrao(null)).toEqual({})
  })
})
```

- [ ] **Step 2: Rodar os testes (devem falhar)**

Run: `npm test -- receita-posto`
Expected: FAIL — módulo `../receita-posto` não existe.

- [ ] **Step 3: Implementar o módulo**

Criar `src/modules/shopfloor/domain/receita-posto.ts`:

```ts
/** Receita da Integração por posto: chave do posto → PMOs de placa que ele integra. */
export type ReceitaPorPosto = Record<string, string[]>

/** Agrupa linhas do banco (sf_ordem_componentes) em receita por posto, preservando ordem e sem duplicar. */
export function agruparReceitaPorPosto(
  linhas: { posto: string; pmo_componente: string }[],
): ReceitaPorPosto {
  const out: ReceitaPorPosto = {}
  for (const l of linhas) {
    const lista = (out[l.posto] ??= [])
    if (!lista.includes(l.pmo_componente)) lista.push(l.pmo_componente)
  }
  return out
}

/** Achata a receita por posto em linhas {posto,pmo} para inserir no banco. */
export function receitaParaLinhas(receita: ReceitaPorPosto): { posto: string; pmo: string }[] {
  const out: { posto: string; pmo: string }[] = []
  for (const posto of Object.keys(receita)) {
    for (const pmo of receita[posto] ?? []) out.push({ posto, pmo })
  }
  return out
}

/** Remove PMOs vazias e duplicadas (case-insensitive), preservando ordem. */
function limparPmos(lista: unknown): string[] {
  if (!Array.isArray(lista)) return []
  const vistos = new Set<string>()
  const out: string[] = []
  for (const item of lista) {
    const v = String(item).trim()
    if (v !== '' && !vistos.has(v.toLowerCase())) {
      vistos.add(v.toLowerCase())
      out.push(v)
    }
  }
  return out
}

/**
 * Lê a receita por posto vinda do form (JSON objeto posto→PMOs), mantendo só os postos
 * informados como de Integração e limpando PMOs vazias/duplicadas por posto.
 */
export function parseReceitaPorPosto(json: string, postosIntegracao: string[]): ReceitaPorPosto {
  let bruto: unknown
  try {
    bruto = JSON.parse(json)
  } catch {
    return {}
  }
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) return {}
  const permitido = new Set(postosIntegracao)
  const out: ReceitaPorPosto = {}
  for (const [posto, lista] of Object.entries(bruto as Record<string, unknown>)) {
    if (!permitido.has(posto)) continue
    const pmos = limparPmos(lista)
    if (pmos.length > 0) out[posto] = pmos
  }
  return out
}

/** Aceita a receita de um padrão em objeto (novo) ou array legado (vira receita do posto 'Integração'). */
export function coagirReceitaPadrao(bruto: unknown): ReceitaPorPosto {
  if (Array.isArray(bruto)) {
    const pmos = limparPmos(bruto)
    return pmos.length > 0 ? { 'Integração': pmos } : {}
  }
  if (typeof bruto === 'object' && bruto !== null) {
    const out: ReceitaPorPosto = {}
    for (const [posto, lista] of Object.entries(bruto as Record<string, unknown>)) {
      const pmos = limparPmos(lista)
      if (pmos.length > 0) out[posto] = pmos
    }
    return out
  }
  return {}
}
```

- [ ] **Step 4: Rodar os testes (devem passar)**

Run: `npm test -- receita-posto`
Expected: PASS (todos os describes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/shopfloor/domain/receita-posto.ts src/modules/shopfloor/domain/__tests__/receita-posto.test.ts
git commit -m "feat(shopfloor): domínio receita-posto (helpers de receita por posto) + testes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Cadastro de OP — receita por posto (repo + actions + form + padrões)

**Files:**
- Modify: `src/modules/shopfloor/infra/ordem-repository.ts`
- Modify: `src/app/(app)/shopfloor/ordens/page.tsx`
- Modify: `src/app/(app)/shopfloor/ordens/ordem-form.tsx`
- Modify: `src/modules/shopfloor/application/ordens-actions.ts`
- Modify: `src/modules/shopfloor/infra/padroes-fluxo-repository.ts`
- Modify: `src/modules/shopfloor/application/padroes-fluxo-actions.ts`

**Interfaces:**
- Consumes (Task 2): `ReceitaPorPosto`, `agruparReceitaPorPosto`, `receitaParaLinhas`, `parseReceitaPorPosto`, `coagirReceitaPadrao`.
- Consumes (existente): `mapaPostoPerfil(): Promise<Record<string, PerfilPosto>>` de `../infra/postos-repository`; `perfilDo`/`PERFIL_PADRAO` no form.
- Produces: `OrdemView.receitaPorPosto: ReceitaPorPosto` e `PadraoFluxo.componentes: ReceitaPorPosto` (consumidos por outras telas de OP); `criarOrdem`/`atualizarOrdem(dados, postos, receita: { posto: string; pmo: string }[])`; `salvarPadraoAction({ ..., componentes: ReceitaPorPosto })`.

> Esta task troca a forma de `componentes` (`string[]` → `ReceitaPorPosto`) em toda a fatia de Cadastro de OP de uma vez, mantendo o build verde. Sem teste unitário novo (server/client) — a verificação é `npm run build` + `npm run lint` + `npm test` (os testes do domínio da Task 2 continuam passando). Smoke manual no fim da feature.

- [ ] **Step 1: `ordem-repository.ts` — select e insert com `posto`**

Em `OrdemRow`, trocar a linha da receita:
```ts
  sf_ordem_componentes: { posto: string; pmo_componente: string }[]
```
No `select` de `listarOrdens`, trocar `sf_ordem_componentes(pmo_componente)` por `sf_ordem_componentes(posto,pmo_componente)`.

Trocar as assinaturas e os inserts de `criarOrdem`/`atualizarOrdem` (o 3º parâmetro passa a ser a lista de linhas já achatada):
```ts
export async function criarOrdem(dados: DadosOrdem, postos: string[], receita: { posto: string; pmo: string }[]): Promise<string> {
  // ...igual até obter `id`...
  if (receita.length > 0) {
    const { error: e3 } = await supabase
      .from('sf_ordem_componentes')
      .insert(receita.map((r) => ({ ordem_id: id, posto: r.posto, pmo_componente: r.pmo })))
    if (e3) throw e3
  }
  return id
}

export async function atualizarOrdem(id: string, dados: DadosOrdem, postos: string[], receita: { posto: string; pmo: string }[]): Promise<void> {
  // ...igual até o delete de sf_ordem_componentes...
  if (receita.length > 0) {
    const { error: eInsC } = await supabase
      .from('sf_ordem_componentes')
      .insert(receita.map((r) => ({ ordem_id: id, posto: r.posto, pmo_componente: r.pmo })))
    if (eInsC) throw eInsC
  }
}
```
(Mantém o resto de cada função idêntico: insert de `sf_ordens`, insert/delete de `sf_ordem_postos`, delete de `sf_ordem_componentes`.)

- [ ] **Step 2: `ordens/page.tsx` — mapear `receitaPorPosto`**

Importar o helper e trocar a linha 30 do map de views:
```ts
import { agruparReceitaPorPosto } from '@/modules/shopfloor/domain/receita-posto'
// ...
    receitaPorPosto: agruparReceitaPorPosto(o.sf_ordem_componentes),
```
(remover a antiga `componentes: o.sf_ordem_componentes.map(...)`).

- [ ] **Step 3: `ordem-form.tsx` — tipos, estado, N seções, hidden input, padrão**

Imports:
```ts
import { PERFIL_PADRAO, type PerfilPosto } from '@/modules/shopfloor/domain/perfil-posto'
import { coagirReceitaPadrao, type ReceitaPorPosto } from '@/modules/shopfloor/domain/receita-posto'
```
(`PerfilPosto`/`PERFIL_PADRAO` já são importados — só garantir que `ReceitaPorPosto`/`coagirReceitaPadrao` entrem.)

Trocar `componentes: string[]` por `receitaPorPosto: ReceitaPorPosto` em `OrdemView` (linha ~40) e `PadraoFluxo` (linha ~50):
```ts
// OrdemView:
  receitaPorPosto: ReceitaPorPosto
// PadraoFluxo:
  componentes: ReceitaPorPosto
```

Estado (linha ~80) e reset ao abrir (linha ~188):
```ts
const [receita, setReceita] = useState<ReceitaPorPosto>(ordem?.receitaPorPosto ?? {})
// no reset ao abrir:
setReceita(ordem?.receitaPorPosto ?? {})
```

Postos de Integração do fluxo + receita filtrada (dentro do componente, antes do `return`):
```ts
const postosIntegracao = fluxo.filter((p) => perfilDo(p).recurso === 'integracao')
const receitaFiltrada: ReceitaPorPosto = Object.fromEntries(
  postosIntegracao.filter((p) => (receita[p]?.length ?? 0) > 0).map((p) => [p, receita[p]!]),
)
```

Hidden input (linha ~220):
```tsx
<input type="hidden" name="componentes" value={JSON.stringify(receitaFiltrada)} />
```

Puxar padrão (linha ~309) e salvar padrão (linha ~143):
```ts
// puxar:
if (padrao) { setFluxo(padrao.postos); setReceita(coagirReceitaPadrao(padrao.componentes)) }
// salvar (onConfirmarSalvarPadrao):
componentes: receitaFiltrada,
```

Bloco de render da receita (linhas ~401-408) — uma seção por posto de Integração:
```tsx
{postosIntegracao.map((posto) => (
  <ReceitaIntegracao
    key={posto}
    posto={posto}
    receita={receita[posto] ?? []}
    setReceita={(lista) => setReceita((prev) => ({ ...prev, [posto]: lista }))}
    pmosDisponiveis={pmosExistentes.filter((p) => p !== pmo && !(receita[posto] ?? []).includes(p))}
  />
))}
```

Componente `ReceitaIntegracao` (linha ~466) — ganha `posto` e título por posto:
```tsx
function ReceitaIntegracao({
  posto,
  receita,
  setReceita,
  pmosDisponiveis,
}: {
  posto: string
  receita: string[]
  setReceita: (r: string[]) => void
  pmosDisponiveis: string[]
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium">
        Receita · {posto}{' '}
        <span className="font-normal text-muted-foreground">· PMOs de placa que compõem este produto</span>
      </p>
      {/* resto idêntico ao atual: chips com X, "Sem receita…", Select "+ Adicionar PMO à receita" */}
    </div>
  )
}
```
(o corpo interno — chips, texto "Sem receita", `Select` — permanece igual ao atual, só o título muda.)

- [ ] **Step 4: `ordens-actions.ts` — receita por posto, perfil-driven**

Imports:
```ts
import { parseReceitaPorPosto, receitaParaLinhas } from '../domain/receita-posto'
import { mapaPostoPerfil } from '../infra/postos-repository'
```
Trocar `lerComponentes` (linhas ~62-79) por uma versão perfil-driven que devolve as linhas achatadas:
```ts
/** Receita por posto vinda do form; mantém só postos de Integração (perfil) do fluxo. */
async function lerReceita(fd: FormData, postos: string[]): Promise<{ posto: string; pmo: string }[]> {
  const mapa = await mapaPostoPerfil()
  const postosIntegracao = postos.filter((p) => mapa[p]?.recurso === 'integracao')
  if (postosIntegracao.length === 0) return []
  const receita = parseReceitaPorPosto(String(fd.get('componentes') ?? '{}'), postosIntegracao)
  return receitaParaLinhas(receita)
}
```
Em `criarOrdemAction` e `editarOrdemAction`, trocar:
```ts
const postos = await lerPostos(formData)
const componentes = postos.includes('Integração') ? lerComponentes(formData) : []
```
por:
```ts
const postos = await lerPostos(formData)
const receita = await lerReceita(formData, postos)
```
e passar `receita` no lugar de `componentes` para `criarOrdem`/`atualizarOrdem`.

- [ ] **Step 5: `padroes-fluxo-repository.ts` — `componentes: ReceitaPorPosto`**

```ts
import { coagirReceitaPadrao, type ReceitaPorPosto } from '@/modules/shopfloor/domain/receita-posto'

export interface PadraoFluxoRow {
  id: string
  pmo: string
  nome: string
  descricao: string
  postos: string[]
  componentes: ReceitaPorPosto
}
```
No map de `listarPadroes`, trocar a coerção de componentes:
```ts
componentes: coagirReceitaPadrao(row.componentes),
```
(`row.componentes` passa a ser `unknown`.) E `upsertPadrao` recebe `componentes: ReceitaPorPosto` e grava o objeto direto (o `.upsert({... componentes: p.componentes ...})` continua igual).

- [ ] **Step 6: `padroes-fluxo-actions.ts` — tipo do componentes**

```ts
import type { ReceitaPorPosto } from '@/modules/shopfloor/domain/receita-posto'
// na assinatura de salvarPadraoAction:
  componentes: ReceitaPorPosto
```
(o corpo passa `componentes: dados.componentes` para `upsertPadrao` — já compatível.)

- [ ] **Step 7: Build + lint + testes**

Run: `npm run build && npm run lint && npm test`
Expected: build e lint sem erro; testes (incl. receita-posto da Task 2) verdes.

- [ ] **Step 8: Commit**

```bash
git add src/modules/shopfloor/infra/ordem-repository.ts "src/app/(app)/shopfloor/ordens/page.tsx" "src/app/(app)/shopfloor/ordens/ordem-form.tsx" src/modules/shopfloor/application/ordens-actions.ts src/modules/shopfloor/infra/padroes-fluxo-repository.ts src/modules/shopfloor/application/padroes-fluxo-actions.ts
git commit -m "feat(shopfloor): Cadastro de OP com uma receita por posto de Integração (perfil-driven) + padrões por posto

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Lançamento/Integração — receita do posto selecionado

**Files:**
- Modify: `src/modules/shopfloor/infra/lancamento-repository.ts`
- Modify: `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx`
- Modify: `src/app/(app)/shopfloor/operar/lancamento/integracao-panel.tsx`
- Modify: `src/modules/shopfloor/application/integracao-actions.ts`

**Interfaces:**
- Consumes (Task 2): `ReceitaPorPosto`, `agruparReceitaPorPosto`.
- Consumes (existente): `mapaPostoPerfil()`; `posto` (posto selecionado) no `lancamento-form`.
- Produces: `OrdemLancamentoLista.receitaPorPosto: ReceitaPorPosto`; `resolverPlacaIntegracaoAction(pmoProduto, opProduto, posto, sn)`; `EntradaIntegracao.posto`; prop `posto` de `IntegracaoPanel`.

- [ ] **Step 1: `lancamento-repository.ts` — `OrdemLancamentoLista.receitaPorPosto`**

Import:
```ts
import { agruparReceitaPorPosto, type ReceitaPorPosto } from '@/modules/shopfloor/domain/receita-posto'
```
Em `OrdemLancamentoLista`, trocar `componentes: string[]` por:
```ts
  receitaPorPosto: ReceitaPorPosto
```
No `select` de `listarOrdensParaLancamento`, trocar `sf_ordem_componentes(pmo_componente)` por `sf_ordem_componentes(posto,pmo_componente)`; no tipo inline das `rows`, trocar para `sf_ordem_componentes: { posto: string; pmo_componente: string }[]`; no `map`, trocar:
```ts
    receitaPorPosto: agruparReceitaPorPosto(r.sf_ordem_componentes),
```
(remover a antiga `componentes: ...`). **Não** tocar em `listarOrdensParaIntegracao`/`OrdemIntegracao` (dead code — mantém `pmo_componente`).

- [ ] **Step 2: `lancamento-form.tsx` — passar posto + receita do posto**

No render do painel (linhas ~241-249), acrescentar `posto` e trocar `componentes`:
```tsx
{ehIntegracao && (
  <IntegracaoPanel
    colaborador={colaborador}
    cliente={cliente}
    pmo={pmo}
    op={op}
    posto={posto}
    descricao={ordemSel?.descricao ?? ''}
    componentes={ordemSel?.receitaPorPosto?.[posto] ?? []}
  />
)}
```

- [ ] **Step 3: `integracao-panel.tsx` — prop `posto` e repasse**

Acrescentar `posto: string` às props e à desestruturação (junto de `pmo`, `op`). Nas chamadas:
```ts
// onBipar:
const r = await resolverPlacaIntegracaoAction(pmo, op, posto, snBipado)
// onRegistrar:
const r = await integrar({ colaborador, pmo, op, produtoSN, placas, posto })
```

- [ ] **Step 4: `integracao-actions.ts` — `integrar` e resolver por posto**

Import:
```ts
import { mapaPostoPerfil } from '../infra/postos-repository'
```
(já importado — garantir.) Em `EntradaIntegracao`, acrescentar `posto: string`.

Em `integrar`, trocar o bloco que acha o posto (linhas ~52-54):
```ts
const posto = entrada.posto.trim()
const mapa = await mapaPostoPerfil()
if (!posto || !ordem.postos.includes(posto) || mapa[posto]?.recurso !== 'integracao') {
  return { ok: false, erro: 'Posto de Integração inválido para esta OP.' }
}
```
Depois usar `posto` onde antes usava `postoIntegr`:
```ts
const prevPosto = postoAnteriorNaSequencia(posto, ordem.postos)
// ...
  p_posto: posto,
```
(`mapa` continua sendo usado no `p_prev_precisa_aprovado`.)

Em `resolverPlacaIntegracaoAction`, acrescentar `posto: string` na assinatura (entre `opProduto` e `sn`) e trocar a fonte da receita (linha ~142):
```ts
export async function resolverPlacaIntegracaoAction(
  pmoProduto: string,
  opProduto: string,
  posto: string,
  sn: string,
): Promise< /* união inalterada */ > {
  // ...após achar `ordem`:
  const receita = ordem.receitaPorPosto?.[posto.trim()] ?? []
  // resto idêntico (faixas, paraReceita, resolverPlaca)
}
```

- [ ] **Step 5: Build + lint + testes**

Run: `npm run build && npm run lint && npm test`
Expected: verdes.

- [ ] **Step 6: Commit**

```bash
git add src/modules/shopfloor/infra/lancamento-repository.ts "src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx" "src/app/(app)/shopfloor/operar/lancamento/integracao-panel.tsx" src/modules/shopfloor/application/integracao-actions.ts
git commit -m "feat(shopfloor): Integração usa a receita do posto selecionado (painel/resolver/integrar por posto)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Smoke (manual, ao fim da feature)

1. **Paridade (1 integração):** OP com 1 posto de Integração — cadastra receita, salva, reabre (receita carrega), registra por bipe. Igual a antes.
2. **2 integrações (o alvo):** OP com 2 postos de perfil integracao (ex.: "Integração" + "Teste Integração") — aparecem **2 seções "Receita · {posto}"**; cadastra PMOs diferentes em cada; salva; reabre (as duas carregam). No Lançamento, seleciona cada posto e confirma que o painel mostra **a receita daquele posto**; registra cada um; confere que os `sf_registros` gravaram com o **posto certo** e que placa fora da receita **daquele posto** é barrada.
3. **Padrão:** salvar OP com 2 receitas como padrão; nova OP → puxar o padrão restaura **as duas receitas nos postos certos**.
4. **Backfill:** uma OP/padrão antigos (pré-0065) seguem funcionando (receita no posto 'Integração').

---

## Self-Review (checagem do autor)

- **Cobertura da spec:** §1 migração → Task 1; §2 infra → Tasks 3 (ordem-repo) e 4 (lancamento-repo); §3 cadastro de OP → Task 3; §4 actions → Task 3; §5 fluxo Integração → Task 4; §6 padrões → Task 3. ✔
- **Sem placeholders:** todo passo com código traz o código real. ✔
- **Consistência de tipos:** `ReceitaPorPosto`/helpers definidos na Task 2 e usados idênticos nas Tasks 3-4; `criarOrdem`/`atualizarOrdem` recebem `{ posto; pmo }[]` (produzido por `receitaParaLinhas`); `OrdemView.receitaPorPosto`/`OrdemLancamentoLista.receitaPorPosto` batem com os consumidores (form e painel). ✔
- **Perfil, não nome:** Tasks 3-4 detectam integração por `recurso === 'integracao'`; nenhum `=== 'Integração'`/`.includes('Integração')` novo (o literal `'Integração'` só aparece no backfill/migração e na coerção de padrão legado). ✔
