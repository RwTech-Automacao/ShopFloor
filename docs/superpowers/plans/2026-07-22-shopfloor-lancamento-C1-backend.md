# ShopFloor Lançamento — Plano C1: Backend do Lançamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** O backend do Lançamento: a permissão `lancar` na UI de Perfis, a **função de submit no banco** (`sf_lancar`, atômica, substitui o LockService), o domínio puro de apoio (TDD), o repositório (catálogos em cascata + config da OP + defeitos + wrapper do RPC) e a **Server Action de submit**. A tela do operador é o Plano C2.

**Architecture:** As validações puras (obrigatórios, faixa de SN, posto aplicável) rodam no servidor em TS (reusando o domínio dos Planos A). As checagens sensíveis a corrida (anti-duplicidade/re-lançamento, sequência, caixa) + a gravação rodam numa função plpgsql `sf_lancar` com **advisory lock por (pmo, op)** — atômica. A permissão `lancar` já existe no banco (migração 0028); falta só o plumbing TS + o toggle na tela de Perfis.

**Tech Stack:** Supabase (Postgres 17, plpgsql, RLS), Next.js 16 (Server Actions), TypeScript strict, Vitest.

## Global Constraints

- **Branch:** `feat/shopfloor-lancamento` (a mesma; continua nela).
- **Regra de anti-duplicidade/re-lançamento** (FINAL — olha o ÚLTIMO registro da peça — pmo+op+numero_serie_norm — NAQUELE posto; princípio: **aprovado nunca repete**):
  - **Postos SEM status** (Inicial, Montagem PTH, Integração, Embalagem, **Extra máquina**): registra 1× só → qualquer registro existente **barra**.
  - **Postos COM status** (Inspeção SPI, Inspeção SMD, Inspeção PTH, Teste, **Burn-in**, Teste Final, Inspeção Final, NQA): último = 'aprovado' → barra; reprovado ou inexistente → libera. (Teste/Teste Final/**Burn-in**: o gate extra "passou por Manutenção" entra quando o módulo Manutenção existir — interino: só reprovada libera.)
- **Postos com status** (gravam `status` aprovado/reprovado): Inspeção SPI, Inspeção SMD, Inspeção PTH, Teste, **Burn-in**, Teste Final, Inspeção Final. **NQA**: grava visual+funcional → a action **deriva um `status` consolidado** (aprovado se ambos aprovados, senão reprovado) e trata NQA como **com status** (`postoTemStatus`=true).
- **Sequência (segue a ordem DA OP — do Plano B2):** o posto **imediatamente anterior na ordem da OP** (`postoAnteriorNaSequencia(posto, ordemPostos)`) precisa estar satisfeito — *registrado* p/ Inicial/Montagem PTH/Integração/Embalagem/**Extra máquina**; *aprovado* p/ os demais. Computado em TS (`precisaAprovado`), verificado no RPC.
- **OP sem faixa de SN → barra** o lançamento (validação TS).
- Permissão de submit: **`lancar`** (a estação loga; colaborador é bipado, texto livre).
- Padrões: repositórios com `import 'server-only'` + `createServerSupabase()`; actions com `getSessao()`+`podeFazer` + `try/catch` + retorno `{ ok } | { ok:false, erro }`.
- TS strict `noUncheckedIndexedAccess`. Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit via heredoc. **Sem push.**
- Verificação: `npx tsc --noEmit && npm run lint && npm run test`.

## File Structure

- Modify: `src/modules/auth/domain/perfil.ts` (Permissao += 'lancar')
- Modify: `src/modules/auth/domain/mapear-perfil.ts` (PerfilRow + mapeamento)
- Modify: `src/modules/perfis/infra/perfil-repository.ts` (PerfilRow += pode_lancar)
- Modify: `src/modules/perfis/domain/regras-perfil.ts` (PERMISSOES += lancar)
- Modify: `src/modules/perfis/application/actions.ts` (flag pode_lancar)
- Create: `src/modules/shopfloor/domain/lancamento-linhas.ts` + `__tests__/lancamento-linhas.test.ts`
- Create: `supabase/migrations/0031_sf_lancar.sql`
- Create: `src/modules/shopfloor/infra/lancamento-repository.ts`
- Create: `src/modules/shopfloor/application/lancar-action.ts`

---

### Task 1: Permissão `lancar` no plumbing TS + tela de Perfis

**Files:**
- Modify: `src/modules/auth/domain/perfil.ts`
- Modify: `src/modules/auth/domain/mapear-perfil.ts`
- Modify: `src/modules/perfis/infra/perfil-repository.ts`
- Modify: `src/modules/perfis/domain/regras-perfil.ts`
- Modify: `src/modules/perfis/application/actions.ts`

**Interfaces:**
- Produces: `Permissao` passa a incluir `'lancar'`; a UI de Perfis ganha o toggle "Lançar". (A coluna `pode_lancar` e o caso no `tem_permissao` já existem — migração 0028.)

- [ ] **Step 1: `perfil.ts` — adicionar 'lancar' ao union**

Em `src/modules/auth/domain/perfil.ts`, no type `Permissao`, adicionar a linha `| 'lancar'` (após `| 'administrar'`):

```ts
export type Permissao =
  | 'visualizar'
  | 'importar'
  | 'editar'
  | 'finalizar'
  | 'editar_finalizado'
  | 'excluir'
  | 'gerar_etiqueta'
  | 'administrar'
  | 'lancar'
```

- [ ] **Step 2: `mapear-perfil.ts` — PerfilRow + mapeamento**

Em `src/modules/auth/domain/mapear-perfil.ts`: adicionar `pode_lancar: boolean` na interface `PerfilRow` (após `pode_administrar`) e `lancar: row.pode_lancar` no objeto `permissoes` (após `administrar: row.pode_administrar,`).

- [ ] **Step 3: `perfil-repository.ts` — PerfilRow += pode_lancar**

Em `src/modules/perfis/infra/perfil-repository.ts`, na interface `PerfilRow`, adicionar `pode_lancar: boolean` após `pode_administrar: boolean` (o `select('*')` já traz a coluna).

- [ ] **Step 4: `regras-perfil.ts` — PERMISSOES += lancar**

Em `src/modules/perfis/domain/regras-perfil.ts`, no array `PERMISSOES`, adicionar após `{ chave: 'administrar', rotulo: 'Administrar' },`:

```ts
  { chave: 'lancar', rotulo: 'Lançar (Shopfloor)' },
```

- [ ] **Step 5: `perfis/application/actions.ts` — flag pode_lancar**

Em `src/modules/perfis/application/actions.ts`: adicionar `'pode_lancar'` à lista de flags (após `'pode_administrar',`) e `pode_lancar: formData.get('lancar') === 'on',` ao objeto de dados (após `pode_administrar: formData.get('administrar') === 'on',`).

- [ ] **Step 6: Compila** — `npx tsc --noEmit` → sem erros (o `Record<Permissao,boolean>` agora exige `lancar`, coberto pelo mapeador).

- [ ] **Step 7: Commit**

```bash
git add src/modules/auth/domain/perfil.ts src/modules/auth/domain/mapear-perfil.ts src/modules/perfis/infra/perfil-repository.ts src/modules/perfis/domain/regras-perfil.ts src/modules/perfis/application/actions.ts
git commit -F - << 'EOF'
feat(shopfloor): permissão `lancar` no plumbing TS + toggle na tela de Perfis

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 2: Domínio de apoio ao submit (TDD) — `lancamento-linhas`

**Files:**
- Create: `src/modules/shopfloor/domain/lancamento-linhas.ts`
- Create: `src/modules/shopfloor/domain/__tests__/lancamento-linhas.test.ts`

**Interfaces:**
- Produces:
  - `POSTOS_COM_STATUS: string[]` e `postoTemStatus(posto): boolean`.
  - `precisaAprovado(posto): boolean` — modo do gate de sequência (false p/ Inicial/Montagem PTH/Integração/Embalagem/Extra máquina; true p/ os demais).
  - `LinhaDefeito = { codigo_defeito: string; posicao: string; tipo_defeito: string }`.
  - `montarLinhas(posto, dados): LinhaDefeito[]` — expande em 1 linha por defeito; SPI reprovado → 1 por posição; aprovado / postos sem defeito → `[]` (o RPC grava 1 linha vazia).

- [ ] **Step 1: Testes (falham)**

`src/modules/shopfloor/domain/__tests__/lancamento-linhas.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { postoTemStatus, precisaAprovado, montarLinhas } from '../lancamento-linhas'

describe('postoTemStatus', () => {
  it('classifica com/sem status', () => {
    expect(postoTemStatus('Teste')).toBe(true)
    expect(postoTemStatus('Inspeção SMD')).toBe(true)
    expect(postoTemStatus('Burn-in')).toBe(true)
    expect(postoTemStatus('Inspeção NQA')).toBe(true)
    expect(postoTemStatus('Inicial')).toBe(false)
    expect(postoTemStatus('Embalagem')).toBe(false)
    expect(postoTemStatus('Extra máquina')).toBe(false)
  })
})

describe('precisaAprovado', () => {
  it('sem status → basta registrado; demais → aprovado', () => {
    expect(precisaAprovado('Inicial')).toBe(false)
    expect(precisaAprovado('Embalagem')).toBe(false)
    expect(precisaAprovado('Extra máquina')).toBe(false)
    expect(precisaAprovado('Teste')).toBe(true)
    expect(precisaAprovado('Burn-in')).toBe(true)
    expect(precisaAprovado('Inspeção NQA')).toBe(true)
  })
})

describe('montarLinhas', () => {
  it('aprovado / sem defeito → vazio', () => {
    expect(montarLinhas('Teste', { status: 'Aprovado', defeitos: [] })).toEqual([])
    expect(montarLinhas('Inicial', {})).toEqual([])
  })
  it('reprovado com N defeitos → 1 linha por defeito', () => {
    const r = montarLinhas('Teste', {
      status: 'Reprovado',
      defeitos: [
        { codigo: '1002', posicao: 'R1', tipo: 'SMD' },
        { codigo: '1003', posicao: 'C4', tipo: 'PTH' },
      ],
    })
    expect(r).toEqual([
      { codigo_defeito: '1002', posicao: 'R1', tipo_defeito: 'SMD' },
      { codigo_defeito: '1003', posicao: 'C4', tipo_defeito: 'PTH' },
    ])
  })
  it('SPI reprovado → 1 linha por posição (sem código/tipo)', () => {
    const r = montarLinhas('Inspeção SPI', { status: 'Reprovado', posicoes: ['R1', 'R2'] })
    expect(r).toEqual([
      { codigo_defeito: '', posicao: 'R1', tipo_defeito: '' },
      { codigo_defeito: '', posicao: 'R2', tipo_defeito: '' },
    ])
  })
})
```

- [ ] **Step 2: Rodar (FALHA)** — `npm run test -- shopfloor/domain/__tests__/lancamento-linhas` → FAIL.

- [ ] **Step 3: Implementar**

`src/modules/shopfloor/domain/lancamento-linhas.ts`:

```ts
/** Postos que gravam status aprovado/reprovado (inspeções e testes). */
export const POSTOS_COM_STATUS = [
  'Inspeção SPI',
  'Inspeção SMD',
  'Inspeção PTH',
  'Teste',
  'Burn-in',
  'Teste Final',
  'Inspeção Final',
  'Inspeção NQA',
] as const

export function postoTemStatus(posto: string): boolean {
  return POSTOS_COM_STATUS.some((p) => p.toLowerCase() === posto.toLowerCase())
}

/** Postos onde o gate de sequência basta estar REGISTRADO (não exige aprovado). */
export const POSTOS_SO_REGISTRADO = ['inicial', 'montagem pth', 'integração', 'integracao', 'embalagem', 'extra máquina']

/** Modo do gate de sequência: false = basta registrado; true = exige aprovado. */
export function precisaAprovado(posto: string): boolean {
  return !POSTOS_SO_REGISTRADO.includes(posto.toLowerCase())
}

export interface LinhaDefeito {
  codigo_defeito: string
  posicao: string
  tipo_defeito: string
}

export interface DadosLinhas {
  status?: string
  defeitos?: { codigo: string; posicao: string; tipo: string }[]
  posicoes?: string[]
}

/** Expande o lançamento em linhas: 1 por defeito; SPI reprovado → 1 por posição; senão vazio (1 linha base). */
export function montarLinhas(posto: string, dados: DadosLinhas): LinhaDefeito[] {
  const reprovado = (dados.status ?? '').toLowerCase() === 'reprovado'
  if (!reprovado) return []
  if (posto.toLowerCase() === 'inspeção spi') {
    return (dados.posicoes ?? [])
      .filter((p) => p.trim() !== '')
      .map((posicao) => ({ codigo_defeito: '', posicao, tipo_defeito: '' }))
  }
  return (dados.defeitos ?? [])
    .filter((d) => d.codigo.trim() !== '' || d.posicao.trim() !== '')
    .map((d) => ({ codigo_defeito: d.codigo, posicao: d.posicao, tipo_defeito: d.tipo }))
}
```

- [ ] **Step 4: Rodar (PASSA)** — `npm run test -- shopfloor/domain/__tests__/lancamento-linhas` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/shopfloor/domain/lancamento-linhas.ts src/modules/shopfloor/domain/__tests__/lancamento-linhas.test.ts
git commit -F - << 'EOF'
feat(shopfloor): domínio de apoio ao lançamento (linhas/status/modo) com TDD

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 3: Migração `0031` — função de submit `sf_lancar` (plpgsql, atômica)

**Files:**
- Create: `supabase/migrations/0031_sf_lancar.sql`

**Interfaces:**
- Produces: `public.sf_lancar(...) returns jsonb` — faz advisory lock por (pmo,op), checa anti-duplicidade/re-lançamento + sequência + caixa, insere 1+ linhas, devolve `{ok:true, caixa_count?}` ou `{ok:false, erro:'CODIGO'}`.

- [ ] **Step 1: Escrever a migração**

`supabase/migrations/0031_sf_lancar.sql`:

```sql
-- =============================================================
-- ShopFloor Processo — função de submit do Lançamento.
-- Atômica (advisory lock por PMO/OP), substitui o LockService do Apps Script.
-- As validações puras (obrigatórios, faixa de SN, posto aplicável) ficam no
-- servidor em TS; aqui só o que é sensível a corrida + a gravação.
-- =============================================================

create or replace function public.sf_lancar(
  p_pmo                  text,
  p_op                   text,
  p_cliente              text,
  p_posto                text,
  p_colaborador          text,
  p_numero_serie         text,
  p_numero_serie_norm    text,
  p_status               text,        -- '' nos postos sem status
  p_posto_tem_status     boolean,     -- posto usa aprovado/reprovado?
  p_numero_caixa         text,        -- '' se não Embalagem
  p_qtd_por_caixa        int,         -- null se não Embalagem (= limite da caixa)
  p_nqa_visual           text,
  p_nqa_funcional        text,
  p_prev_posto           text,        -- posto anterior exigido; '' se nenhum
  p_prev_precisa_aprovado boolean,    -- true = exige aprovado no anterior
  p_linhas               jsonb        -- [{codigo_defeito,posicao,tipo_defeito}]; [] → 1 linha base
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ultimo_status text;
  v_existe        boolean;
  v_prev_ok       boolean;
  v_count         int;
  v_linha         jsonb;
begin
  if not tem_permissao('lancar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;

  -- Serializa lançamentos da MESMA OP (substitui o LockService). Cast p/ bigint
  -- (hashtext devolve int4; evita ambiguidade na resolução de pg_advisory_xact_lock).
  perform pg_advisory_xact_lock(hashtext(p_pmo || '/' || p_op)::bigint);

  -- 1) Anti-duplicidade / re-lançamento (aprovado nunca repete).
  if p_posto_tem_status then
    select status into v_ultimo_status
    from sf_registros
    where pmo = p_pmo and op = p_op and numero_serie_norm = p_numero_serie_norm and posto = p_posto
    order by data_hora desc
    limit 1;
    if v_ultimo_status is not null and lower(v_ultimo_status) = 'aprovado' then
      return jsonb_build_object('ok', false, 'erro', 'DUPLICADO_APROVADO');
    end if;
  else
    select exists(
      select 1 from sf_registros
      where pmo = p_pmo and op = p_op and numero_serie_norm = p_numero_serie_norm and posto = p_posto
    ) into v_existe;
    if v_existe then
      return jsonb_build_object('ok', false, 'erro', 'DUPLICADO');
    end if;
  end if;

  -- 2) Trava de sequência (posto anterior aplicável satisfeito?).
  if p_prev_posto <> '' then
    if p_prev_precisa_aprovado then
      select exists(
        select 1 from sf_registros
        where pmo = p_pmo and op = p_op and numero_serie_norm = p_numero_serie_norm
          and posto = p_prev_posto and lower(status) = 'aprovado'
      ) into v_prev_ok;
    else
      select exists(
        select 1 from sf_registros
        where pmo = p_pmo and op = p_op and numero_serie_norm = p_numero_serie_norm
          and posto = p_prev_posto
      ) into v_prev_ok;
    end if;
    if not v_prev_ok then
      return jsonb_build_object('ok', false, 'erro', 'SEQUENCIA');
    end if;
  end if;

  -- 3) Caixa (Embalagem): limite.
  if p_qtd_por_caixa is not null then
    select count(*) into v_count
    from sf_registros
    where pmo = p_pmo and op = p_op and posto = p_posto and numero_caixa = p_numero_caixa;
    if v_count >= p_qtd_por_caixa then
      return jsonb_build_object('ok', false, 'erro', 'CAIXA_CHEIA');
    end if;
  end if;

  -- 4) Gravação: 1 linha por elemento de p_linhas (ou 1 linha base se []).
  if jsonb_array_length(p_linhas) = 0 then
    insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, qtd_por_caixa,
      status, numero_serie, numero_serie_norm, nqa_visual, nqa_funcional)
    values (p_colaborador, p_posto, p_pmo, p_op, p_cliente, p_numero_caixa, p_qtd_por_caixa,
      p_status, p_numero_serie, p_numero_serie_norm, p_nqa_visual, p_nqa_funcional);
  else
    for v_linha in select * from jsonb_array_elements(p_linhas)
    loop
      insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, qtd_por_caixa,
        status, numero_serie, numero_serie_norm, codigo_defeito, posicao, tipo_defeito,
        nqa_visual, nqa_funcional)
      values (p_colaborador, p_posto, p_pmo, p_op, p_cliente, p_numero_caixa, p_qtd_por_caixa,
        p_status, p_numero_serie, p_numero_serie_norm,
        coalesce(v_linha->>'codigo_defeito', ''), coalesce(v_linha->>'posicao', ''),
        coalesce(v_linha->>'tipo_defeito', ''), p_nqa_visual, p_nqa_funcional);
    end loop;
  end if;

  -- 5) Embalagem: devolve a contagem pós-inserção.
  if p_qtd_por_caixa is not null then
    select count(*) into v_count
    from sf_registros
    where pmo = p_pmo and op = p_op and posto = p_posto and numero_caixa = p_numero_caixa;
    return jsonb_build_object('ok', true, 'caixa_count', v_count);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;
