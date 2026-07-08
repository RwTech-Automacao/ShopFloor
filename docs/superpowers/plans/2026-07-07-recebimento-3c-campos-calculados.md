# ShopFloor Enterplak — Plano 3C: Recebimento (Campos Calculados) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar 5 campos do processo automáticos (atraso, divergência, crítico, amostral, responsável), com duas tabelas de referência configuráveis (Criticidade por Fornecedor, NQA).

**Architecture:** Domínio de cálculo puro/testado, compartilhado cliente↔servidor; recomputação autoritativa no servidor ao salvar; campos calculados somente-leitura no formulário; duas telas de configuração.

**Tech Stack:** Next.js 16 App Router + TS strict, Tailwind v4 + shadcn/Base UI, Supabase (Postgres/RLS), Vitest.

## Global Constraints

- pt-BR; TS strict (sem `any`); cor `enterplak`.
- Calculados: atraso=`diferenca_dias`(data_chegada−data_prevista, dias com sinal); divergencia=`diferenca_numerica`(quantidade_recebida−quantidade_pedido); critico=`lookup_fornecedor_critico`(Sim/Não); amostral=`tabela_nqa`(base quantidade_recebida); responsavel_contagem=`usuario_primeiro`(write-once).
- Tabelas de referência **configuráveis** (Admin); NQA já com faixas padrão (tamanho em branco).
- Servidor é autoritativo: `salvarProcesso` recomputa e sobrescreve os calculados; cliente só exibe.
- Entrada faltando/sem match → calculado nulo (não bloqueia salvar).
- Padrões existentes: Server Actions checam permissão (`getSessao`/`podeFazer`); `registrarLog`/`calcularDiff`; CRUD de config (ver `modules/listas`, `configuracoes/listas`); `CONFIG_NAV` (`src/shared/ui/config-nav.ts`).
- Spec: `docs/superpowers/specs/2026-07-07-recebimento-3c-campos-calculados-design.md`.

---

## Task 1: Migration 0010 — campos calculados + tabelas de referência

**Files:** Create `supabase/migrations/0010_campos_calculados.sql`

**Interfaces:** Produces: colunas `calculado`/`formula`/`formula_config` em `configuracao_campos` (+ seed dos 5); tabelas `criticidade_fornecedor` e `tabela_nqa` (+ seed das faixas) com RLS.

- [ ] **Step 1: Escrever a migration**

```sql
-- 1) configuracao_campos: metadados de cálculo
alter table public.configuracao_campos
  add column calculado boolean not null default false,
  add column formula text check (formula in
    ('diferenca_dias','diferenca_numerica','lookup_fornecedor_critico','tabela_nqa','usuario_primeiro')),
  add column formula_config jsonb not null default '{}'::jsonb;

update public.configuracao_campos set calculado=true, formula='diferenca_dias',
  formula_config='{"a":"data_chegada","b":"data_prevista"}'::jsonb where campo='atraso';
update public.configuracao_campos set calculado=true, formula='diferenca_numerica',
  formula_config='{"a":"quantidade_recebida","b":"quantidade_pedido"}'::jsonb where campo='divergencia';
update public.configuracao_campos set calculado=true, formula='lookup_fornecedor_critico',
  formula_config='{"campo":"fornecedor"}'::jsonb where campo='critico';
update public.configuracao_campos set calculado=true, formula='tabela_nqa',
  formula_config='{"campo":"quantidade_recebida"}'::jsonb where campo='amostral';
update public.configuracao_campos set calculado=true, formula='usuario_primeiro',
  formula_config='{}'::jsonb where campo='responsavel_contagem';

-- 2) Criticidade por Fornecedor
create table public.criticidade_fornecedor (
  id uuid primary key default gen_random_uuid(),
  fornecedor text not null unique,
  critico text not null,
  created_at timestamptz not null default now()
);
alter table public.criticidade_fornecedor enable row level security;
create policy criticidade_select on public.criticidade_fornecedor
  for select to authenticated using (true);
create policy criticidade_write on public.criticidade_fornecedor
  for all to authenticated using (public.tem_permissao('administrar')) with check (public.tem_permissao('administrar'));

-- 3) Tabela NQA (faixas de quantidade -> tamanho de amostra)
create table public.tabela_nqa (
  id uuid primary key default gen_random_uuid(),
  quantidade_min int not null,
  quantidade_max int,
  tamanho_amostra numeric,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.tabela_nqa enable row level security;
create policy nqa_select on public.tabela_nqa
  for select to authenticated using (true);
create policy nqa_write on public.tabela_nqa
  for all to authenticated using (public.tem_permissao('administrar')) with check (public.tem_permissao('administrar'));

insert into public.tabela_nqa (quantidade_min, quantidade_max, ordem) values
  (0,0,10),(1,1,20),(2,8,30),(9,15,40),(16,25,50),(26,50,60),(51,90,70),(91,150,80),
  (151,280,90),(281,500,100),(501,1200,110),(1201,3200,120),(3201,10000,130),
  (10001,35000,140),(35001,150000,150),(150001,500000,160),(500001,null,170);
```

