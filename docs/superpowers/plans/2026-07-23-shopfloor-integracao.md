# ShopFloor — Plano Integração — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A tela de **Integração** (`/shopfloor/integracao`): vincular o SN do produto final aos SNs das placas (ID `INT-...`), com busca por SN e **cancelamento (admin)**. Migra `appscript/integracao.html` + a seção Integração do `appscript/Código.gs`.

**Architecture:** Espelha o padrão do Lançamento: validações puras em TS (domínio) + função atômica no banco (`sf_integrar`, advisory lock, security definer) que grava o cabeçalho (`sf_integracoes`) + itens (`sf_integracao_itens`) + **registros posto=Integração** em `sf_registros` (produto + placas — alimenta o gate do Lançamento). Cancelar = `sf_cancelar_integracao` (marca CANCELADA + apaga os registros; histórico fica). A tela reusa `listarOrdensParaLancamento` para as cascatas.

**Tech Stack:** Supabase (plpgsql, RLS), Next.js 16 (Server Actions), React 19, TS strict, Vitest.

## Global Constraints

- **Branch:** `feat/shopfloor-lancamento` (a mesma; continua nela).
- **Regras (fiéis ao legado, ver spec):** Integração aplicável à OP do produto; SN do produto na faixa (OP sem faixa → barra); produto não integrado em integração ATIVA; placas não vinculadas a integração ATIVA; placa NÃO valida faixa; Integração não exige posto anterior. **Melhorias:** barrar SN de placa repetido no MESMO envio e produto aparecendo como placa; cancelamento admin-only.
- **Chaves de posto:** o registro grava posto exatamente `'Integração'` (string do catálogo).
- Permissões: registrar/buscar = `lancar`; cancelar = `administrar`.
- Padrões: repositório `import 'server-only'` + `createServerSupabase()`; actions `getSessao()`+`podeFazer`+try/catch+`registrarLog`; RPCs security definer com guarda `tem_permissao(...)` e retorno `jsonb {ok, ...}`.
- TS strict `noUncheckedIndexedAccess`. Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit via heredoc. **Sem push até o fim** (controller pusha para o preview após o review amplo).
- Verificação: `npx tsc --noEmit && npm run lint && npm run test`.

## File Structure

- Create: `supabase/migrations/0032_sf_integracoes.sql`
- Create: `src/modules/shopfloor/domain/integracao-itens.ts` + `__tests__/integracao-itens.test.ts`
- Create: `src/modules/shopfloor/infra/integracao-repository.ts`
- Create: `src/modules/shopfloor/application/integracao-actions.ts`
- Create: `src/app/(app)/shopfloor/integracao/page.tsx`
- Create: `src/app/(app)/shopfloor/integracao/integracao-form.tsx`
- Modify: `src/shared/ui/app-shell.tsx` (item "Integração" no array `SHOPFLOOR`)

---

### Task 1: Migração 0032 — tabelas + `id_integracao` + funções `sf_integrar`/`sf_cancelar_integracao`

**Files:**
- Create: `supabase/migrations/0032_sf_integracoes.sql`

- [ ] **Step 1: Escrever a migração**

`supabase/migrations/0032_sf_integracoes.sql`:

