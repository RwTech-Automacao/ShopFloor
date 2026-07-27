# ShopFloor — Plano Manutenção — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A tela de **Manutenção** (`/shopfloor/manutencao`): pendências derivadas das reprovas em **Teste/Burn-in/Teste Final** + registro de reparo (N consertos por ocorrência), e a **ativação do gate**: re-lançar peça reprovada nesses postos passa a exigir reparo registrado após a última reprova.

**Architecture:** Sem tabela nova — reparo = registros `posto='Manutenção'` em `sf_registros` com 4 colunas novas (migração `0033`). Pendências = consulta derivada com agrupamento **puro em TS** (TDD). `sf_lancar` é substituída (parâmetro novo `p_exige_manutencao boolean default false` + checagem `SEM_MANUTENCAO`). Novo RPC `sf_registrar_reparo` (append-only, perm `lancar`).

**Tech Stack:** Supabase (plpgsql, RLS), Next.js 16, React 19, TS strict, Vitest.

## Global Constraints

- **Branch:** `feat/shopfloor-lancamento`.
- **Postos de origem da Manutenção:** `Teste`, `Burn-in`, `Teste Final` — **exatamente** essas strings do catálogo. SMD/PTH ficam FORA (decisão do usuário; diverge do legado).
- **Ocorrência** = `pmo|op|sn_norm|posto|data_hora` da reprova; posições agregadas sem duplicar; Concluída quando existe reparo com `posto_origem = posto` e `data_hora_origem = data_hora` da reprova.
- **Gate:** em `sf_lancar`, se o último registro do posto é `Reprovado` **e** `p_exige_manutencao` → exige `exists` registro `posto='Manutenção'` com `posto_origem = p_posto` e `data_hora >` a última reprova; senão `SEM_MANUTENCAO`.
- Permissão: listar/registrar reparo = `lancar`.
- Padrões do módulo (repos `server-only`, actions com gate+log, RPC security definer com `tem_permissao`).
- TS strict `noUncheckedIndexedAccess`. Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit via heredoc. **Sem push até o fim.**
- Verificação: `npx tsc --noEmit && npm run lint && npm run test`.

## File Structure

- Create: `supabase/migrations/0033_sf_manutencao.sql`
- Modify: `src/modules/shopfloor/domain/lancamento-linhas.ts` (+`POSTOS_REPARO_VIA_MANUTENCAO`, `exigeManutencao`) + teste
- Create: `src/modules/shopfloor/domain/manutencao-pendencias.ts` + `__tests__/manutencao-pendencias.test.ts`
- Create: `src/modules/shopfloor/infra/manutencao-repository.ts`
- Create: `src/modules/shopfloor/application/manutencao-actions.ts`
- Modify: `src/modules/shopfloor/infra/lancamento-repository.ts` (`SfLancarArgs` += `p_exige_manutencao`)
- Modify: `src/modules/shopfloor/application/lancar-action.ts` (passa o flag + mensagem `SEM_MANUTENCAO`)
- Create: `src/app/(app)/shopfloor/manutencao/page.tsx` + `manutencao-lista.tsx`
- Modify: `src/shared/ui/app-shell.tsx` (item "Manutenção", ícone `Wrench`)

---

### Task 1: Migração 0033 — colunas + `sf_registrar_reparo` + `sf_lancar` v2

**Files:**
- Create: `supabase/migrations/0033_sf_manutencao.sql`

- [ ] **Step 1: Escrever a migração**

`supabase/migrations/0033_sf_manutencao.sql`:

```sql
-- =============================================================
-- ShopFloor Processo — Manutenção & Reparo.
-- Colunas de reparo em sf_registros + sf_registrar_reparo +
-- sf_lancar v2 (gate: reprovada em Teste/Burn-in/Teste Final só
-- re-lança após reparo registrado — p_exige_manutencao).
-- =============================================================

alter table public.sf_registros
  add column reparo_conserto text not null default '',
  add column reparo_posicao text not null default '',
  add column posto_origem text not null default '',
  add column data_hora_origem timestamptz;

-- ---------- registrar reparo (append-only) ----------
create or replace function public.sf_registrar_reparo(
  p_colaborador      text,
  p_pmo              text,
  p_op               text,
  p_cliente          text,
  p_sn               text,
  p_sn_norm          text,
  p_cod              text,
  p_pos              text,
  p_tipo             text,
  p_posto_origem     text,
  p_data_hora_origem timestamptz,
  p_consertos        jsonb   -- [{descricao, posicao}]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not tem_permissao('lancar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;
  if coalesce(jsonb_array_length(p_consertos), 0) = 0 then
    return jsonb_build_object('ok', false, 'erro', 'SEM_CONSERTOS');
  end if;

  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm,
    codigo_defeito, posicao, tipo_defeito, reparo_conserto, reparo_posicao, posto_origem, data_hora_origem)
  select p_colaborador, 'Manutenção', p_pmo, p_op, p_cliente, p_sn, p_sn_norm,
    coalesce(p_cod, ''), coalesce(p_pos, ''), coalesce(p_tipo, ''),
    coalesce(x->>'descricao', ''), coalesce(x->>'posicao', ''),
    p_posto_origem, p_data_hora_origem
  from jsonb_array_elements(p_consertos) x;

  return jsonb_build_object('ok', true, 'linhas', jsonb_array_length(p_consertos));
end;
$$;

-- ---------- sf_lancar v2 (substitui a 0031; adiciona o gate de Manutenção) ----------
create or replace function public.sf_lancar(
  p_pmo                  text,
  p_op                   text,
  p_cliente              text,
  p_posto                text,
  p_colaborador          text,
  p_numero_serie         text,
  p_numero_serie_norm    text,
  p_status               text,
  p_posto_tem_status     boolean,
  p_numero_caixa         text,
  p_qtd_por_caixa        int,
  p_nqa_visual           text,
  p_nqa_funcional        text,
  p_prev_posto           text,
  p_prev_precisa_aprovado boolean,
  p_linhas               jsonb,
  p_exige_manutencao     boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ultimo_status text;
  v_ultima_data   timestamptz;
  v_tem_reparo    boolean;
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
    select status, data_hora into v_ultimo_status, v_ultima_data
    from sf_registros
    where pmo = p_pmo and op = p_op and numero_serie_norm = p_numero_serie_norm and posto = p_posto
    order by data_hora desc
    limit 1;
    if v_ultimo_status is not null and lower(v_ultimo_status) = 'aprovado' then
      return jsonb_build_object('ok', false, 'erro', 'DUPLICADO_APROVADO');
    end if;
    -- Gate de Manutenção (Teste/Burn-in/Teste Final): reprovada só re-lança após reparo.
    if v_ultimo_status is not null and lower(v_ultimo_status) = 'reprovado' and p_exige_manutencao then
      select exists(
        select 1 from sf_registros m
        where m.pmo = p_pmo and m.op = p_op and m.numero_serie_norm = p_numero_serie_norm
          and m.posto = 'Manutenção'
          and m.posto_origem = p_posto
          and m.data_hora > v_ultima_data
      ) into v_tem_reparo;
      if not v_tem_reparo then
        return jsonb_build_object('ok', false, 'erro', 'SEM_MANUTENCAO');
      end if;
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

- [ ] **Step 2: Sanidade** — `grep -c "create or replace function" supabase/migrations/0033_sf_manutencao.sql` → `2`. NÃO aplicar (controller, Task 5).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0033_sf_manutencao.sql
git commit -F - << 'EOF'
feat(shopfloor): migração 0033 — reparo em sf_registros + sf_registrar_reparo + gate na sf_lancar

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 2: Domínio (TDD) — `exigeManutencao` + `agruparPendencias`

**Files:**
- Modify: `src/modules/shopfloor/domain/lancamento-linhas.ts` + `__tests__/lancamento-linhas.test.ts`
- Create: `src/modules/shopfloor/domain/manutencao-pendencias.ts` + `__tests__/manutencao-pendencias.test.ts`

**Interfaces:**
- `POSTOS_REPARO_VIA_MANUTENCAO: string[]` e `exigeManutencao(posto): boolean` (true p/ Teste, Burn-in, Teste Final; case-insensitive) — em `lancamento-linhas.ts`.
- Em `manutencao-pendencias.ts`:
  - `interface ReprovaRow { dataHora: string; cliente: string; pmo: string; op: string; sn: string; snNorm: string; posto: string; cod: string; pos: string; tipo: string }`
  - `interface ReparoRow { pmo: string; op: string; snNorm: string; postoOrigem: string; dataHoraOrigem: string | null }`
  - `interface Ocorrencia { dataHora: string; cliente: string; pmo: string; op: string; sn: string; posto: string; cod: string; tipo: string; posicoes: string[]; status: 'Pendente' | 'Concluída' }`
  - `agruparPendencias(reprovas: ReprovaRow[], reparos: ReparoRow[]): Ocorrencia[]` — agrupa por `pmo|op|snNorm|posto|dataHora`, agrega posições sem duplicar, cod/tipo = primeiro não-vazio, Concluída se existe reparo com `postoOrigem===posto` e `dataHoraOrigem===dataHora`, ordena por dataHora desc.

- [ ] **Step 1: Testes de `exigeManutencao`** — em `lancamento-linhas.test.ts`, adicionar:

```ts
describe('exigeManutencao', () => {
  it('só Teste, Burn-in e Teste Final exigem manutenção no re-lançamento', () => {
    expect(exigeManutencao('Teste')).toBe(true)
    expect(exigeManutencao('Burn-in')).toBe(true)
    expect(exigeManutencao('Teste Final')).toBe(true)
    expect(exigeManutencao('Inspeção SMD')).toBe(false)
    expect(exigeManutencao('Inspeção PTH')).toBe(false)
    expect(exigeManutencao('Inicial')).toBe(false)
  })
})
```

(Ajustar o import do teste para incluir `exigeManutencao`.)

- [ ] **Step 2: Testes de `agruparPendencias`** (arquivo novo):

```ts
import { describe, it, expect } from 'vitest'
import { agruparPendencias } from '../manutencao-pendencias'