```

- [ ] **Step 2: Sanidade (sem aplicar)** — `grep -c "create or replace function public.sf_lancar" supabase/migrations/0031_sf_lancar.sql` → `1`. O controller aplica no Dev na Task 6.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0031_sf_lancar.sql
git commit -F - << 'EOF'
feat(shopfloor): migração 0031 — função sf_lancar (submit atômico do Lançamento)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 4: Repositório de lançamento (catálogos em cascata + config da OP + defeitos + RPC)

**Files:**
- Create: `src/modules/shopfloor/infra/lancamento-repository.ts`

**Interfaces:**
- Consumes: `createServerSupabase`; a função `sf_lancar` (via `supabase.rpc`).
- Produces:
  - `listarClientes(): Promise<string[]>`
  - `listarPmos(cliente): Promise<string[]>`
  - `listarOps(cliente, pmo): Promise<{ op: string }[]>`
  - `carregarOrdem(pmo, op): Promise<OrdemLancamento | null>` onde `OrdemLancamento = { cliente; descricao; sn_ini; sn_fim; postos: string[] }`
  - `listarDefeitos(): Promise<{ codigo: string; tipo: number }[]>`
  - `chamarSfLancar(args: SfLancarArgs): Promise<{ ok: boolean; erro?: string; caixa_count?: number }>`
  - tipo `SfLancarArgs` com os 17 parâmetros do RPC.

- [ ] **Step 1: Implementar** (segue o padrão de `ordem-repository.ts`)

`src/modules/shopfloor/infra/lancamento-repository.ts`:

```ts
import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'