```sql
-- =============================================================
-- ShopFloor Processo — Integração (produto ↔ placas).
-- Cabeçalho + itens + coluna id_integracao em sf_registros +
-- funções atômicas sf_integrar / sf_cancelar_integracao.
-- =============================================================

create table public.sf_integracoes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,               -- INT-aaaammdd-hhmmss-XXXX (exibido)
  data_hora timestamptz not null default now(),
  colaborador text not null default '',
  cliente text not null default '',
  pmo text not null,
  op text not null,
  produto_sn text not null,
  produto_sn_norm text not null,
  qtd_placas int not null default 0,
  status text not null default 'ATIVA',      -- ATIVA | CANCELADA
  cancelada_em timestamptz,
  cancelada_por text,
  created_at timestamptz not null default now()
);
create index sf_integracoes_produto on public.sf_integracoes (produto_sn_norm) where status = 'ATIVA';
alter table public.sf_integracoes enable row level security;
create policy sf_integracoes_select on public.sf_integracoes for select using (tem_permissao('visualizar'));
-- escrita só pelas funções (security definer)

create table public.sf_integracao_itens (
  id uuid primary key default gen_random_uuid(),
  integracao_id uuid not null references public.sf_integracoes(id) on delete cascade,
  placa_pmo text not null default '',
  placa_op text not null default '',
  placa_sn text not null,
  placa_sn_norm text not null
);
create index sf_integracao_itens_placa on public.sf_integracao_itens (placa_sn_norm);
alter table public.sf_integracao_itens enable row level security;
create policy sf_integracao_itens_select on public.sf_integracao_itens for select using (tem_permissao('visualizar'));

alter table public.sf_registros add column id_integracao text not null default '';
create index sf_registros_integracao on public.sf_registros (id_integracao) where id_integracao <> '';

-- ---------- registrar (atômica) ----------
create or replace function public.sf_integrar(
  p_colaborador     text,
  p_cliente         text,
  p_pmo             text,
  p_op              text,
  p_produto_sn      text,
  p_produto_sn_norm text,
  p_placas          jsonb   -- [{pmo,op,sn,sn_norm}]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo text;
  v_id     uuid;
  v_placa_dup text;
  v_cod_dup   text;
begin
  if not tem_permissao('lancar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;

  perform pg_advisory_xact_lock(hashtext('sf_integracao')::bigint);

  -- produto já integrado (ATIVA)?
  select codigo into v_codigo
  from sf_integracoes
  where produto_sn_norm = p_produto_sn_norm and status = 'ATIVA'
  limit 1;
  if v_codigo is not null then
    return jsonb_build_object('ok', false, 'erro', 'PRODUTO_JA_INTEGRADO', 'codigo', v_codigo);
  end if;

  -- alguma placa já vinculada a integração ATIVA?
  select i.placa_sn, g.codigo into v_placa_dup, v_cod_dup
  from sf_integracao_itens i
  join sf_integracoes g on g.id = i.integracao_id and g.status = 'ATIVA'
  where i.placa_sn_norm in (select x->>'sn_norm' from jsonb_array_elements(p_placas) x)
  limit 1;
  if v_placa_dup is not null then
    return jsonb_build_object('ok', false, 'erro', 'PLACA_JA_VINCULADA', 'placa', v_placa_dup, 'codigo', v_cod_dup);
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

  -- registros posto=Integração: 1 do produto + 1 por placa (alimenta o gate do Lançamento)
  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm, id_integracao)
  values (p_colaborador, 'Integração', p_pmo, p_op, p_cliente, p_produto_sn, p_produto_sn_norm, v_codigo);

  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm, id_integracao)
  select p_colaborador, 'Integração', coalesce(x->>'pmo',''), coalesce(x->>'op',''), p_cliente,
         x->>'sn', x->>'sn_norm', v_codigo
  from jsonb_array_elements(p_placas) x;

  return jsonb_build_object('ok', true, 'codigo', v_codigo);
end;
$$;

-- ---------- cancelar (atômica, admin) ----------
create or replace function public.sf_cancelar_integracao(
  p_codigo text,
  p_por    text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not tem_permissao('administrar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;

  perform pg_advisory_xact_lock(hashtext('sf_integracao')::bigint);

  select id into v_id from sf_integracoes where codigo = p_codigo and status = 'ATIVA';
  if v_id is null then
    return jsonb_build_object('ok', false, 'erro', 'NAO_ENCONTRADA');
  end if;

  update sf_integracoes
  set status = 'CANCELADA', cancelada_em = now(), cancelada_por = coalesce(p_por, '')
  where id = v_id;

  -- desfaz a "passagem": o gate volta a travar e os SNs ficam livres (histórico fica no HDR + itens)
  delete from sf_registros where id_integracao = p_codigo;

  return jsonb_build_object('ok', true);
end;
$$;
```

- [ ] **Step 2: Sanidade** — `grep -c "create or replace function" supabase/migrations/0032_sf_integracoes.sql` → `2`. NÃO aplicar (controller aplica no Dev na Task 5).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0032_sf_integracoes.sql
git commit -F - << 'EOF'
feat(shopfloor): migração 0032 — integração (tabelas + sf_integrar/sf_cancelar_integracao)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 2: Domínio `integracao-itens` (TDD)

**Files:**
- Create: `src/modules/shopfloor/domain/integracao-itens.ts`
- Create: `src/modules/shopfloor/domain/__tests__/integracao-itens.test.ts`

**Interfaces:**
- Produces: `interface PlacaIntegracao { pmo: string; op: string; sn: string }`; `validarItensIntegracao(produtoSn: string, placas: PlacaIntegracao[]): { ok: true; placas: PlacaIntegracao[] } | { ok: false; erro: string }` — filtra linhas com SN, exige PMO/OP em cada, barra SN repetido e produto-como-placa; devolve as placas válidas (preenchidas).

- [ ] **Step 1: Testes (falham)**

