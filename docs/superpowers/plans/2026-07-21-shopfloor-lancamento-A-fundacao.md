# ShopFloor Lançamento — Plano A: Fundação de dados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Criar a fundação de dados do módulo ShopFloor Processo (tabelas + RLS + permissão `lancar` + catálogo de postos) e o domínio puro (parse/faixa de SN, gate de sequência, regras por posto) com TDD, + migrar defeitos e OPs ativas da planilha. Sem UI ainda.

**Architecture:** Tabelas `sf_*` no Postgres (RLS via `tem_permissao`), espelhando o modelo do Apps Script mas normalizado (aplicabilidade em tabela, uma tabela de registros com coluna `cliente` no lugar de 18 abas). Domínio puro portado do `Código.gs`. Migração de dados por script lendo o xlsx.

**Tech Stack:** Supabase (Postgres 17 + RLS), TypeScript strict (`noUncheckedIndexedAccess`), Vitest, SheetJS (`xlsx`) para o script de migração.

## Global Constraints

- **Branch:** `feat/shopfloor-lancamento`. **Sub-features seguintes** (Cadastro de OP, Lançamento) são planos B e C.
- **Fluxo Dev × Prod:** a migração `0028` é aplicada pelo **controller no Dev primeiro** (banco antes do código). Subagentes NÃO aplicam migração nem dão push.
- **Confiar nos índices do `Código.gs`** (comportamento em produção), NÃO nos rótulos do header do xlsx — em especial a coluna **[18] = Inspeção SPI** (o header rotula "Integração" por engano). Aplicabilidade por índice: [9] Inspeção SMD, [10] Inspeção PTH, [11] Teste, [12] Teste Final, [13] Inspeção Final, [14] Embalagem, [15] Inspeção NQA, [16] Integração, [17] Inicial, [18] Inspeção SPI, [19] Montagem PTH.
- **OP "ativa"** = `Status` (col [6]) ≠ `FINALIZADA` (case-insensitive; blank conta como ativa).
- TS strict `noUncheckedIndexedAccess`. Trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit via heredoc. **Sem push.**
- Verificação: `npx tsc --noEmit && npm run lint && npm run test`.

## File Structure

- Create: `supabase/migrations/0028_shopfloor_fundacao.sql`
- Create: `src/modules/shopfloor/domain/serie.ts` + `__tests__/serie.test.ts`
- Create: `src/modules/shopfloor/domain/postos.ts` + `__tests__/postos.test.ts`
- Create: `src/modules/shopfloor/domain/regras-lancamento.ts` + `__tests__/regras-lancamento.test.ts`
- Create: `scripts/migrar-shopfloor.mjs` (script único de migração de dados; não é código do app)

---

### Task 1: Migração 0028 — tabelas, RLS, permissão `lancar`, seed de postos

**Files:**
- Create: `supabase/migrations/0028_shopfloor_fundacao.sql`

- [ ] **Step 1: Escrever a migração**

`supabase/migrations/0028_shopfloor_fundacao.sql`:

```sql
-- =============================================================
-- ShopFloor Processo — Fundação de dados
-- Tabelas: sf_postos, sf_defeitos, sf_ordens, sf_ordem_postos, sf_registros.
-- + permissão `lancar` (operador de produção). SEM dados de OP/defeito aqui
-- (a migração de dados da planilha é um script à parte).
-- =============================================================

-- ---------- Permissão nova: lancar ----------
alter table public.perfis add column pode_lancar boolean not null default false;

create or replace function public.tem_permissao(perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case perm
      when 'visualizar'         then p.pode_visualizar
      when 'importar'           then p.pode_importar
      when 'editar'             then p.pode_editar
      when 'finalizar'          then p.pode_finalizar
      when 'editar_finalizado'  then p.pode_editar_finalizado
      when 'excluir'            then p.pode_excluir
      when 'gerar_etiqueta'     then p.pode_gerar_etiqueta
      when 'administrar'        then p.pode_administrar
      when 'lancar'             then p.pode_lancar
      else false
    end
    from public.usuarios u
    join public.perfis p on p.id = u.perfil_id
    where u.id = auth.uid() and u.ativo
  ), false);
$$;

-- Admin e Supervisor ganham lancar; novo perfil de sistema "Produção" (visualizar + lancar).
update public.perfis set pode_lancar = true where nome in ('Administrador', 'Supervisor');
insert into public.perfis (nome, pode_visualizar, pode_lancar, sistema)
values ('Produção', true, true, true)
on conflict (nome) do nothing;

-- ---------- Catálogo de postos ----------
create table public.sf_postos (
  chave text primary key,          -- ex.: 'Inicial'
  ordem int not null,              -- posição no fluxo
  created_at timestamptz not null default now()
);
alter table public.sf_postos enable row level security;
create policy sf_postos_select on public.sf_postos for select using (tem_permissao('visualizar'));

insert into public.sf_postos (chave, ordem) values
  ('Inicial', 1), ('Inspeção SPI', 2), ('Inspeção SMD', 3), ('Montagem PTH', 4),
  ('Inspeção PTH', 5), ('Teste', 6), ('Integração', 7), ('Teste Final', 8),
  ('Inspeção Final', 9), ('Embalagem', 10), ('Inspeção NQA', 11), ('Manutenção', 12);

-- ---------- Catálogo de defeitos ----------
create table public.sf_defeitos (
  codigo text primary key,         -- ex.: '1002 TRILHA ROMPIDA'
  tipo smallint not null,          -- 1 (peça) | 2 (teste)
  created_at timestamptz not null default now()
);
alter table public.sf_defeitos enable row level security;
create policy sf_defeitos_select on public.sf_defeitos for select using (tem_permissao('visualizar'));
create policy sf_defeitos_admin  on public.sf_defeitos for all using (tem_permissao('administrar')) with check (tem_permissao('administrar'));

-- ---------- Ordens (PMO/OP) ----------
create table public.sf_ordens (
  id uuid primary key default gen_random_uuid(),
  pmo text not null,
  op text not null,
  cliente text not null,
  qtd int,
  descricao text not null default '',
  acp text not null default '',
  status text not null default '',
  sn_ini text not null default '',
  sn_fim text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pmo, op)
);
alter table public.sf_ordens enable row level security;
create policy sf_ordens_select on public.sf_ordens for select using (tem_permissao('visualizar'));
create policy sf_ordens_admin  on public.sf_ordens for all using (tem_permissao('administrar')) with check (tem_permissao('administrar'));

-- ---------- Aplicabilidade de postos por ordem ----------
create table public.sf_ordem_postos (
  ordem_id uuid not null references public.sf_ordens(id) on delete cascade,
  posto text not null references public.sf_postos(chave),
  primary key (ordem_id, posto)
);
alter table public.sf_ordem_postos enable row level security;
create policy sf_ordem_postos_select on public.sf_ordem_postos for select using (tem_permissao('visualizar'));
create policy sf_ordem_postos_admin  on public.sf_ordem_postos for all using (tem_permissao('administrar')) with check (tem_permissao('administrar'));

-- ---------- Registros (o coração: SN × posto) ----------
create table public.sf_registros (
  id uuid primary key default gen_random_uuid(),
  data_hora timestamptz not null default now(),
  colaborador text not null default '',
  posto text not null,
  pmo text not null,
  op text not null,
  cliente text not null default '',
  numero_caixa text not null default '',
  qtd_por_caixa int,
  status text not null default '',
  numero_serie text not null default '',
  numero_serie_norm text not null default '',   -- normalizado p/ comparação/duplicidade
  codigo_defeito text not null default '',
  posicao text not null default '',
  tipo_defeito text not null default '',
  nqa_visual text not null default '',
  nqa_funcional text not null default '',
  created_at timestamptz not null default now()
);
alter table public.sf_registros enable row level security;
create policy sf_registros_select on public.sf_registros for select using (tem_permissao('visualizar'));
create policy sf_registros_insert on public.sf_registros for insert with check (tem_permissao('lancar'));
-- registro é imutável na fase 1 (sem update/delete via app).

create index sf_registros_ordem_sn on public.sf_registros (pmo, op, numero_serie_norm);
create index sf_registros_caixa    on public.sf_registros (pmo, op, posto, numero_caixa);
```