- [ ] **Step 2: Aplicar e verificar**

`supabase db push` (com `SUPABASE_GO_BINARY` se necessário). Verificar:
`supabase db query --linked "select campo, formula from configuracao_campos where calculado order by campo;"` (5 linhas) e `"select count(*) from tabela_nqa;"` (17).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0010_campos_calculados.sql
git commit -m "feat(db): campos calculados em configuracao_campos + tabelas criticidade_fornecedor e NQA"
```

---

## Task 2: Domínio de cálculo (TS puro, TDD)

**Files:** Create `src/modules/recebimento/domain/calculos.ts` + `__tests__/calculos.test.ts`

**Interfaces:**
- Produces:
  - `diferencaDias(chegadaISO: string|null, previstaISO: string|null): number | null`
  - `diferencaNumerica(a: unknown, b: unknown): number | null`
  - `buscarCriticidade(fornecedor: string|null, tabela: {fornecedor:string;critico:string}[]): string | null`
  - `type FaixaNqa = { quantidadeMin: number; quantidadeMax: number|null; tamanhoAmostra: number|null }`
  - `buscarNqa(quantidade: unknown, tabela: FaixaNqa[]): number | null`
  - `type CampoCalc = { campo: string; formula: string|null; formulaConfig: Record<string,string> }`
  - `type ContextoCalculo = { criticidade: {fornecedor:string;critico:string}[]; nqa: FaixaNqa[]; usuarioAtual: string; valoresAtuais: Record<string, unknown> }`
  - `calcularCamposCalculados(valores: Record<string, unknown>, campos: CampoCalc[], ctx: ContextoCalculo): Record<string, string|number|null>`

- [ ] **Step 1: Escrever os testes**

```ts
import { describe, it, expect } from 'vitest'
import { diferencaDias, diferencaNumerica, buscarCriticidade, buscarNqa, calcularCamposCalculados } from '../calculos'