const rep = (over: Record<string, string>) => ({
  dataHora: '2026-07-23T10:00:00+00:00', cliente: 'C', pmo: 'P', op: '1', sn: '100', snNorm: '100',
  posto: 'Teste', cod: '1002', pos: 'R1', tipo: 'SMD', ...over,
})

describe('agruparPendencias', () => {
  it('agrupa posições da mesma reprova numa ocorrência única', () => {
    const out = agruparPendencias([rep({ pos: 'R1' }), rep({ pos: 'C4' }), rep({ pos: 'R1' })], [])
    expect(out).toHaveLength(1)
    expect(out[0]!.posicoes).toEqual(['R1', 'C4'])
    expect(out[0]!.status).toBe('Pendente')
  })
  it('reprovas em momentos diferentes são ocorrências diferentes', () => {
    const out = agruparPendencias([rep({}), rep({ dataHora: '2026-07-23T11:00:00+00:00' })], [])
    expect(out).toHaveLength(2)
  })
  it('reparo casando (posto de origem + data/hora) conclui a ocorrência', () => {
    const out = agruparPendencias(
      [rep({})],
      [{ pmo: 'P', op: '1', snNorm: '100', postoOrigem: 'Teste', dataHoraOrigem: '2026-07-23T10:00:00+00:00' }],
    )
    expect(out[0]!.status).toBe('Concluída')
  })
  it('reparo de outro posto/momento NÃO conclui', () => {
    const out = agruparPendencias(
      [rep({})],
      [{ pmo: 'P', op: '1', snNorm: '100', postoOrigem: 'Teste Final', dataHoraOrigem: '2026-07-23T10:00:00+00:00' }],
    )
    expect(out[0]!.status).toBe('Pendente')
  })
  it('ordena da mais recente para a mais antiga', () => {
    const out = agruparPendencias([rep({}), rep({ dataHora: '2026-07-23T12:00:00+00:00', sn: '200', snNorm: '200' })], [])
    expect(out[0]!.sn).toBe('200')
  })
})
```

- [ ] **Step 3: Rodar (FALHA)**, **Step 4: Implementar:**

Em `lancamento-linhas.ts` (após `precisaAprovado`):

```ts
/** Postos cuja reprova exige passar pela Manutenção antes do re-lançamento. */
export const POSTOS_REPARO_VIA_MANUTENCAO = ['teste', 'burn-in', 'teste final']

export function exigeManutencao(posto: string): boolean {
  return POSTOS_REPARO_VIA_MANUTENCAO.includes(posto.toLowerCase())
}
```

`manutencao-pendencias.ts`:

```ts
export interface ReprovaRow {
  dataHora: string
  cliente: string
  pmo: string
  op: string
  sn: string
  snNorm: string
  posto: string
  cod: string
  pos: string
  tipo: string
}

export interface ReparoRow {
  pmo: string
  op: string
  snNorm: string
  postoOrigem: string
  dataHoraOrigem: string | null
}