- [ ] **Step 2: Verificar o SQL (sintaxe, sem aplicar)**

Run: `grep -c "create table" supabase/migrations/0028_shopfloor_fundacao.sql`
Expected: `5` (as 5 tabelas sf_*). O controller aplica no Dev depois do review.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0028_shopfloor_fundacao.sql
git commit -F - << 'EOF'
feat(shopfloor): migração 0028 — fundação (tabelas sf_*, RLS, permissão lancar)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 2: Domínio `serie` (TDD) — parse / normalização / faixa de SN

**Files:**
- Create: `src/modules/shopfloor/domain/serie.ts`
- Create: `src/modules/shopfloor/domain/__tests__/serie.test.ts`

**Interfaces:**
- Produces: `normalizarSerie(sn)`, `limparSerie(sn)`, `partesSerie(sn): { limpo; prefixo; num; sufixo; largura }`, `serieDentroDaFaixa(snIni, snFim, serie): boolean`.

- [ ] **Step 1: Testes (falham)**

`src/modules/shopfloor/domain/__tests__/serie.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizarSerie, limparSerie, partesSerie, serieDentroDaFaixa } from '../serie'

describe('normalizarSerie', () => {
  it('remove separadores, zeros à esquerda e caixa', () => {
    expect(normalizarSerie('00-25 7891/001')).toBe('257891001'.replace(/^0+/, ''))
    expect(normalizarSerie('AB007')).toBe('ab007'.replace(/^0+/, '')) // sem zeros no meio de letras
  })
})

describe('limparSerie', () => {
  it('remove separadores mas mantém zeros à esquerda', () => {
    expect(limparSerie('00-25.7891/001')).toBe('00257891001')
  })
})

describe('partesSerie', () => {
  it('separa prefixo/dígitos/sufixo', () => {
    expect(partesSerie('AB0123C')).toEqual({ limpo: 'AB0123C', prefixo: 'AB', num: 123, sufixo: 'C', largura: 4 })
  })
  it('num = NaN quando não há bloco único de dígitos', () => {
    expect(partesSerie('12AB34').num).toBeNaN()
  })
})

describe('serieDentroDaFaixa', () => {
  it('numérica dentro/fora', () => {
    expect(serieDentroDaFaixa('2576940001', '2576940301', '2576940050')).toBe(true)
    expect(serieDentroDaFaixa('2576940001', '2576940301', '2576940999')).toBe(false)
  })
  it('exige mesmo prefixo e sufixo', () => {
    expect(serieDentroDaFaixa('A100C', 'A200C', 'B150C')).toBe(false) // prefixo diferente
    expect(serieDentroDaFaixa('A100C', 'A200C', 'A150D')).toBe(false) // sufixo diferente
    expect(serieDentroDaFaixa('A100C', 'A200C', 'A150C')).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar (FALHA)**

Run: `npm run test -- shopfloor/domain/__tests__/serie`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

`src/modules/shopfloor/domain/serie.ts`:

```ts
/** Normaliza SN para COMPARAÇÃO/duplicidade (sem separadores, sem zeros à esquerda, minúsculo). */
export function normalizarSerie(sn: string): string {
  return (sn ?? '').toString().replace(/[^A-Za-z0-9]/g, '').replace(/^0+/, '').trim().toLowerCase()
}