`src/modules/shopfloor/domain/__tests__/integracao-itens.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validarItensIntegracao } from '../integracao-itens'

const p = (pmo: string, op: string, sn: string) => ({ pmo, op, sn })

describe('validarItensIntegracao', () => {
  it('exige ao menos 1 placa com SN', () => {
    expect(validarItensIntegracao('900', []).ok).toBe(false)
    expect(validarItensIntegracao('900', [p('A', '1', '')]).ok).toBe(false)
  })
  it('linha com SN exige PMO e OP', () => {
    expect(validarItensIntegracao('900', [p('', '1', '100')]).ok).toBe(false)
    expect(validarItensIntegracao('900', [p('A', '', '100')]).ok).toBe(false)
  })
  it('barra SN de placa repetido (normalizado)', () => {
    expect(validarItensIntegracao('900', [p('A', '1', '100'), p('B', '2', '0100')]).ok).toBe(false)
  })
  it('barra produto aparecendo como placa', () => {
    expect(validarItensIntegracao('900', [p('A', '1', '0900')]).ok).toBe(false)
  })
  it('ok: devolve só as linhas preenchidas', () => {
    const r = validarItensIntegracao('900', [p('A', '1', '100'), p('B', '2', ''), p('C', '3', '200')])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.placas).toEqual([p('A', '1', '100'), p('C', '3', '200')])
  })
})
```

- [ ] **Step 2: Rodar (FALHA)** — `npm run test -- shopfloor/domain/__tests__/integracao-itens` → FAIL.

- [ ] **Step 3: Implementar**

`src/modules/shopfloor/domain/integracao-itens.ts`:

```ts
import { normalizarSerie } from './serie'

export interface PlacaIntegracao {
  pmo: string
  op: string
  sn: string
}

/**
 * Valida a lista de placas da integração: considera só linhas com SN; cada uma
 * exige PMO/OP; barra SN repetido (normalizado) e o produto aparecendo como placa.
 */
export function validarItensIntegracao(
  produtoSn: string,
  placas: PlacaIntegracao[],
): { ok: true; placas: PlacaIntegracao[] } | { ok: false; erro: string } {
  const preenchidas = placas.filter((x) => x.sn.trim() !== '')
  if (preenchidas.length === 0) {
    return { ok: false, erro: 'Informe ao menos 1 placa com Nº de Série.' }
  }
  const produtoNorm = normalizarSerie(produtoSn)
  const vistos = new Set<string>()
  for (let i = 0; i < preenchidas.length; i++) {
    const placa = preenchidas[i]!
    if (placa.pmo.trim() === '' || placa.op.trim() === '') {
      return { ok: false, erro: `Selecione PMO e OP na placa ${i + 1}.` }
    }
    const n = normalizarSerie(placa.sn)
    if (n === produtoNorm) {
      return { ok: false, erro: `A placa ${i + 1} tem o mesmo Nº de Série do produto final.` }
    }
    if (vistos.has(n)) {
      return { ok: false, erro: `Nº de Série de placa repetido (placa ${i + 1}).` }
    }
    vistos.add(n)
  }
  return { ok: true, placas: preenchidas }
}
```

- [ ] **Step 4: Rodar (PASSA)** — `npm run test -- shopfloor/domain/__tests__/integracao-itens` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/shopfloor/domain/integracao-itens.ts src/modules/shopfloor/domain/__tests__/integracao-itens.test.ts
git commit -F - << 'EOF'
feat(shopfloor): domínio de itens da integração (TDD)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 3: Repositório + Actions da Integração

**Files:**
- Create: `src/modules/shopfloor/infra/integracao-repository.ts`
- Create: `src/modules/shopfloor/application/integracao-actions.ts`

**Interfaces:**
- Repo produces:
  - `interface ItemIntegracao { tipo: 'Produto' | 'Placa'; pmo: string; op: string; sn: string }`
  - `interface IntegracaoDetalhe { codigo; dataHora; colaborador; cliente; pmo; op; produtoSn; qtdPlacas; itens: ItemIntegracao[] }`
  - `buscarIntegracaoPorSn(snNorm: string): Promise<IntegracaoDetalhe | null>` (produto OU placa, só ATIVAS)
  - `chamarSfIntegrar(args): Promise<{ ok: boolean; erro?: string; codigo?: string; placa?: string }>`
  - `chamarSfCancelarIntegracao(codigo: string, por: string): Promise<{ ok: boolean; erro?: string }>`
- Actions produce:
  - `integrar(entrada: { colaborador; pmo; op; produtoSN; placas: PlacaIntegracao[] }): Promise<{ ok: true; codigo: string } | { ok: false; erro: string }>`
  - `buscarIntegracao(sn: string): Promise<{ ok: true; detalhe: IntegracaoDetalhe | null } | { ok: false; erro: string }>`
  - `cancelarIntegracao(codigo: string): Promise<{ ok: true } | { ok: false; erro: string }>`

- [ ] **Step 1: Repositório**

`src/modules/shopfloor/infra/integracao-repository.ts`:

```ts
import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'

export interface ItemIntegracao {
  tipo: 'Produto' | 'Placa'
  pmo: string
  op: string
  sn: string
}

export interface IntegracaoDetalhe {
  codigo: string
  dataHora: string
  colaborador: string
  cliente: string
  pmo: string
  op: string
  produtoSn: string
  qtdPlacas: number
  itens: ItemIntegracao[]
}

interface IntegracaoRow {
  id: string
  codigo: string
  data_hora: string
  colaborador: string
  cliente: string
  pmo: string
  op: string
  produto_sn: string
  qtd_placas: number
}

async function montarDetalhe(row: IntegracaoRow): Promise<IntegracaoDetalhe> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_integracao_itens')
    .select('placa_pmo,placa_op,placa_sn')
    .eq('integracao_id', row.id)
  if (error) throw error
  const placas = (data as { placa_pmo: string; placa_op: string; placa_sn: string }[]).map((i) => ({
    tipo: 'Placa' as const,
    pmo: i.placa_pmo,
    op: i.placa_op,
    sn: i.placa_sn,
  }))
  return {
    codigo: row.codigo,
    dataHora: row.data_hora,
    colaborador: row.colaborador,
    cliente: row.cliente,
    pmo: row.pmo,
    op: row.op,
    produtoSn: row.produto_sn,
    qtdPlacas: row.qtd_placas,
    itens: [{ tipo: 'Produto', pmo: row.pmo, op: row.op, sn: row.produto_sn }, ...placas],
  }
}

const CAMPOS_HDR = 'id,codigo,data_hora,colaborador,cliente,pmo,op,produto_sn,qtd_placas'

/** Busca a integração ATIVA em que o SN aparece como produto OU como placa. */
export async function buscarIntegracaoPorSn(snNorm: string): Promise<IntegracaoDetalhe | null> {
  const supabase = await createServerSupabase()

  // 1) como produto
  const { data: prod, error: e1 } = await supabase
    .from('sf_integracoes')
    .select(CAMPOS_HDR)
    .eq('produto_sn_norm', snNorm)
    .eq('status', 'ATIVA')
    .maybeSingle()
  if (e1) throw e1
  if (prod) return montarDetalhe(prod as unknown as IntegracaoRow)

  // 2) como placa
  const { data: item, error: e2 } = await supabase
    .from('sf_integracao_itens')
    .select('integracao_id,sf_integracoes!inner(id,codigo,data_hora,colaborador,cliente,pmo,op,produto_sn,qtd_placas,status)')
    .eq('placa_sn_norm', snNorm)
    .eq('sf_integracoes.status', 'ATIVA')
    .limit(1)
    .maybeSingle()
  if (e2) throw e2
  if (!item) return null
  const hdr = (item as unknown as { sf_integracoes: IntegracaoRow }).sf_integracoes
  return montarDetalhe(hdr)
}

export interface SfIntegrarArgs {
  p_colaborador: string
  p_cliente: string
  p_pmo: string
  p_op: string
  p_produto_sn: string
  p_produto_sn_norm: string
  p_placas: { pmo: string; op: string; sn: string; sn_norm: string }[]
}

export async function chamarSfIntegrar(
  args: SfIntegrarArgs,
): Promise<{ ok: boolean; erro?: string; codigo?: string; placa?: string }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_integrar', args)
  if (error) return { ok: false, erro: 'ERRO_INTERNO' }
  return data as { ok: boolean; erro?: string; codigo?: string; placa?: string }
}

export async function chamarSfCancelarIntegracao(
  codigo: string,
  por: string,
): Promise<{ ok: boolean; erro?: string }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_cancelar_integracao', { p_codigo: codigo, p_por: por })
  if (error) return { ok: false, erro: 'ERRO_INTERNO' }
  return data as { ok: boolean; erro?: string }
}
```

- [ ] **Step 2: Actions**

`src/modules/shopfloor/application/integracao-actions.ts`:

```ts
'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { serieDentroDaFaixa, normalizarSerie, limparSerie } from '../domain/serie'
import { validarItensIntegracao, type PlacaIntegracao } from '../domain/integracao-itens'
import { carregarOrdem } from '../infra/lancamento-repository'
import {
  buscarIntegracaoPorSn,
  chamarSfIntegrar,
  chamarSfCancelarIntegracao,
  type IntegracaoDetalhe,
} from '../infra/integracao-repository'

export interface EntradaIntegracao {
  colaborador: string
  pmo: string
  op: string
  produtoSN: string
  placas: PlacaIntegracao[]
}

const MENSAGENS: Record<string, string> = {
  SEM_PERMISSAO: 'Você não tem permissão para esta ação.',
  NAO_ENCONTRADA: 'Integração ativa não encontrada para este código.',
  ERRO_INTERNO: 'Não foi possível concluir a operação.',
}

export async function integrar(
  entrada: EntradaIntegracao,
): Promise<{ ok: true; codigo: string } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'lancar')) {
    return { ok: false, erro: MENSAGENS.SEM_PERMISSAO! }
  }

  const colaborador = entrada.colaborador.trim()
  const pmo = entrada.pmo.trim()
  const op = entrada.op.trim()
  const produtoSN = limparSerie(entrada.produtoSN)
  if (!colaborador || !pmo || !op || !produtoSN) {
    return { ok: false, erro: 'Preencha Colaborador, PMO, OP e o Nº de Série do produto final.' }
  }

  const ordem = await carregarOrdem(pmo, op)
  if (!ordem) return { ok: false, erro: 'OP não encontrada.' }
  if (!ordem.postos.includes('Integração')) {
    return { ok: false, erro: 'O posto Integração não se aplica a esta OP.' }
  }
  if (ordem.sn_ini.trim() === '' || ordem.sn_fim.trim() === '') {
    return { ok: false, erro: 'Esta OP não tem faixa de Nº de Série cadastrada.' }
  }
  if (!serieDentroDaFaixa(ordem.sn_ini, ordem.sn_fim, produtoSN)) {
    return { ok: false, erro: 'Nº de Série do produto fora da faixa desta OP.' }
  }

  const v = validarItensIntegracao(produtoSN, entrada.placas)
  if (!v.ok) return v

  const r = await chamarSfIntegrar({
    p_colaborador: colaborador,
    p_cliente: ordem.cliente,
    p_pmo: pmo,
    p_op: op,
    p_produto_sn: produtoSN,
    p_produto_sn_norm: normalizarSerie(produtoSN),
    p_placas: v.placas.map((x) => ({
      pmo: x.pmo.trim(),
      op: x.op.trim(),
      sn: limparSerie(x.sn),
      sn_norm: normalizarSerie(x.sn),
    })),
  })

  if (!r.ok) {
    if (r.erro === 'PRODUTO_JA_INTEGRADO') {
      return { ok: false, erro: `Produto já integrado (${r.codigo ?? 'código desconhecido'}).` }
    }
    if (r.erro === 'PLACA_JA_VINCULADA') {
      return { ok: false, erro: `Placa ${r.placa ?? ''} já vinculada à integração ${r.codigo ?? ''}.` }
    }
    return { ok: false, erro: MENSAGENS[r.erro ?? 'ERRO_INTERNO'] ?? MENSAGENS.ERRO_INTERNO! }
  }

  await registrarLog({
    entidade: 'sf_integracao',
    entidadeId: r.codigo,
    acao: 'criar',
    descricao: `Integração ${r.codigo}: produto ${produtoSN} (${pmo}/${op}) + ${v.placas.length} placa(s)`,
    dados: { produtoSN, pmo, op, placas: v.placas },
  })
  return { ok: true, codigo: r.codigo! }
}

export async function buscarIntegracao(
  sn: string,
): Promise<{ ok: true; detalhe: IntegracaoDetalhe | null } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'lancar')) {
    return { ok: false, erro: MENSAGENS.SEM_PERMISSAO! }
  }
  const alvo = normalizarSerie(sn)
  if (alvo === '') return { ok: true, detalhe: null }
  try {
    const detalhe = await buscarIntegracaoPorSn(alvo)
    return { ok: true, detalhe }
  } catch {
    return { ok: false, erro: MENSAGENS.ERRO_INTERNO! }
  }
}

export async function cancelarIntegracao(
  codigo: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return { ok: false, erro: MENSAGENS.SEM_PERMISSAO! }
  }
  const r = await chamarSfCancelarIntegracao(codigo.trim(), sessao.nome || sessao.email)
  if (!r.ok) return { ok: false, erro: MENSAGENS[r.erro ?? 'ERRO_INTERNO'] ?? MENSAGENS.ERRO_INTERNO! }

  await registrarLog({
    entidade: 'sf_integracao',
    entidadeId: codigo,
    acao: 'excluir',
    descricao: `Integração ${codigo} cancelada`,
  })
  return { ok: true }
}
```

- [ ] **Step 3: Compila** — `npx tsc --noEmit` → sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/modules/shopfloor/infra/integracao-repository.ts src/modules/shopfloor/application/integracao-actions.ts
git commit -F - << 'EOF'
feat(shopfloor): repositório + actions da integração (integrar/buscar/cancelar)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 4: Tela de Integração (page + form) + item de menu

**Files:**
- Create: `src/app/(app)/shopfloor/integracao/page.tsx`
- Create: `src/app/(app)/shopfloor/integracao/integracao-form.tsx`
- Modify: `src/shared/ui/app-shell.tsx`

**Interfaces:**
- Consumes: `integrar`, `buscarIntegracao`, `cancelarIntegracao`, `IntegracaoDetalhe` (Task 3); `listarOrdensParaLancamento`, `OrdemLancamentoLista` (C2); `getSessao`, `podeFazer`, `SemPermissao`.