export interface Ocorrencia {
  dataHora: string
  cliente: string
  pmo: string
  op: string
  sn: string
  posto: string
  cod: string
  tipo: string
  posicoes: string[]
  status: 'Pendente' | 'Concluída'
}

/**
 * Agrupa reprovas por ocorrência (pmo|op|sn|posto|data/hora), agrega posições e
 * marca Concluída quando existe reparo casando com a ocorrência (posto de origem
 * + data/hora de origem). Ordenado da mais recente para a mais antiga.
 */
export function agruparPendencias(reprovas: ReprovaRow[], reparos: ReparoRow[]): Ocorrencia[] {
  const reparados = new Set(
    reparos
      .filter((r) => r.dataHoraOrigem !== null && r.dataHoraOrigem !== '')
      .map((r) => [r.pmo, r.op, r.snNorm, r.postoOrigem.toLowerCase(), r.dataHoraOrigem].join('|')),
  )

  const ocorrencias = new Map<string, Ocorrencia>()
  for (const r of reprovas) {
    const chave = [r.pmo, r.op, r.snNorm, r.posto.toLowerCase(), r.dataHora].join('|')
    let item = ocorrencias.get(chave)
    if (!item) {
      item = {
        dataHora: r.dataHora,
        cliente: r.cliente,
        pmo: r.pmo,
        op: r.op,
        sn: r.sn,
        posto: r.posto,
        cod: r.cod,
        tipo: r.tipo,
        posicoes: [],
        status: reparados.has(chave) ? 'Concluída' : 'Pendente',
      }
      ocorrencias.set(chave, item)
    }
    const pos = r.pos.trim()
    if (pos !== '' && !item.posicoes.includes(pos)) item.posicoes.push(pos)
    if (item.cod === '' && r.cod !== '') item.cod = r.cod
    if (item.tipo === '' && r.tipo !== '') item.tipo = r.tipo
  }

  return [...ocorrencias.values()].sort((a, b) => (a.dataHora < b.dataHora ? 1 : -1))
}
```

- [ ] **Step 5: Rodar (PASSA)** — os dois arquivos de teste.

- [ ] **Step 6: Commit**

```bash
git add src/modules/shopfloor/domain/lancamento-linhas.ts src/modules/shopfloor/domain/manutencao-pendencias.ts src/modules/shopfloor/domain/__tests__/
git commit -F - << 'EOF'
feat(shopfloor): domínio da manutenção (exigeManutencao + agrupamento de pendências) TDD

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 3: Repositório + actions + gate no Lançamento

**Files:**
- Create: `src/modules/shopfloor/infra/manutencao-repository.ts`
- Create: `src/modules/shopfloor/application/manutencao-actions.ts`
- Modify: `src/modules/shopfloor/infra/lancamento-repository.ts`
- Modify: `src/modules/shopfloor/application/lancar-action.ts`

**Interfaces:**
- Repo: `listarReprovasOrigem(): Promise<ReprovaRow[]>`; `listarReparos(): Promise<ReparoRow[]>`; `chamarSfRegistrarReparo(args): Promise<{ok, erro?, linhas?}>`.
- Actions: `listarOcorrencias(): Promise<{ok:true, ocorrencias: Ocorrencia[]} | {ok:false, erro}>`; `registrarReparo(entrada): Promise<{ok:true} | {ok:false, erro}>` com `entrada = { colaborador, ocorrencia: { pmo, op, sn, posto, dataHora, cod, pos, tipo }, consertos: { descricao, posicao }[] }`.
- `SfLancarArgs` += `p_exige_manutencao: boolean`; `lancar-action` passa `exigeManutencao(entrada.posto)` e mapeia `SEM_MANUTENCAO`.

- [ ] **Step 1: `manutencao-repository.ts`**