describe('diferencaDias', () => {
  it('positivo quando chegou depois', () => {
    expect(diferencaDias('2026-06-10', '2026-06-05')).toBe(5)
  })
  it('negativo quando chegou antes', () => {
    expect(diferencaDias('2026-06-03', '2026-06-05')).toBe(-2)
  })
  it('null quando falta uma data', () => {
    expect(diferencaDias(null, '2026-06-05')).toBeNull()
  })
})
describe('diferencaNumerica', () => {
  it('subtrai', () => { expect(diferencaNumerica(8, 10)).toBe(-2) })
  it('null quando falta um valor', () => { expect(diferencaNumerica(null, 10)).toBeNull() })
})
describe('buscarCriticidade', () => {
  const t = [{ fornecedor: 'AVNET INC', critico: 'Sim' }]
  it('acha (case/trim-insensível ao fornecedor exato)', () => {
    expect(buscarCriticidade('AVNET INC', t)).toBe('Sim')
  })
  it('null quando não acha', () => { expect(buscarCriticidade('X', t)).toBeNull() })
})
describe('buscarNqa', () => {
  const t = [
    { quantidadeMin: 2, quantidadeMax: 8, tamanhoAmostra: 5 },
    { quantidadeMin: 500001, quantidadeMax: null, tamanhoAmostra: 1250 },
  ]
  it('acha na faixa fechada', () => { expect(buscarNqa(5, t)).toBe(5) })
  it('acha na faixa aberta (max null)', () => { expect(buscarNqa(999999, t)).toBe(1250) })
  it('null quando fora de qualquer faixa', () => { expect(buscarNqa(20, t)).toBeNull() })
  it('null quando a faixa não tem tamanho definido', () => {
    expect(buscarNqa(5, [{ quantidadeMin: 2, quantidadeMax: 8, tamanhoAmostra: null }])).toBeNull()
  })
})
describe('calcularCamposCalculados', () => {
  const campos = [
    { campo: 'atraso', formula: 'diferenca_dias', formulaConfig: { a: 'data_chegada', b: 'data_prevista' } },
    { campo: 'responsavel_contagem', formula: 'usuario_primeiro', formulaConfig: {} },
  ]
  const ctx = { criticidade: [], nqa: [], usuarioAtual: 'João', valoresAtuais: {} }
  it('calcula atraso e fixa o responsável no primeiro preenchimento', () => {
    const r = calcularCamposCalculados({ data_chegada: '2026-06-10', data_prevista: '2026-06-05' }, campos, ctx)
    expect(r.atraso).toBe(5)
    expect(r.responsavel_contagem).toBe('João')
  })
  it('mantém o responsável já preenchido (write-once)', () => {
    const r = calcularCamposCalculados({}, campos, { ...ctx, valoresAtuais: { responsavel_contagem: 'Maria' } })
    expect(r.responsavel_contagem).toBe('Maria')
  })
})
```

- [ ] **Step 2: Rodar (falha), implementar, rodar (passa)**

Criar `src/modules/recebimento/domain/calculos.ts`:

```ts
export type FaixaNqa = { quantidadeMin: number; quantidadeMax: number | null; tamanhoAmostra: number | null }
export type CampoCalc = { campo: string; formula: string | null; formulaConfig: Record<string, string> }
export type ContextoCalculo = {
  criticidade: { fornecedor: string; critico: string }[]
  nqa: FaixaNqa[]
  usuarioAtual: string
  valoresAtuais: Record<string, unknown>
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function diferencaDias(chegadaISO: string | null, previstaISO: string | null): number | null {
  if (!chegadaISO || !previstaISO) return null
  const a = Date.parse(chegadaISO + 'T00:00:00Z')
  const b = Date.parse(previstaISO + 'T00:00:00Z')
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((a - b) / 86400000)
}

export function diferencaNumerica(a: unknown, b: unknown): number | null {
  const na = numero(a), nb = numero(b)
  if (na === null || nb === null) return null
  return na - nb
}

export function buscarCriticidade(
  fornecedor: string | null,
  tabela: { fornecedor: string; critico: string }[],
): string | null {
  if (!fornecedor) return null
  const alvo = fornecedor.trim().toLowerCase()
  const achou = tabela.find((r) => r.fornecedor.trim().toLowerCase() === alvo)
  return achou ? achou.critico : null
}

export function buscarNqa(quantidade: unknown, tabela: FaixaNqa[]): number | null {
  const q = numero(quantidade)
  if (q === null) return null
  const faixa = tabela.find((f) => q >= f.quantidadeMin && (f.quantidadeMax === null || q <= f.quantidadeMax))
  return faixa && faixa.tamanhoAmostra !== null ? faixa.tamanhoAmostra : null
}

export function calcularCamposCalculados(
  valores: Record<string, unknown>,
  campos: CampoCalc[],
  ctx: ContextoCalculo,
): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {}
  for (const campo of campos) {
    const cfg = campo.formulaConfig
    switch (campo.formula) {
      case 'diferenca_dias':
        out[campo.campo] = diferencaDias(
          (valores[cfg.a] as string) ?? null,
          (valores[cfg.b] as string) ?? null,
        )
        break
      case 'diferenca_numerica':
        out[campo.campo] = diferencaNumerica(valores[cfg.a], valores[cfg.b])
        break
      case 'lookup_fornecedor_critico':
        out[campo.campo] = buscarCriticidade((valores[cfg.campo] as string) ?? null, ctx.criticidade)
        break
      case 'tabela_nqa':
        out[campo.campo] = buscarNqa(valores[cfg.campo], ctx.nqa)
        break
      case 'usuario_primeiro': {
        const atual = ctx.valoresAtuais[campo.campo]
        out[campo.campo] =
          atual === null || atual === undefined || String(atual).trim() === ''
            ? ctx.usuarioAtual
            : (atual as string)
        break
      }
      default:
        break
    }
  }
  return out
}
```

- [ ] **Step 3: Build + commit**

```bash
npm test && npm run build
git add src/modules/recebimento/domain/calculos.ts src/modules/recebimento/domain/__tests__/calculos.test.ts
git commit -m "feat(recebimento): domínio de cálculo de campos (atraso, divergência, crítico, NQA, responsável) — TDD"
```

---

## Task 3: Repositórios das tabelas + recomputo autoritativo no salvar

**Files:**
- Create: `src/modules/recebimento/infra/referencias-repository.ts`
- Modify: `src/modules/recebimento/application/salvar-processo.ts`
- Modify: `src/modules/recebimento/infra/processo-detalhe-repository.ts` (expor `calculado/formula/formulaConfig` em `carregarCamposFormulario`)

**Interfaces:**
- Produces: `carregarCriticidade(): Promise<{fornecedor;critico}[]>`, `carregarTabelaNqa(): Promise<FaixaNqa[]>`. `carregarCamposFormulario` agora inclui `calculado`, `formula`, `formulaConfig`.

- [ ] **Step 1: Repositório das referências**

`referencias-repository.ts`: `carregarCriticidade()` (`select fornecedor, critico`), `carregarTabelaNqa()` (`select quantidade_min, quantidade_max, tamanho_amostra order by ordem`, mapear snake→camel). Via `createServerSupabase()`.

- [ ] **Step 2: Campos do formulário incluem metadados de cálculo**

Em `carregarCamposFormulario`, adicionar ao mapeamento: `calculado`, `formula`, `formulaConfig` (de `formula_config`).

- [ ] **Step 3: `salvarProcesso` recomputa os calculados (autoritativo)**

Em `salvar-processo.ts`, após montar `novosValores` a partir das edições:
1. Ignorar quaisquer valores enviados para campos `calculado=true` (o cliente não os define).
2. Carregar `carregarCriticidade()` + `carregarTabelaNqa()`.
3. Montar `valoresParaCalculo` = valores atuais do processo mesclados com `novosValores` (não-calculados).
4. `resultado = calcularCamposCalculados(valoresParaCalculo, camposCalculados, { criticidade, nqa, usuarioAtual: sessao.nome||email, valoresAtuais: <valores atuais do processo> })`.
5. Mesclar `resultado` no `patch` (sobrescrevendo as colunas calculadas). Seguir com diff/log/atualizar como já é.

O diff agora reflete também mudanças dos calculados; o log continua correto.

- [ ] **Step 4: Build + commit**

```bash
npm test && npm run build
git add src/modules/recebimento/infra/referencias-repository.ts src/modules/recebimento/application/salvar-processo.ts src/modules/recebimento/infra/processo-detalhe-repository.ts
git commit -m "feat(recebimento): recomputo autoritativo dos campos calculados ao salvar + repositórios de referência"
```

---

## Task 4: Formulário — campos calculados somente-leitura com cálculo ao vivo

**Files:**
- Modify: `src/app/(app)/recebimento/processos/[id]/page.tsx` (carregar tabelas e passar ao form)
- Modify: `src/app/(app)/recebimento/processos/[id]/processo-form.tsx`

**Interfaces:** Consome `calcularCamposCalculados`, `carregarCriticidade`, `carregarTabelaNqa`.

- [ ] **Step 1: Página passa as tabelas**

`[id]/page.tsx`: `carregarCriticidade()` + `carregarTabelaNqa()`; passar `criticidade` e `nqa` (e o nome do usuário) ao `<ProcessoForm>`.

- [ ] **Step 2: Form renderiza calculados read-only + recalcula ao vivo**

`processo-form.tsx`: para campos `calculado=true`, renderizar **somente-leitura** exibindo o valor de `calcularCamposCalculados(valoresAtuaisDoForm, camposCalc, {criticidade, nqa, usuarioAtual, valoresAtuais})` (recalcular via `useMemo` quando os valores mudam). `responsavel_contagem` vazio → placeholder "(será você ao salvar)". Não enviar os calculados no payload de `salvarProcesso` (o servidor recomputa). Manter o resto.

- [ ] **Step 3: Build + commit**

```bash
npm test && npm run build
git add "src/app/(app)/recebimento/processos/[id]/"
git commit -m "feat(recebimento): campos calculados somente-leitura no formulário com cálculo ao vivo"
```

---

## Task 5: Telas de configuração — Criticidade por Fornecedor + Tabela NQA

**Files:**
- Create: `src/modules/referencias/infra/*` (ou reutilizar `referencias-repository`), `.../application/actions.ts`
- Create: `src/app/(app)/configuracoes/criticidade/page.tsx` + form
- Create: `src/app/(app)/configuracoes/nqa/page.tsx` + form
- Modify: `src/shared/ui/config-nav.ts` (+ 2 itens)

**Interfaces:** Server Actions (checam `administrar` + logam): `salvarCriticidade`, `excluirCriticidade`, `salvarFaixaNqa`, `excluirFaixaNqa`.

- [ ] **Step 1: Server Actions (padrão de `modules/listas/application/actions.ts`)**

Cada uma: `getSessao` + `podeFazer('administrar')`; CRUD via repositório; `registrarLog('criticidade'|'nqa', id, acao, ...)`; `revalidatePath`. Criticidade: criar/editar (fornecedor, Sim/Não), excluir. NQA: editar `tamanho_amostra` (e opcionalmente add/remover faixa), com `entidade:'nqa'`.

- [ ] **Step 2: Telas (padrão de `configuracoes/listas`)**

- `configuracoes/criticidade/page.tsx`: tabela (Fornecedor, Crítico) + "Novo" + editar/excluir (dialog `criticidade-form.tsx`, select Sim/Não).
- `configuracoes/nqa/page.tsx`: tabela das faixas (Min, Max, Tamanho da Amostra) com edição do tamanho por linha (dialog ou inline).
- Adicionar itens a `CONFIG_NAV`: `{chave:'criticidade', rotulo:'Criticidade por Fornecedor', href:'/configuracoes/criticidade'}` e `{chave:'nqa', rotulo:'Tabela NQA', href:'/configuracoes/nqa'}` (antes de 'logs'/'sobre'). Ajustar o teste `config-nav.test.ts` para as novas chaves.

- [ ] **Step 3: Build + commit**

```bash
npm test && npm run build
git add "src/modules/referencias/" "src/app/(app)/configuracoes/criticidade/" "src/app/(app)/configuracoes/nqa/" src/shared/ui/config-nav.ts src/shared/ui/__tests__/config-nav.test.ts
git commit -m "feat(config): telas de Criticidade por Fornecedor e Tabela NQA"
```

---

## Self-Review (autor do plano)

**1. Cobertura do spec 3C:**
- Colunas `calculado/formula/formula_config` + seed dos 5 → Task 1 ✅
- Tabelas `criticidade_fornecedor` e `tabela_nqa` (+ faixas) com RLS → Task 1 ✅
- Domínio de cálculo (5 fórmulas + write-once) testado → Task 2 ✅
- Recomputo autoritativo no salvar → Task 3 ✅
- Formulário read-only + cálculo ao vivo → Task 4 ✅
- Telas de configuração das duas tabelas → Task 5 ✅

**2. Placeholders:** domínio, migration e o contrato do recomputo têm código verbatim; UI/config seguem padrões existentes (`configuracoes/listas`, `processo-form`) — o subagente completa e é revisado (revisão pesada nas Tasks 1 e 3; normal na 2 e 4; leve na 5 CRUD).

**3. Consistência de tipos:** `FaixaNqa`, `CampoCalc`, `ContextoCalculo`, `calcularCamposCalculados`, `carregarCriticidade`, `carregarTabelaNqa`, `carregarCamposFormulario` (agora com calculado/formula/formulaConfig) usados de forma idêntica. Colunas calculadas (atraso, critico, divergencia, amostral, responsavel_contagem) já existem em `processos_recebimento` (0004) — só passam a ser gravadas pelo recomputo. `formula` ∈ enum do check da migration.