export interface OrdemLancamento {
  cliente: string
  descricao: string
  sn_ini: string
  sn_fim: string
  postos: string[]
}

export interface SfLancarArgs {
  p_pmo: string
  p_op: string
  p_cliente: string
  p_posto: string
  p_colaborador: string
  p_numero_serie: string
  p_numero_serie_norm: string
  p_status: string
  p_posto_tem_status: boolean
  p_numero_caixa: string
  p_qtd_por_caixa: number | null
  p_nqa_visual: string
  p_nqa_funcional: string
  p_prev_posto: string
  p_prev_precisa_aprovado: boolean
  p_linhas: { codigo_defeito: string; posicao: string; tipo_defeito: string }[]
}

/** Clientes distintos das OPs ativas (status ≠ FINALIZADA). */
export async function listarClientes(): Promise<string[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('cliente')
    .neq('status', 'FINALIZADA')
    .order('cliente')
  if (error) throw error
  return [...new Set((data as { cliente: string }[]).map((r) => r.cliente).filter(Boolean))]
}

export async function listarPmos(cliente: string): Promise<string[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('pmo')
    .eq('cliente', cliente)
    .neq('status', 'FINALIZADA')
    .order('pmo')
  if (error) throw error
  return [...new Set((data as { pmo: string }[]).map((r) => r.pmo).filter(Boolean))]
}