- [ ] **Step 1: `page.tsx`**

`src/app/(app)/shopfloor/integracao/page.tsx`:

```tsx
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarOrdensParaLancamento } from '@/modules/shopfloor/infra/lancamento-repository'
import { IntegracaoForm } from './integracao-form'

export default async function IntegracaoPage() {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'lancar')) {
    return <SemPermissao descricao="Você não tem permissão para acessar a Integração." />
  }

  const ordens = await listarOrdensParaLancamento()
  const podeCancelar = podeFazer(sessao.perfil, 'administrar')

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Integração de Placas</h2>
        <p className="text-sm text-muted-foreground">Vincula o produto final às placas que o compõem.</p>
      </div>
      <IntegracaoForm ordens={ordens} podeCancelar={podeCancelar} />
    </div>
  )
}
```

- [ ] **Step 2: `integracao-form.tsx`**

`src/app/(app)/shopfloor/integracao/integracao-form.tsx`:

```tsx
'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { Plus, X, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  integrar,
  buscarIntegracao,
  cancelarIntegracao,
} from '@/modules/shopfloor/application/integracao-actions'
import type { IntegracaoDetalhe } from '@/modules/shopfloor/infra/integracao-repository'
import type { OrdemLancamentoLista } from '@/modules/shopfloor/infra/lancamento-repository'

interface LinhaPlaca {
  pmo: string
  op: string
  sn: string
}

const LINHA_VAZIA: LinhaPlaca = { pmo: '', op: '', sn: '' }
const MAX_PLACAS = 200

export function IntegracaoForm({
  ordens,
  podeCancelar,
}: {
  ordens: OrdemLancamentoLista[]
  podeCancelar: boolean
}) {
  const [colaborador, setColaborador] = useState('')
  const [cliente, setCliente] = useState('')
  const [pmo, setPmo] = useState('')
  const [op, setOp] = useState('')
  const [produtoSN, setProdutoSN] = useState('')
  const [placas, setPlacas] = useState<LinhaPlaca[]>([{ ...LINHA_VAZIA }])
  const [qtdRapida, setQtdRapida] = useState('')
  const [buscaSN, setBuscaSN] = useState('')
  const [detalhe, setDetalhe] = useState<IntegracaoDetalhe | null>(null)
  const [buscou, setBuscou] = useState(false)
  const [enviando, startEnvio] = useTransition()
  const [buscando, startBusca] = useTransition()
  const produtoRef = useRef<HTMLInputElement>(null)

  // Cascata do PRODUTO: só OPs com Integração no fluxo
  const ordensIntegraveis = useMemo(() => ordens.filter((o) => o.postos.includes('Integração')), [ordens])
  const clientes = useMemo(() => [...new Set(ordensIntegraveis.map((o) => o.cliente))], [ordensIntegraveis])
  const pmos = useMemo(
    () => [...new Set(ordensIntegraveis.filter((o) => o.cliente === cliente).map((o) => o.pmo))],
    [ordensIntegraveis, cliente],
  )
  const ops = useMemo(
    () => ordensIntegraveis.filter((o) => o.cliente === cliente && o.pmo === pmo).map((o) => o.op),
    [ordensIntegraveis, cliente, pmo],
  )
  const ordemSel = useMemo(
    () => ordensIntegraveis.find((o) => o.cliente === cliente && o.pmo === pmo && o.op === op) ?? null,
    [ordensIntegraveis, cliente, pmo, op],
  )

  // Placas: qualquer OP ativa
  const pmosPlaca = useMemo(() => [...new Set(ordens.map((o) => o.pmo))], [ordens])
  function opsDoPmo(p: string) {
    return ordens.filter((o) => o.pmo === p).map((o) => o.op)
  }
  function descricaoDe(p: string, o: string) {
    return ordens.find((x) => x.pmo === p && x.op === o)?.descricao ?? ''
  }

  function mudarCliente(v: string) {
    setCliente(v); setPmo(''); setOp('')
  }
  function mudarPmo(v: string) {
    setPmo(v); setOp('')
  }

  function atualizarPlaca(i: number, patch: Partial<LinhaPlaca>) {
    setPlacas(placas.map((l, idx) => (idx === i ? { ...l, ...patch, ...(patch.pmo !== undefined ? { op: '' } : {}) } : l)))
  }
  function adicionarLinha() {
    if (placas.length < MAX_PLACAS) setPlacas([...placas, { ...LINHA_VAZIA }])
  }
  function removerLinha(i: number) {
    setPlacas(placas.length > 1 ? placas.filter((_, idx) => idx !== i) : placas)
  }
  function gerarLinhas() {
    const qtd = Number(qtdRapida)
    if (!Number.isInteger(qtd) || qtd < 1) return
    setPlacas(Array.from({ length: Math.min(qtd, MAX_PLACAS) }, () => ({ ...LINHA_VAZIA })))
  }
  function limpar() {
    setPlacas([{ ...LINHA_VAZIA }]); setProdutoSN(''); setQtdRapida('')
  }

  const valido =
    colaborador.trim() !== '' && ordemSel !== null && produtoSN.trim() !== '' &&
    placas.some((l) => l.sn.trim() !== '')

  function onRegistrar() {
    if (!valido || enviando) return
    startEnvio(async () => {
      const r = await integrar({ colaborador, pmo, op, produtoSN, placas })
      if (r.ok) {
        toast.success(`Integração registrada: ${r.codigo}`)
        limpar()
        setTimeout(() => produtoRef.current?.focus(), 0)
      } else {
        toast.error(r.erro)
      }
    })
  }

  function onBuscar() {
    if (buscaSN.trim() === '' || buscando) return
    startBusca(async () => {
      const r = await buscarIntegracao(buscaSN)
      if (r.ok) {
        setDetalhe(r.detalhe)
        setBuscou(true)
      } else {
        toast.error(r.erro)
      }
    })
  }

  function onCancelar() {
    if (!detalhe || buscando) return
    if (!window.confirm(`Cancelar a integração ${detalhe.codigo}? O produto e as placas ficarão livres para re-integrar.`)) return
    startBusca(async () => {
      const r = await cancelarIntegracao(detalhe.codigo)
      if (r.ok) {
        toast.success('Integração cancelada.')
        setDetalhe(null)
        setBuscou(false)
        setBuscaSN('')
      } else {
        toast.error(r.erro)
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Registrar */}
      <Card>
        <CardHeader>
          <CardTitle>Registrar integração</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="colab">Colaborador</Label>
              <Input id="colab" value={colaborador} onChange={(e) => setColaborador(e.target.value)} autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Cliente</Label>
              <Select value={cliente} onValueChange={(v) => mudarCliente(v ?? '')}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{clientes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>PMO (produto final)</Label>
              <Select value={pmo} onValueChange={(v) => mudarPmo(v ?? '')} disabled={cliente === ''}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{pmos.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>OP</Label>
              <Select value={op} onValueChange={(v) => setOp(v ?? '')} disabled={pmo === ''}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{ops.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-4">
              <Label>Descrição</Label>
              <Input value={ordemSel?.descricao ?? ''} readOnly disabled />
            </div>
          </div>

          {/* Placas */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Placas <span className="font-normal text-muted-foreground">· 1 linha por placa</span></p>
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Input type="number" min="1" step="1" value={qtdRapida} onChange={(e) => setQtdRapida(e.target.value)} placeholder="Qtd" className="h-8 w-20" />
                <Button type="button" variant="outline" size="sm" onClick={gerarLinhas}>Gerar</Button>
                <Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar</Button>
              </span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>PMO</TableHead>
                    <TableHead>OP</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Nº de Série</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {placas.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm font-medium text-enterplak">{i + 1}</TableCell>
                      <TableCell className="min-w-[130px]">
                        <Select value={l.pmo} onValueChange={(v) => atualizarPlaca(i, { pmo: v ?? '' })}>
                          <SelectTrigger><SelectValue placeholder="PMO" /></SelectTrigger>
                          <SelectContent>{pmosPlaca.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="min-w-[110px]">
                        <Select value={l.op} onValueChange={(v) => atualizarPlaca(i, { op: v ?? '' })} disabled={l.pmo === ''}>
                          <SelectTrigger><SelectValue placeholder="OP" /></SelectTrigger>
                          <SelectContent>{opsDoPmo(l.pmo).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="min-w-[160px]">
                        <Input value={descricaoDe(l.pmo, l.op)} readOnly disabled />
                      </TableCell>
                      <TableCell className="min-w-[160px]">
                        <Input value={l.sn} onChange={(e) => atualizarPlaca(i, { sn: e.target.value })} placeholder="Bipe o SN da placa" autoComplete="off" />
                      </TableCell>
                      <TableCell>
                        <button type="button" aria-label={`Remover placa ${i + 1}`} onClick={() => removerLinha(i)} disabled={placas.length <= 1} className="text-muted-foreground hover:text-red-600 disabled:opacity-30">
                          <X className="size-4" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <button type="button" onClick={adicionarLinha} className="mt-2 w-full rounded-lg border border-dashed border-border py-2 text-sm font-medium text-enterplak hover:bg-muted">
              <Plus className="mr-1 inline size-4" /> Adicionar linha
            </button>
          </div>

          <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="produtoSN">Produto Final (Nº de Série)</Label>
              <Input id="produtoSN" ref={produtoRef} value={produtoSN} onChange={(e) => setProdutoSN(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onRegistrar() } }} placeholder="Bipe o SN do produto final" autoComplete="off" className="h-12 text-lg" />
            </div>
            <Button onClick={onRegistrar} disabled={!valido || enviando} className="h-11 bg-enterplak px-8 hover:bg-enterplak-700">
              {enviando ? 'Registrando…' : 'Registrar Integração'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Buscar */}
      <Card>
        <CardHeader>
          <CardTitle>Buscar por Nº de Série</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="buscaSN">SN do produto ou da placa</Label>
              <Input id="buscaSN" value={buscaSN} onChange={(e) => setBuscaSN(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onBuscar() } }} autoComplete="off" />
            </div>
            <Button variant="outline" onClick={onBuscar} disabled={buscando}>
              <Search className="mr-1 size-4" /> {buscando ? 'Buscando…' : 'Buscar'}
            </Button>
          </div>

          {buscou && !detalhe && (
            <p className="text-sm text-muted-foreground">Nenhuma integração ativa encontrada para esse SN.</p>
          )}

          {detalhe && (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <p className="font-semibold text-tinta">{detalhe.codigo}</p>
                  <p className="text-muted-foreground">
                    {detalhe.cliente} · {detalhe.pmo}/{detalhe.op} · {detalhe.qtdPlacas} placa(s) · por {detalhe.colaborador}
                  </p>
                </div>
                {podeCancelar && (
                  <Button variant="destructive" size="sm" onClick={onCancelar} disabled={buscando}>
                    Cancelar integração
                  </Button>
                )}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>PMO</TableHead>
                    <TableHead>OP</TableHead>
                    <TableHead>Nº de Série</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detalhe.itens.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell className={it.tipo === 'Produto' ? 'font-medium text-enterplak' : ''}>{it.tipo}</TableCell>
                      <TableCell>{it.pmo}</TableCell>
                      <TableCell>{it.op}</TableCell>
                      <TableCell>{it.sn}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Item de menu** — em `src/shared/ui/app-shell.tsx`, adicionar `Link2` aos imports de `lucide-react` e, no array `SHOPFLOOR`, entre `lancamento` e `op-ordens`:

```ts
  { chave: 'integracao', rotulo: 'Integração', href: '/shopfloor/integracao', icone: Link2, perm: 'lancar' },