/** Limpa SN para SALVAR (sem separadores, MANTÉM zeros à esquerda). */
export function limparSerie(sn: string): string {
  return (sn ?? '').toString().replace(/[^A-Za-z0-9]/g, '').trim()
}

export interface PartesSerie {
  limpo: string
  prefixo: string
  num: number
  sufixo: string
  largura: number
}

/** Interpreta o SN como [letras?][dígitos][letras?] — um único bloco de dígitos. */
export function partesSerie(sn: string): PartesSerie {
  const limpo = (sn ?? '').toString().replace(/[^A-Za-z0-9]/g, '').trim()
  const m = limpo.match(/^([A-Za-z]*)(\d+)([A-Za-z]*)$/)
  if (!m) return { limpo, prefixo: '', num: NaN, sufixo: '', largura: 0 }
  return { limpo, prefixo: m[1]!, num: parseInt(m[2]!, 10), sufixo: m[3]!, largura: m[2]!.length }
}

/**
 * Faixa de SN: numérica quando início/fim/alvo têm bloco de dígitos (com prefixo e sufixo
 * casando), senão comparação lexical. Prefixo/sufixo divergentes → fora da faixa.
 */
export function serieDentroDaFaixa(snIni: string, snFim: string, serie: string): boolean {
  const a = partesSerie(snIni)
  const b = partesSerie(snFim)
  const x = partesSerie(serie)
  if (!Number.isNaN(a.num) && !Number.isNaN(b.num) && !Number.isNaN(x.num)) {
    const lc = (s: string) => s.toLowerCase()
    if (lc(a.prefixo) !== lc(b.prefixo) || lc(a.sufixo) !== lc(b.sufixo)) return false
    if (lc(x.prefixo) !== lc(a.prefixo) || lc(x.sufixo) !== lc(a.sufixo)) return false
    const min = Math.min(a.num, b.num)
    const max = Math.max(a.num, b.num)
    return x.num >= min && x.num <= max
  }
  const s1 = a.limpo, s2 = b.limpo, sx = x.limpo
  const lo = s1 < s2 ? s1 : s2
  const hi = s1 > s2 ? s1 : s2
  return sx >= lo && sx <= hi
}
```

- [ ] **Step 4: Rodar (PASSA)**

Run: `npm run test -- shopfloor/domain/__tests__/serie`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/shopfloor/domain/serie.ts src/modules/shopfloor/domain/__tests__/serie.test.ts
git commit -F - << 'EOF'
feat(shopfloor): domínio de Nº de Série (parse/normalização/faixa) com TDD

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 3: Domínio `postos` (gate de sequência) + `regras-lancamento` (obrigatórios/caixa) — TDD

**Files:**
- Create: `src/modules/shopfloor/domain/postos.ts` + `__tests__/postos.test.ts`
- Create: `src/modules/shopfloor/domain/regras-lancamento.ts` + `__tests__/regras-lancamento.test.ts`

**Interfaces:**
- Produces:
  - `ORDEM_FLUXO_POSTOS: string[]`; `postoAnteriorExigido(postoAtual, aplicavel: (posto: string) => boolean): string | null`.
  - `SnapshotPosto = { registrado?: boolean; aprovado?: boolean }`; `gateSatisfeito(prevPosto, postos: Record<string, SnapshotPosto>): boolean`.
  - `obrigatoriosPorPosto(posto, dados): { ok: true } | { ok: false; erro: string }` e `caixaCheia(count, limite): boolean`.

- [ ] **Step 1: Testes `postos` (falham)**

`src/modules/shopfloor/domain/__tests__/postos.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { postoAnteriorExigido, gateSatisfeito } from '../postos'

const todosAplicaveis = () => true