export async function listarOps(cliente: string, pmo: string): Promise<{ op: string }[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('op')
    .eq('cliente', cliente)
    .eq('pmo', pmo)
    .neq('status', 'FINALIZADA')
    .order('op')
  if (error) throw error
  return data as { op: string }[]
}

export async function carregarOrdem(pmo: string, op: string): Promise<OrdemLancamento | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('cliente,descricao,sn_ini,sn_fim,sf_ordem_postos(posto,ordem)')
    .eq('pmo', pmo)
    .eq('op', op)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as unknown as {
    cliente: string
    descricao: string
    sn_ini: string
    sn_fim: string
    sf_ordem_postos: { posto: string; ordem: number }[]
  }
  return {
    cliente: row.cliente,
    descricao: row.descricao,
    sn_ini: row.sn_ini,
    sn_fim: row.sn_fim,
    // postos NA ORDEM da OP (a sequência importa p/ a trava de sequência).
    postos: [...row.sf_ordem_postos].sort((a, b) => a.ordem - b.ordem).map((p) => p.posto),
  }
}

export async function listarDefeitos(): Promise<{ codigo: string; tipo: number }[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_defeitos').select('codigo,tipo').order('codigo')
  if (error) throw error
  return data as { codigo: string; tipo: number }[]
}