```

- [ ] **Step 4: Compila + lint** — `npx tsc --noEmit` sem erros; `npm run lint` sem erros novos.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/shopfloor/integracao/ src/shared/ui/app-shell.tsx
git commit -F - << 'EOF'
feat(shopfloor): tela de Integração (registrar/buscar/cancelar) + item de menu

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 5: Verificação + review amplo + aplicar 0032 no Dev + push (controller)

**Files:** nenhum.

- [ ] **Step 1: Suíte** — `npx tsc --noEmit && npm run lint && npm run test` → verde (só o warning `<img>` pré-existente).
- [ ] **Step 2 (CONTROLLER): review amplo** — foco: as 2 funções plpgsql (duplicidade/cancelamento), a coerência TS↔SQL dos args, e a tela (cascatas, tabela de placas, busca/cancelar).
- [ ] **Step 3 (CONTROLLER): aplicar `0032` no Dev** (`supabase db push` com `SUPABASE_GO_BINARY`) + smoke via script (registrar com 2 placas → buscar por produto e por placa → re-integrar produto barra → placa reusada barra → cancelar → re-integrar ok) + conferir que o registro posto=Integração do produto satisfaz o gate no Lançamento.
- [ ] **Step 4 (CONTROLLER): push** da branch → preview atualiza pro teste visual do usuário.

---

## Notas de verificação (self-review)

- **Cobertura da spec:** tabelas + `id_integracao` + 2 funções atômicas (T1) ✅; melhoria anti-duplicata no envio (T2, TDD) ✅; busca produto/placa só ATIVAS (T3) ✅; cancelamento admin com histórico preservado e registros apagados (T1/T3) ✅; tela com placas (adicionar/gerar N/limpar, teto 200), produto bipado, busca + cancelar visível só p/ admin (T4) ✅; cascata do produto filtrada a OPs com Integração no fluxo (T4) ✅; menu perm `lancar` (T4) ✅.
- **Coerência TS↔SQL:** `SfIntegrarArgs` = 7 params com nomes exatos de `sf_integrar`; PostgREST liga por nome.
- **Fidelidades:** placa sem validação de faixa; sem gate de posto anterior na integração; produto+placas viram registros posto=`'Integração'` (string exata do catálogo).
- **Sem placeholders:** SQL, domínio, repo, actions e telas completos.
- **Fora de escopo:** Manutenção, Pesquisa/Grade, Dashboard.