```ts
import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { ReprovaRow, ReparoRow } from '../domain/manutencao-pendencias'

const POSTOS_ORIGEM = ['Teste', 'Burn-in', 'Teste Final']

export async function listarReprovasOrigem(): Promise<ReprovaRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_registros')
    .select('data_hora,cliente,pmo,op,numero_serie,numero_serie_norm,posto,codigo_defeito,posicao,tipo_defeito')
    .in('posto', POSTOS_ORIGEM)
    .eq('status', 'Reprovado')
    .order('data_hora', { ascending: false })
  if (error) throw error
  return (data as {
    data_hora: string
    cliente: string
    pmo: string
    op: string
    numero_serie: string
    numero_serie_norm: string
    posto: string
    codigo_defeito: string
    posicao: string
    tipo_defeito: string
  }[]).map((r) => ({
    dataHora: r.data_hora,
    cliente: r.cliente,
    pmo: r.pmo,
    op: r.op,
    sn: r.numero_serie,
    snNorm: r.numero_serie_norm,
    posto: r.posto,
    cod: r.codigo_defeito,
    pos: r.posicao,
    tipo: r.tipo_defeito,
  }))
}

export async function listarReparos(): Promise<ReparoRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_registros')
    .select('pmo,op,numero_serie_norm,posto_origem,data_hora_origem')
    .eq('posto', 'Manutenção')
  if (error) throw error
  return (data as {
    pmo: string
    op: string
    numero_serie_norm: string
    posto_origem: string
    data_hora_origem: string | null
  }[]).map((r) => ({
    pmo: r.pmo,
    op: r.op,
    snNorm: r.numero_serie_norm,
    postoOrigem: r.posto_origem,
    dataHoraOrigem: r.data_hora_origem,
  }))
}

export interface SfRegistrarReparoArgs {
  p_colaborador: string
  p_pmo: string
  p_op: string
  p_cliente: string
  p_sn: string
  p_sn_norm: string
  p_cod: string
  p_pos: string
  p_tipo: string
  p_posto_origem: string
  p_data_hora_origem: string
  p_consertos: { descricao: string; posicao: string }[]
}

export async function chamarSfRegistrarReparo(
  args: SfRegistrarReparoArgs,
): Promise<{ ok: boolean; erro?: string; linhas?: number }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_registrar_reparo', args)
  if (error) return { ok: false, erro: 'ERRO_INTERNO' }
  return data as { ok: boolean; erro?: string; linhas?: number }
}
```

- [ ] **Step 2: `manutencao-actions.ts`**

```ts
'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { normalizarSerie, limparSerie } from '../domain/serie'
import { agruparPendencias, type Ocorrencia } from '../domain/manutencao-pendencias'
import { carregarOrdem } from '../infra/lancamento-repository'
import {
  listarReprovasOrigem,
  listarReparos,
  chamarSfRegistrarReparo,
} from '../infra/manutencao-repository'

const MENSAGENS: Record<string, string> = {
  SEM_PERMISSAO: 'Você não tem permissão para esta ação.',
  SEM_CONSERTOS: 'Informe ao menos um conserto.',
  ERRO_INTERNO: 'Não foi possível concluir a operação.',
}

export async function listarOcorrencias(): Promise<
  { ok: true; ocorrencias: Ocorrencia[] } | { ok: false; erro: string }
> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'lancar')) {
    return { ok: false, erro: MENSAGENS.SEM_PERMISSAO! }
  }
  try {
    const [reprovas, reparos] = await Promise.all([listarReprovasOrigem(), listarReparos()])
    return { ok: true, ocorrencias: agruparPendencias(reprovas, reparos) }
  } catch {
    return { ok: false, erro: MENSAGENS.ERRO_INTERNO! }
  }
}

export interface EntradaReparo {
  colaborador: string
  ocorrencia: { pmo: string; op: string; sn: string; posto: string; dataHora: string; cod: string; pos: string; tipo: string }
  consertos: { descricao: string; posicao: string }[]
}

export async function registrarReparo(
  entrada: EntradaReparo,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'lancar')) {
    return { ok: false, erro: MENSAGENS.SEM_PERMISSAO! }
  }

  const colaborador = entrada.colaborador.trim()
  const o = entrada.ocorrencia
  const consertos = entrada.consertos
    .map((c) => ({ descricao: c.descricao.trim(), posicao: c.posicao.trim() }))
    .filter((c) => c.descricao !== '')
  if (!colaborador) return { ok: false, erro: 'Informe o colaborador.' }
  if (!o.pmo || !o.op || !o.sn || !o.posto || !o.dataHora) {
    return { ok: false, erro: 'Ocorrência inválida.' }
  }
  if (consertos.length === 0) return { ok: false, erro: MENSAGENS.SEM_CONSERTOS! }

  const ordem = await carregarOrdem(o.pmo, o.op)

  const r = await chamarSfRegistrarReparo({
    p_colaborador: colaborador,
    p_pmo: o.pmo,
    p_op: o.op,
    p_cliente: ordem?.cliente ?? '',
    p_sn: limparSerie(o.sn),
    p_sn_norm: normalizarSerie(o.sn),
    p_cod: o.cod,
    p_pos: o.pos,
    p_tipo: o.tipo,
    p_posto_origem: o.posto,
    p_data_hora_origem: o.dataHora,
    p_consertos: consertos,
  })
  if (!r.ok) return { ok: false, erro: MENSAGENS[r.erro ?? 'ERRO_INTERNO'] ?? MENSAGENS.ERRO_INTERNO! }

  await registrarLog({
    entidade: 'sf_reparo',
    entidadeId: `${o.pmo}/${o.op}/${o.sn}`,
    acao: 'criar',
    descricao: `Reparo de ${o.sn} (${o.pmo}/${o.op}, origem ${o.posto}): ${consertos.length} conserto(s)`,
    dados: { ocorrencia: o, consertos },
  })
  return { ok: true }
}
```