/** Chama a função atômica sf_lancar. Erros de infra viram { ok:false, erro:'ERRO_INTERNO' }. */
export async function chamarSfLancar(
  args: SfLancarArgs,
): Promise<{ ok: boolean; erro?: string; caixa_count?: number }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_lancar', args)
  if (error) return { ok: false, erro: 'ERRO_INTERNO' }
  return data as { ok: boolean; erro?: string; caixa_count?: number }
}
```

- [ ] **Step 2: Compila** — `npx tsc --noEmit` → sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add src/modules/shopfloor/infra/lancamento-repository.ts
git commit -F - << 'EOF'
feat(shopfloor): repositório de lançamento (catálogos em cascata + config OP + RPC)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 5: Server Action de submit `lancar-action`

**Files:**
- Create: `src/modules/shopfloor/application/lancar-action.ts`

**Interfaces:**
- Consumes: domínio (`serie`: `serieDentroDaFaixa`, `normalizarSerie`, `limparSerie`; `postos`: `postoAnteriorNaSequencia`; `regras-lancamento`: `obrigatoriosPorPosto`; `lancamento-linhas`: `postoTemStatus`, `precisaAprovado`, `montarLinhas`); repo (`carregarOrdem`, `chamarSfLancar`).
- Produces:
  - `type EntradaLancamento = { colaborador; posto; pmo; op; numeroSerie; status?; numeroCaixa?; qtdPorCaixa?; nqaVisual?; nqaFuncional?; defeitos?; posicoesSPI? }`
  - `type ResultadoLancamento = { ok: true; caixaCount?: number } | { ok: false; erro: string }`
  - `lancar(entrada: EntradaLancamento): Promise<ResultadoLancamento>`

- [ ] **Step 1: Implementar**

`src/modules/shopfloor/application/lancar-action.ts`:

```ts
'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { serieDentroDaFaixa, normalizarSerie, limparSerie } from '../domain/serie'
import { postoAnteriorNaSequencia } from '../domain/postos'
import { obrigatoriosPorPosto } from '../domain/regras-lancamento'
import { postoTemStatus, precisaAprovado, montarLinhas } from '../domain/lancamento-linhas'
import { carregarOrdem, chamarSfLancar } from '../infra/lancamento-repository'