describe('postoAnteriorExigido', () => {
  it('Manutenção não exige anterior', () => {
    expect(postoAnteriorExigido('Manutenção', todosAplicaveis)).toBeNull()
  })
  it('Inicial (primeiro) não exige anterior', () => {
    expect(postoAnteriorExigido('Inicial', todosAplicaveis)).toBeNull()
  })
  it('Teste exige o posto anterior aplicável', () => {
    expect(postoAnteriorExigido('Teste', todosAplicaveis)).toBe('Inspeção PTH')
  })
  it('pula os postos não-aplicáveis para trás', () => {
    const aplic = (p: string) => p !== 'Inspeção PTH' && p !== 'Inspeção SMD' && p !== 'Montagem PTH'
    expect(postoAnteriorExigido('Teste', aplic)).toBe('Inspeção SPI')
  })
})

describe('gateSatisfeito', () => {
  it('Inicial/Integração/Embalagem: basta registrado', () => {
    expect(gateSatisfeito('Inicial', { Inicial: { registrado: true } })).toBe(true)
    expect(gateSatisfeito('Inicial', {})).toBe(false)
  })
  it('NQA e demais: exige aprovado', () => {
    expect(gateSatisfeito('Teste', { Teste: { registrado: true } })).toBe(false)
    expect(gateSatisfeito('Teste', { Teste: { aprovado: true } })).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar (FALHA)** — `npm run test -- shopfloor/domain/__tests__/postos` → FAIL.

- [ ] **Step 3: Implementar `postos.ts`**

`src/modules/shopfloor/domain/postos.ts`:

```ts
/** Ordem lógica do fluxo (do Código.gs POSTO_FLOW_ORDER). Manutenção é fora do fluxo. */
export const ORDEM_FLUXO_POSTOS = [
  'Inicial', 'Inspeção SPI', 'Inspeção SMD', 'Montagem PTH', 'Inspeção PTH', 'Teste',
  'Integração', 'Teste Final', 'Inspeção Final', 'Embalagem', 'Inspeção NQA', 'Manutenção',
] as const

/** Posto anterior aplicável que precisa estar concluído antes do posto atual (ou null). */
export function postoAnteriorExigido(
  postoAtual: string,
  aplicavel: (posto: string) => boolean,
): string | null {
  if (/^manuten[çc][aã]o$/i.test(postoAtual)) return null
  const seq = ORDEM_FLUXO_POSTOS
  const idx = seq.findIndex((p) => p.toLowerCase() === postoAtual.toLowerCase())
  if (idx <= 0) return null
  for (let j = idx - 1; j >= 0; j--) {
    const cand = seq[j]!
    if (cand === 'Manutenção') continue
    if (aplicavel(cand)) return cand
  }
  return null
}

export interface SnapshotPosto {
  registrado?: boolean
  aprovado?: boolean
}

/** O gate do posto anterior está satisfeito? (registrado p/ Inicial/Montagem/Integração/Embalagem; aprovado p/ NQA e demais). */
export function gateSatisfeito(prevPosto: string, postos: Record<string, SnapshotPosto>): boolean {
  const key = prevPosto.toLowerCase()
  const flags = postos[prevPosto] ?? postos[key] ?? {}
  if (['inicial', 'montagem pth', 'integração', 'integracao', 'embalagem'].includes(key)) {
    return flags.registrado === true
  }
  return flags.aprovado === true
}
```

- [ ] **Step 4: Rodar (PASSA)** — `npm run test -- shopfloor/domain/__tests__/postos` → PASS.

- [ ] **Step 5: Testes `regras-lancamento` (falham)**

`src/modules/shopfloor/domain/__tests__/regras-lancamento.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { obrigatoriosPorPosto, caixaCheia } from '../regras-lancamento'

const base = { colaborador: 'x', pmo: 'P', op: 'O', numeroSerie: 'S1' }

describe('obrigatoriosPorPosto', () => {
  it('Inicial: exige campos base', () => {
    expect(obrigatoriosPorPosto('Inicial', base).ok).toBe(true)
    expect(obrigatoriosPorPosto('Inicial', { ...base, numeroSerie: '' }).ok).toBe(false)
  })
  it('Embalagem: exige caixa e limite', () => {
    expect(obrigatoriosPorPosto('Embalagem', base).ok).toBe(false)
    expect(obrigatoriosPorPosto('Embalagem', { ...base, numeroCaixa: 'C1', limiteCaixa: '10' }).ok).toBe(true)
  })
  it('NQA: exige visual e funcional', () => {
    expect(obrigatoriosPorPosto('Inspeção NQA', base).ok).toBe(false)
    expect(obrigatoriosPorPosto('Inspeção NQA', { ...base, nqaVisual: 'Aprovado', nqaFuncional: 'Aprovado' }).ok).toBe(true)
  })
  it('Teste reprovado: exige código, posição e tipo', () => {
    expect(obrigatoriosPorPosto('Teste', { ...base, status: 'Reprovado' }).ok).toBe(false)
    expect(obrigatoriosPorPosto('Teste', { ...base, status: 'Reprovado', cod: 'D', pos: 'R1', tipo: 'SMD' }).ok).toBe(true)
  })
})

describe('caixaCheia', () => {
  it('true quando count >= limite', () => {
    expect(caixaCheia(10, 10)).toBe(true)
    expect(caixaCheia(9, 10)).toBe(false)
    expect(caixaCheia(5, null)).toBe(false)
  })
})
```

- [ ] **Step 6: Rodar (FALHA)** — `npm run test -- shopfloor/domain/__tests__/regras-lancamento` → FAIL.

- [ ] **Step 7: Implementar `regras-lancamento.ts`**

`src/modules/shopfloor/domain/regras-lancamento.ts`:

```ts
export interface DadosLancamento {
  colaborador?: string
  posto?: string
  pmo?: string
  op?: string
  numeroSerie?: string
  status?: string
  numeroCaixa?: string
  limiteCaixa?: string
  nqaVisual?: string
  nqaFuncional?: string
  cod?: string
  pos?: string
  tipo?: string
}

export type ResultadoRegra = { ok: true } | { ok: false; erro: string }

const vazio = (v: string | undefined) => !v || String(v).trim() === ''

/** Obrigatórios por posto — portado do Código.gs `_enviarFormularioComContagem_`. */
export function obrigatoriosPorPosto(posto: string, d: DadosLancamento): ResultadoRegra {
  const p = (posto || '').toLowerCase()
  const base = !vazio(d.colaborador) && !vazio(d.pmo) && !vazio(d.op) && !vazio(d.numeroSerie)

  if (p === 'inicial' || p === 'montagem pth') {
    return base ? { ok: true } : { ok: false, erro: 'Preencha Colaborador, PMO, OP e Nº de Série.' }
  }
  if (p === 'embalagem') {
    return base && !vazio(d.numeroCaixa) && !vazio(d.limiteCaixa)
      ? { ok: true }
      : { ok: false, erro: 'Para Embalagem, preencha Colaborador, PMO, OP, Nº da Caixa, QTD por caixa e Nº de Série.' }
  }
  if (p === 'inspeção nqa') {
    return base && !vazio(d.nqaVisual) && !vazio(d.nqaFuncional)
      ? { ok: true }
      : { ok: false, erro: 'Para Inspeção NQA, preencha Nº de Série, Inspeção Visual e Funcional.' }
  }
  if (p === 'inspeção spi') {
    if (!base || vazio(d.status)) return { ok: false, erro: 'Para Inspeção SPI, preencha Nº de Série e Status.' }
    if (d.status!.toLowerCase() === 'reprovado' && vazio(d.pos)) {
      return { ok: false, erro: 'Para Inspeção SPI reprovada, informe ao menos uma posição.' }
    }
    return { ok: true }
  }
  // Demais postos
  if (!base || vazio(d.status)) return { ok: false, erro: 'Preencha Colaborador, PMO, OP, Nº de Série e Status.' }
  if (d.status!.toLowerCase() === 'reprovado' && (vazio(d.cod) || vazio(d.pos) || vazio(d.tipo))) {
    return { ok: false, erro: 'Para reprovado, preencha código, posição e tipo do defeito.' }
  }
  return { ok: true }
}

/** A caixa está cheia? (count = peças já na caixa; limite null = sem limite). */
export function caixaCheia(count: number, limite: number | null): boolean {
  if (limite === null || Number.isNaN(limite)) return false
  return count >= limite
}
```

- [ ] **Step 8: Rodar (PASSA)** — `npm run test -- shopfloor/domain/__tests__/regras-lancamento` → PASS.

- [ ] **Step 9: Commit**

```bash
git add src/modules/shopfloor/domain/postos.ts src/modules/shopfloor/domain/regras-lancamento.ts src/modules/shopfloor/domain/__tests__/postos.test.ts src/modules/shopfloor/domain/__tests__/regras-lancamento.test.ts
git commit -F - << 'EOF'
feat(shopfloor): domínio de postos (gate de sequência) e regras de lançamento (TDD)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 4: Script de migração de dados (defeitos + OPs ativas da planilha)

**Files:**
- Create: `scripts/migrar-shopfloor.mjs`

**Interfaces:**
- Consome: `ShopFloor WebApp.xlsx` (raiz) via `xlsx`; escreve no banco via REST (service_role do `.env.local`).

- [ ] **Step 1: Escrever o script**

`scripts/migrar-shopfloor.mjs` — lê a planilha e insere via PostgREST. Aplicabilidade pelos ÍNDICES do Código.gs (col [18] = Inspeção SPI). Ordens ativas = Status ≠ FINALIZADA.

```js
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'

function env(path) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}
const e = env('.env.local')
const URL = e.NEXT_PUBLIC_SUPABASE_URL
const KEY = e.SUPABASE_SERVICE_ROLE_KEY

async function post(table, rows, prefer = 'return=minimal') {
  if (!rows.length) return
  for (let i = 0; i < rows.length; i += 500) {
    const lote = rows.slice(i, i + 500)
    const res = await fetch(`${URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: prefer },
      body: JSON.stringify(lote),
    })
    if (!res.ok) throw new Error(`POST ${table}: ${res.status} ${await res.text()}`)
  }
}

const wb = XLSX.read(readFileSync('ShopFloor WebApp.xlsx'), { type: 'buffer' })
const s = (v) => (v ?? '').toString().trim()
const yes = (v) => ['sim', 's', 'yes', 'y', '1', 'true', 'x'].includes(s(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())

// ---- Defeitos ----
const defRows = XLSX.utils.sheet_to_json(wb.Sheets['Defeitos'], { header: 1, defval: '' }).slice(1)
const defeitos = []
const vistos = new Set()
for (const r of defRows) {
  const codigo = s(r[0]); const tipo = parseInt(s(r[1]), 10)
  if (!codigo || vistos.has(codigo) || (tipo !== 1 && tipo !== 2)) continue
  vistos.add(codigo); defeitos.push({ codigo, tipo })
}
await post('sf_defeitos', defeitos)
console.log(`defeitos: ${defeitos.length}`)

// ---- Ordens ativas + aplicabilidade ----
// Índices de aplicabilidade (Código.gs, NÃO os rótulos do header):
const APLIC = {
  'Inspeção SMD': 9, 'Inspeção PTH': 10, 'Teste': 11, 'Teste Final': 12, 'Inspeção Final': 13,
  'Embalagem': 14, 'Inspeção NQA': 15, 'Integração': 16, 'Inicial': 17, 'Inspeção SPI': 18, 'Montagem PTH': 19,
}
const pmoRows = XLSX.utils.sheet_to_json(wb.Sheets['PMO_OPS'], { header: 1, defval: '' }).slice(1)
const ordens = []
const aplicPorChave = new Map() // 'pmo||op' -> [postos]
const chaveVista = new Set()
for (const r of pmoRows) {
  const pmo = s(r[0]); const op = s(r[1])
  if (!pmo || !op) continue
  if (s(r[6]).toUpperCase() === 'FINALIZADA') continue // só ativas
  const chave = `${pmo}||${op}`
  if (chaveVista.has(chave)) continue
  chaveVista.add(chave)
  ordens.push({
    pmo, op, cliente: s(r[5]), qtd: parseInt(s(r[2]), 10) || null,
    descricao: s(r[3]), acp: s(r[4]), status: s(r[6]),
    sn_ini: s(r[7]), sn_fim: s(r[8]),
  })
  const postos = Object.entries(APLIC).filter(([, idx]) => yes(r[idx])).map(([p]) => p)
  aplicPorChave.set(chave, postos)
}
// insere ordens devolvendo id, e depois a aplicabilidade
const res = await fetch(`${URL}/rest/v1/sf_ordens`, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify(ordens),
})
if (!res.ok) throw new Error(`POST sf_ordens: ${res.status} ${await res.text()}`)
const criadas = await res.json()
console.log(`ordens ativas: ${criadas.length}`)

const ordemPostos = []
for (const o of criadas) {
  const postos = aplicPorChave.get(`${o.pmo}||${o.op}`) || []
  for (const posto of postos) ordemPostos.push({ ordem_id: o.id, posto })
}
await post('sf_ordem_postos', ordemPostos)
console.log(`ordem_postos: ${ordemPostos.length}`)
```

- [ ] **Step 2: NÃO rodar o script aqui** — ele depende da migração 0028 estar aplicada no Dev (Task 5, controller). Só CRIAR o arquivo.

- [ ] **Step 3: Commit**

```bash
git add scripts/migrar-shopfloor.mjs
git commit -F - << 'EOF'
feat(shopfloor): script de migração de dados (defeitos + OPs ativas da planilha)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 5: Verificação final + aplicação (controller)

**Files:** nenhum.

- [ ] **Step 1: Suite**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: tudo verde; único warning aceitável `<img>` pré-existente.

- [ ] **Step 2 (CONTROLLER): aplicar 0028 no Dev + rodar a migração de dados**

O controller: `supabase link` no Dev (se preciso) → aplica `0028` no **Dev** → recarrega schema → roda `node scripts/migrar-shopfloor.mjs` (aponta pro Dev via `.env.local`) → confere: `select count(*) from sf_defeitos;`, `select count(*) from sf_ordens;`, e spot-check da aplicabilidade de uma OP conhecida contra o sistema atual (validar a col [18] = Inspeção SPI). **Sem push** até o usuário validar; a promoção pro Prod é do controller depois (aplicar 0028 no Prod + rodar o script apontando pro Prod).

- [ ] **Step 3: NÃO push** — commits ficam locais; o usuário valida.

---

## Notas de verificação (self-review)

- **Cobertura da spec (fundação):** tabelas sf_* + RLS (T1) ✅; permissão `lancar` + perfil Produção (T1) ✅; catálogo de postos seed (T1) ✅; domínio parse/faixa de SN (T2), gate de sequência + regras por posto (T3) — TDD ✅; migração de defeitos + OPs ativas (T4) ✅; col [18]=Inspeção SPI respeitada (T4/constraints) ✅.
- **Tipos:** os domínios são puros e independentes; nenhuma dependência circular. `partesSerie` retorna `num: NaN` (não null) — consistente com o uso.
- **Sem placeholders:** todo passo traz o código; SQL/migração completos.
- **`noUncheckedIndexedAccess`:** `m[1]!/m[2]!/m[3]!` seguros (regex casou), `seq[j]!` seguro (índice do loop).
- **Fora deste plano (B/C):** repositórios de leitura, a action de submit (transacional), a tela de cadastro de OP e a tela de Lançamento.