- [ ] **Step 3: Gate no Lançamento**

(a) Em `lancamento-repository.ts`, na interface `SfLancarArgs`, adicionar ao final: `p_exige_manutencao: boolean`.

(b) Em `lancar-action.ts`:
- No import de `../domain/lancamento-linhas`, incluir `exigeManutencao`.
- Em `MENSAGENS`, adicionar: `SEM_MANUTENCAO: 'A peça reprovou e precisa passar pela Manutenção antes de ser lançada de novo.',`
- Na chamada `chamarSfLancar({...})`, adicionar: `p_exige_manutencao: exigeManutencao(entrada.posto),`

- [ ] **Step 4: Compila** — `npx tsc --noEmit` sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/modules/shopfloor/infra/manutencao-repository.ts src/modules/shopfloor/application/manutencao-actions.ts src/modules/shopfloor/infra/lancamento-repository.ts src/modules/shopfloor/application/lancar-action.ts
git commit -F - << 'EOF'
feat(shopfloor): repositório + actions da manutenção e gate SEM_MANUTENCAO no lançamento

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 4: Tela de Manutenção + item de menu

**Files:**
- Create: `src/app/(app)/shopfloor/manutencao/page.tsx`
- Create: `src/app/(app)/shopfloor/manutencao/manutencao-lista.tsx`
- Modify: `src/shared/ui/app-shell.tsx`

**Interfaces:**
- Consumes: `listarOcorrencias`, `registrarReparo`, `EntradaReparo` (Task 3); `Ocorrencia` (Task 2).

- [ ] **Step 1: `page.tsx`**

```tsx
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarReprovasOrigem, listarReparos } from '@/modules/shopfloor/infra/manutencao-repository'
import { agruparPendencias } from '@/modules/shopfloor/domain/manutencao-pendencias'
import { ManutencaoLista } from './manutencao-lista'

export default async function ManutencaoPage() {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'lancar')) {
    return <SemPermissao descricao="Você não tem permissão para acessar a Manutenção." />
  }

  const [reprovas, reparos] = await Promise.all([listarReprovasOrigem(), listarReparos()])
  const ocorrencias = agruparPendencias(reprovas, reparos)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Manutenção</h2>
        <p className="text-sm text-muted-foreground">
          Pendências de reparo (reprovas em Teste, Burn-in e Teste Final) e registro de conserto.
        </p>
      </div>
      <ManutencaoLista ocorrencias={ocorrencias} />
    </div>
  )
}
```

- [ ] **Step 2: `manutencao-lista.tsx`**