export interface EntradaLancamento {
  colaborador: string
  posto: string
  pmo: string
  op: string
  numeroSerie: string
  status?: string
  numeroCaixa?: string
  qtdPorCaixa?: string
  nqaVisual?: string
  nqaFuncional?: string
  defeitos?: { codigo: string; posicao: string; tipo: string }[]
  posicoesSPI?: string[]
}

export type ResultadoLancamento = { ok: true; caixaCount?: number } | { ok: false; erro: string }

const MENSAGENS: Record<string, string> = {
  SEM_PERMISSAO: 'Você não tem permissão para lançar.',
  DUPLICADO: 'Esta peça já foi registrada neste posto.',
  DUPLICADO_APROVADO: 'Esta peça já foi aprovada neste posto e não pode ser lançada de novo.',
  SEQUENCIA: 'O posto anterior ainda não foi concluído para esta peça.',
  CAIXA_CHEIA: 'A caixa já atingiu o limite de peças.',
  ERRO_INTERNO: 'Não foi possível registrar o lançamento.',
}

export async function lancar(entrada: EntradaLancamento): Promise<ResultadoLancamento> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'lancar')) {
    return { ok: false, erro: MENSAGENS.SEM_PERMISSAO! }
  }

  // Obrigatórios por posto (domínio puro).
  const val = obrigatoriosPorPosto(entrada.posto, {
    colaborador: entrada.colaborador,
    pmo: entrada.pmo,
    op: entrada.op,
    numeroSerie: entrada.numeroSerie,
    status: entrada.status,
    numeroCaixa: entrada.numeroCaixa,
    limiteCaixa: entrada.qtdPorCaixa,
    nqaVisual: entrada.nqaVisual,
    nqaFuncional: entrada.nqaFuncional,
    cod: entrada.defeitos?.[0]?.codigo,
    pos: entrada.defeitos?.[0]?.posicao ?? entrada.posicoesSPI?.[0],
    tipo: entrada.defeitos?.[0]?.tipo,
  })
  if (!val.ok) return { ok: false, erro: val.erro }

  // Config da OP.
  const ordem = await carregarOrdem(entrada.pmo, entrada.op)
  if (!ordem) return { ok: false, erro: 'OP não encontrada.' }

  // Faixa de SN (OP sem faixa → barra).
  if (ordem.sn_ini.trim() === '' || ordem.sn_fim.trim() === '') {
    return { ok: false, erro: 'Esta OP não tem faixa de Nº de Série cadastrada.' }
  }
  if (!serieDentroDaFaixa(ordem.sn_ini, ordem.sn_fim, entrada.numeroSerie)) {
    return { ok: false, erro: 'Nº de Série fora da faixa desta OP.' }
  }

  // Posto aplicável.
  const aplicavel = (posto: string) => ordem.postos.includes(posto)
  if (!aplicavel(entrada.posto)) {
    return { ok: false, erro: 'Este posto não se aplica a esta OP.' }
  }

  // Posto anterior EXIGIDO = o imediatamente anterior na ORDEM da OP (Plano B2).
  const prevPosto = postoAnteriorNaSequencia(entrada.posto, ordem.postos)
  const qtdPorCaixa =
    entrada.qtdPorCaixa && entrada.qtdPorCaixa.trim() !== '' ? Number(entrada.qtdPorCaixa) : null

  // NQA não tem campo Status: deriva aprovado/reprovado de visual+funcional.
  const ehNqa = entrada.posto.toLowerCase() === 'inspeção nqa'
  const statusFinal = ehNqa
    ? (entrada.nqaVisual ?? '').toLowerCase() === 'aprovado' &&
      (entrada.nqaFuncional ?? '').toLowerCase() === 'aprovado'
      ? 'Aprovado'
      : 'Reprovado'
    : (entrada.status ?? '')

  const linhas = montarLinhas(entrada.posto, {
    status: statusFinal,
    defeitos: entrada.defeitos,
    posicoes: entrada.posicoesSPI,
  })

  const r = await chamarSfLancar({
    p_pmo: entrada.pmo,
    p_op: entrada.op,
    p_cliente: ordem.cliente,
    p_posto: entrada.posto,
    p_colaborador: entrada.colaborador.trim(),
    p_numero_serie: limparSerie(entrada.numeroSerie),
    p_numero_serie_norm: normalizarSerie(entrada.numeroSerie),
    p_status: statusFinal,
    p_posto_tem_status: postoTemStatus(entrada.posto),
    p_numero_caixa: entrada.numeroCaixa ?? '',
    p_qtd_por_caixa: qtdPorCaixa,
    p_nqa_visual: entrada.nqaVisual ?? '',
    p_nqa_funcional: entrada.nqaFuncional ?? '',
    p_prev_posto: prevPosto ?? '',
    p_prev_precisa_aprovado: prevPosto ? precisaAprovado(prevPosto) : false,
    p_linhas: linhas,
  })

  if (!r.ok) return { ok: false, erro: MENSAGENS[r.erro ?? 'ERRO_INTERNO'] ?? MENSAGENS.ERRO_INTERNO! }
  return { ok: true, caixaCount: r.caixa_count }
}
```

- [ ] **Step 2: Compila** — `npx tsc --noEmit` → sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/modules/shopfloor/application/lancar-action.ts
git commit -F - << 'EOF'
feat(shopfloor): server action de lançamento (valida no domínio + chama sf_lancar)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 6: Verificação final + review amplo + aplicação no Dev (controller)

**Files:** nenhum.

- [ ] **Step 1: Suíte** — `npx tsc --noEmit && npm run lint && npm run test` → verde (só o warning `<img>` pré-existente).

- [ ] **Step 2 (CONTROLLER): review amplo do branch** (subagent-driven-development → final review, opus) — foco: a função `sf_lancar` (corretude das checagens + advisory lock), a orquestração TS↔RPC, a permissão `lancar`.

- [ ] **Step 3 (CONTROLLER): aplicar `0031` no Dev + smoke via script** — `supabase db push` (com `SUPABASE_GO_BINARY`), depois um script pontual que chama `sf_lancar` em cenários: lançar Inicial num SN; tentar Teste sem o anterior (SEQUENCIA); SN fora da faixa (barra no TS); Embalagem respeitando o limite; re-lançar aprovado (DUPLICADO/DUPLICADO_APROVADO); reprovado com 2 defeitos (2 linhas). Conferir contagens em `sf_registros`.

- [ ] **Step 4: NÃO push** — commits locais; smoke da tela vem no Plano C2.

---

## Notas de verificação (self-review)

- **Cobertura:** permissão `lancar` end-to-end na UI de Perfis (T1) ✅; submit atômico com anti-duplicidade/sequência/caixa (T3, regras confirmadas) ✅; validações puras reusando o domínio dos Planos A (T5) ✅; catálogos em cascata p/ a tela do C2 (T4) ✅.
- **Duplicação de regra:** a decisão de re-lançamento vive no RPC (depende de estado do banco); o TS não a reimplementa — evita 2 fontes. `postoTemStatus`/`precisaAprovado`/`montarLinhas` são puros e testados; o RPC recebe os flags já computados.
- **Sincronia de nomes de posto:** `POSTOS_COM_STATUS` e `precisaAprovado` usam as mesmas chaves do seed `sf_postos` (com acento) — coerência confirmada nos Planos A/B2.
- **Sem placeholders:** todo passo traz o código; a migração e a função estão completas.
- **Provisório (marcado):** SPI/Final/NQA na regra de re-lançamento e o gate de Manutenção em Teste/Teste Final — ajustar quando o usuário confirmar / quando a Manutenção existir. NQA tratado como "sem status" nesta fatia (registra 1×) — confirmar.
- **Fora deste plano (C2):** a tela de Lançamento (cascata Cliente→PMO→OP, campos dinâmicos, foco no Nº de Série, defeitos múltiplos, NQA) + o item de menu "Lançamento".