```tsx
'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Wrench, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { registrarReparo } from '@/modules/shopfloor/application/manutencao-actions'
import type { Ocorrencia } from '@/modules/shopfloor/domain/manutencao-pendencias'

interface Conserto {
  descricao: string
  posicao: string
}

export function ManutencaoLista({ ocorrencias }: { ocorrencias: Ocorrencia[] }) {
  const router = useRouter()
  const [fCliente, setFCliente] = useState('')
  const [fStatus, setFStatus] = useState('Pendente')
  const [fSn, setFSn] = useState('')
  const [alvo, setAlvo] = useState<Ocorrencia | null>(null)
  const [colaborador, setColaborador] = useState('')
  const [consertos, setConsertos] = useState<Conserto[]>([{ descricao: '', posicao: '' }])
  const [salvando, startTransition] = useTransition()

  const clientes = useMemo(() => [...new Set(ocorrencias.map((o) => o.cliente).filter(Boolean))], [ocorrencias])

  const filtradas = useMemo(
    () =>
      ocorrencias.filter((o) => {
        if (fCliente !== '' && o.cliente !== fCliente) return false
        if (fStatus !== '' && o.status !== fStatus) return false
        if (fSn.trim() !== '' && !o.sn.toLowerCase().includes(fSn.trim().toLowerCase())) return false
        return true
      }),
    [ocorrencias, fCliente, fStatus, fSn],
  )

  function abrirReparo(o: Ocorrencia) {
    setAlvo(o)
    setColaborador('')
    setConsertos([{ descricao: '', posicao: '' }])
  }

  const valido = colaborador.trim() !== '' && consertos.some((c) => c.descricao.trim() !== '')

  function onSalvar() {
    if (!alvo || !valido || salvando) return
    startTransition(async () => {
      const r = await registrarReparo({
        colaborador,
        ocorrencia: {
          pmo: alvo.pmo,
          op: alvo.op,
          sn: alvo.sn,
          posto: alvo.posto,
          dataHora: alvo.dataHora,
          cod: alvo.cod,
          pos: alvo.posicoes.join(', '),
          tipo: alvo.tipo,
        },
        consertos,
      })
      if (r.ok) {
        toast.success('Reparo registrado.')
        setAlvo(null)
        router.refresh()
      } else {
        toast.error(r.erro)
      }
    })
  }

  function fmtData(iso: string) {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR')
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filtros */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:max-w-2xl">
        <div className="flex flex-col gap-1.5">
          <Label>Cliente</Label>
          <Select value={fCliente} onValueChange={(v) => setFCliente(v ?? '')}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">Todos</SelectItem>
              {clientes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Status</Label>
          <Select value={fStatus} onValueChange={(v) => setFStatus(v ?? '')}>
            <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">Todas</SelectItem>
              <SelectItem value="Pendente">Pendentes</SelectItem>
              <SelectItem value="Concluída">Concluídas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fsn">Nº de Série</Label>
          <Input id="fsn" value={fSn} onChange={(e) => setFSn(e.target.value)} placeholder="Filtrar por SN" autoComplete="off" />
        </div>
      </div>

      {/* Lista */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>PMO/OP</TableHead>
              <TableHead>Nº de Série</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Defeito</TableHead>
              <TableHead>Posições</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtradas.map((o, i) => (
              <TableRow key={i}>
                <TableCell className="whitespace-nowrap">{fmtData(o.dataHora)}</TableCell>
                <TableCell>{o.cliente}</TableCell>
                <TableCell>{o.pmo}/{o.op}</TableCell>
                <TableCell className="font-medium">{o.sn}</TableCell>
                <TableCell>{o.posto}</TableCell>
                <TableCell className="max-w-[180px] truncate">{[o.cod, o.tipo].filter(Boolean).join(' · ') || '—'}</TableCell>
                <TableCell>{o.posicoes.join(', ') || '—'}</TableCell>
                <TableCell>
                  <span className={o.status === 'Pendente' ? 'font-medium text-red-600' : 'text-muted-foreground'}>
                    {o.status}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {o.status === 'Pendente' && (
                    <Button variant="outline" size="sm" onClick={() => abrirReparo(o)}>
                      <Wrench className="mr-1 size-4" /> Registrar reparo
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {filtradas.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                  Nenhuma ocorrência encontrada.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Dialog de reparo */}
      <Dialog open={alvo !== null} onOpenChange={(aberto) => { if (!aberto) setAlvo(null) }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar reparo</DialogTitle>
          </DialogHeader>
          {alvo && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                {alvo.sn} · {alvo.pmo}/{alvo.op} · reprovada em <b>{alvo.posto}</b> em {fmtData(alvo.dataHora)}
                {alvo.posicoes.length > 0 && <> · posições: {alvo.posicoes.join(', ')}</>}
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="colabRep">Colaborador</Label>
                <Input id="colabRep" value={colaborador} onChange={(e) => setColaborador(e.target.value)} autoComplete="off" />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Consertos</Label>
                {consertos.map((c, i) => (
                  <div key={i} className="grid grid-cols-[1fr_120px_auto] items-center gap-2">
                    <Input value={c.descricao} onChange={(e) => setConsertos(consertos.map((x, idx) => (idx === i ? { ...x, descricao: e.target.value } : x)))} placeholder="Descrição do conserto" />
                    <Input value={c.posicao} onChange={(e) => setConsertos(consertos.map((x, idx) => (idx === i ? { ...x, posicao: e.target.value } : x)))} placeholder="Posição" />
                    <button type="button" aria-label={`Remover conserto ${i + 1}`} onClick={() => setConsertos(consertos.length > 1 ? consertos.filter((_, idx) => idx !== i) : consertos)} disabled={consertos.length <= 1} className="text-muted-foreground hover:text-red-600 disabled:opacity-30">
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => setConsertos([...consertos, { descricao: '', posicao: '' }])} className="self-start text-sm font-medium text-enterplak hover:underline">
                  <Plus className="mr-1 inline size-4" /> Adicionar conserto
                </button>
              </div>
              <DialogFooter>
                <Button onClick={onSalvar} disabled={!valido || salvando} className="bg-enterplak hover:bg-enterplak-700">
                  {salvando ? 'Salvando…' : 'Concluir reparo'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 3: Item de menu** — em `app-shell.tsx`, adicionar `Wrench` aos imports de `lucide-react` e, no array `SHOPFLOOR`, entre `integracao` e `op-ordens`:

```ts
  { chave: 'manutencao', rotulo: 'Manutenção', href: '/shopfloor/manutencao', icone: Wrench, perm: 'lancar' },
```

- [ ] **Step 4: Compila + lint** — `npx tsc --noEmit` sem erros; `npm run lint` sem erros novos. Obs: se o `SelectItem` com `value=""` causar problema visual/de runtime no base-ui, trocar o valor sentinel de "Todos/Todas" para `'__todos__'` e mapear (`v === '__todos__' ? '' : v`) — ajuste mínimo permitido.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/shopfloor/manutencao/ src/shared/ui/app-shell.tsx
git commit -F - << 'EOF'
feat(shopfloor): tela de Manutenção (pendências + registro de reparo) + item de menu

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 5: Doc de regras + verificação + review amplo + 0033 no Dev + smoke + push (controller)

**Files:** `docs/regras-de-negocio-shopfloor.md` (controller atualiza).

- [ ] **Step 1 (CONTROLLER): atualizar o doc de regras** — regra 5 do Lançamento (gate ATIVO: Teste/Burn-in/Teste Final exigem reparo após a reprova; SMD/PTH inline), nova seção "Regras da Manutenção", e mover o item do backlog p/ implementado.
- [ ] **Step 2: Suíte** — verde.
- [ ] **Step 3 (CONTROLLER): review amplo** — foco: sf_lancar v2 (o gate não pode quebrar os fluxos existentes), agrupamento de ocorrências, coerência TS↔SQL.
- [ ] **Step 4 (CONTROLLER): aplicar 0033 no Dev + smoke via script** — reprovar no Teste → pendência aparece → re-lançar barra (SEM_MANUTENCAO) → registrar reparo (2 consertos) → ocorrência Concluída → re-lançar libera → SMD reprovada re-lança direto (sem manutenção) e NÃO aparece na lista.
- [ ] **Step 5 (CONTROLLER): push** → preview.

---

## Notas de verificação (self-review)

- **Cobertura da spec:** colunas + RPC + sf_lancar v2 (T1) ✅; exigeManutencao + agrupamento TDD (T2) ✅; repo/actions + gate no lancar-action (T3) ✅; tela com filtros + dialog de consertos + menu (T4) ✅; doc de regras + smoke (T5) ✅. Origem = Teste/Burn-in/Teste Final ✅; SMD/PTH fora ✅.
- **Compatibilidade:** `p_exige_manutencao` tem DEFAULT false → chamadas antigas do RPC não quebram; o TS passa o flag explícito.
- **Casamento ocorrência↔reparo:** TS usa igualdade de string ISO (`dataHoraOrigem === dataHora`, ambos vindos do mesmo PostgREST); o gate no SQL usa `data_hora > v_ultima_data` (reparo posterior à última reprova) — critérios distintos e ambos corretos para seus fins (lista vs gate).
- **Tipos:** `Ocorrencia`/`ReprovaRow`/`ReparoRow` compartilhados domínio↔repo↔tela; `SfRegistrarReparoArgs` = 12 params com nomes exatos do RPC.
- **Sem placeholders**; único ajuste condicional é o sentinel do Select (T4 Step 4, instrução exata).
- **Fora de escopo:** Pesquisa/Grade, Dashboard; `manut_buscarSN` (coberto pelo filtro de SN).
