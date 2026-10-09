# Montar setup: a linha nova entra no topo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na tela de Montar setup, a linha recém-incluída aparece **em primeiro**. Só nessa tela, e só ao **inserir** (editar não move a linha).

**Architecture:** Três peças, em camadas. (1) Uma coluna `criado_em` em `st_setup_itens` — hoje só existe `atualizado_em`, que muda ao editar, então não serve. (2) O repositório passa a trazer `criadoEm`, mas **continua ordenando por posição** (a consulta `carregarSetup` é compartilhada por Montar, Abastecimento e Consultas). (3) A tela de Montar reordena a lista recebida por `criadoEm` decrescente, com uma função pura de domínio. Abastecimento e Consultas não mudam uma linha.

**Tech Stack:** Next.js 16 (App Router, Server Actions), TypeScript, Supabase/PostgREST, Vitest, Postgres.

**Spec:** `docs/superpowers/specs/2026-10-08-setup-linha-no-topo-design.md`

## Restrições globais

- Tudo em **PT-BR**: identificadores, comentários, textos de tela.
- Alvo real é **tablet**: nada que dependa de `hover`.
- ⚠️ `--maxWorkers=2` é **obrigatório** em todo `vitest` nesta máquina (4 núcleos; sem ele o processo morre com exit 137). Ex.: `npx vitest run --maxWorkers=2 src/modules/setup`.
- ⚠️ `next build` **roda** nesta worktree: `NODE_OPTIONS="--max-old-space-size=4096" npx next build`.
- Migração **idempotente**: o projeto aplica cada uma **duas vezes** para provar. Última linha: `notify pgrst, 'reload schema';`. Corpo de função com `$func$`, nunca `$$` (nem em comentário).
- ⚠️ O harness de teste SQL **existe**: `supabase/tests/rodar-setup-test.sh` (Postgres descartável em Docker, carrega `0111` e `0112` e roda `setup_st_test.sql`). Esta feature estende esse harness.
- ⚠️ **Não rodar nada contra Dev nem Prod.** Só o Docker descartável e o vitest local. Aplicar no Dev/Prod é decisão do usuário, depois.
- ⚠️ A **próxima migração livre é a `0146`**. A `0141` é do resumo diário, `0142`–`0144` da justificativa de divergência e a `0145` está reservada para a finalização automática de OP — todas em branches ainda não mergeadas. Não usar nenhum desses números.
- `git add` com **caminhos explícitos** — nunca `git add -A` nem `git add .`. `.superpowers/` está no `.gitignore` de propósito.
- Toda mensagem de commit termina com: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Abastecimento e Consultas não podem mudar.** Nenhum arquivo de `abastecimento/` nem de `consultas/` entra em `git add`.
- ⚠️ **O teste que distingue este desenho do caminho fácil é o de EDITAR:** um item editado **não** pode subir. Quem ordenar por `atualizado_em` passa em todo o resto e só esse teste pega. Ele existe nas Tasks 1 (banco) e 2 (função pura) e é cobrado de novo na Task 4.
- Como `carregarSetupAction` fica fora do alcance de teste unitário (`server-only` + Supabase), "a mudança não vazou" é provada por **extração da comparação por posição para o domínio, com teste**, mais um `grep` na Task 4.

## Estrutura de arquivos

| arquivo | responsabilidade |
|---|---|
| `supabase/migrations/0146_setup_itens_criado_em.sql` | **criar** — coluna `criado_em` + backfill |
| `supabase/tests/setup_st_test.sql` | **modificar** — carrega a 0146 e prova backfill, idempotência e "editar não mexe em `criado_em`" |
| `supabase/tests/rodar-setup-test.sh` | **modificar** — copia a 0146 para o container |
| `src/modules/setup/domain/ordenacao-itens.ts` | **criar** — `compararPorPosicao` (a ordem canônica, extraída) e `maisRecentePrimeiro` |
| `src/modules/setup/domain/__tests__/ordenacao-itens.test.ts` | **criar** — os testes das duas |
| `src/modules/setup/infra/setup-repository.ts` | **modificar** — `criadoEm` em `ItemSetup`/`mapItem`/consulta; ordena com `compararPorPosicao` |
| `src/app/(app)/setup/operar/montar/montar-setup.tsx` | **modificar** — aplica `maisRecentePrimeiro` ao receber os itens |

---

### Task 1: Migração 0146 — `criado_em` com backfill

**Files:**
- Create: `supabase/migrations/0146_setup_itens_criado_em.sql`
- Modify: `supabase/tests/rodar-setup-test.sh` (uma linha: `docker cp` da 0146)
- Modify: `supabase/tests/setup_st_test.sql` (`\i /tmp/0146.sql` + bloco de testes 12 antes do `select 'TODOS OS TESTES...'`)

**Interfaces:**
- Consumes: `public.st_setup_itens` (0111), com `atualizado_em timestamptz not null default now()`.
- Produces: `st_setup_itens.criado_em timestamptz not null default now()`. Nenhuma função do banco muda: `st_incluir_item` já faz `insert` sem listar `criado_em`, então o `default now()` basta. Os caminhos de **editar** (`st_editar_item`) e de **rebipar rolo em item existente** (o `update` de `st_incluir_item`) não tocam a coluna — é isso que mantém a linha no lugar.

- [ ] **Step 1: Escrever o teste que falha (SQL)**

Em `supabase/tests/rodar-setup-test.sh`, logo depois da linha `docker cp ... 0112.sql`, acrescentar:

```bash
docker cp supabase/migrations/0146_setup_itens_criado_em.sql "$NOME":/tmp/0146.sql
```

Em `supabase/tests/setup_st_test.sql`, logo depois de `\i /tmp/0112.sql`, acrescentar:

```sql
\i /tmp/0146.sql
```

Antes da linha final `select 'TODOS OS TESTES DO SETUP PASSARAM' as resultado;`, acrescentar o bloco 12. Ele usa as funções e o setup já criados no arquivo (`eqid`, `st_abrir_setup`, `st_incluir_item`, `st_editar_item`); como `st_editar_item` exige permissão de administrar, use o mesmo `set_config('teste.perms', ...)` que o teste 3 do arquivo usa antes de `st_editar_item` (ver linhas ~185–200 do arquivo e copiar a mesma forma):

```sql
-- 12. criado_em: nasce na inclusão, NÃO muda ao editar nem ao rebipar o rolo, e o backfill usa atualizado_em
insert into public.sf_ordens (pmo, op, sn_ini, sn_fim) values ('PMOG13', '9008', '2690080001', '2690080100');
do $t$ declare s uuid; i1 uuid; i2 uuid; c1 timestamptz; c2 timestamptz; a1 timestamptz; begin
  s := (st_abrir_setup('PMOG13', '9008', eqid('SMD', '1', 'A', 'MG5'), 'TOP')->>'setup_id')::uuid;
  i1 := (st_incluir_item(s, '1', 'F1', 'CAPJ41-1201')->>'item_id')::uuid;
  perform pg_sleep(0.05);
  i2 := (st_incluir_item(s, '2', 'F2', 'CAPJ41-1202')->>'item_id')::uuid;
  select criado_em into c1 from st_setup_itens where id = i1;
  select criado_em into c2 from st_setup_itens where id = i2;
  if c1 is null or c2 is null then raise exception 'FALHOU: criado_em nulo na inclusão'; end if;
  if c2 <= c1 then raise exception 'FALHOU: o item incluído depois não tem criado_em maior (% x %)', c1, c2; end if;

  -- EDITAR o item mais antigo: atualizado_em avança, criado_em NÃO
  perform set_config('teste.perms', 'setup.visualizar,setup.lancar,setup.administrar', false);
  perform pg_sleep(0.05);
  perform st_editar_item(i1, '1', 'F1-NOVO');
  if (select criado_em from st_setup_itens where id = i1) <> c1 then raise exception 'FALHOU: editar mexeu no criado_em'; end if;
  select atualizado_em into a1 from st_setup_itens where id = i1;
  if a1 <= c1 then raise exception 'FALHOU: editar deveria avançar atualizado_em (premissa do teste)'; end if;

  -- REBIPAR o rolo de um item que já existe (caminho "atualizou" do st_incluir_item): idem
  perform st_incluir_item(s, '2', 'F2', 'CAPJ41-1299');
  if (select criado_em from st_setup_itens where id = i2) <> c2 then raise exception 'FALHOU: rebipar rolo mexeu no criado_em'; end if;
end $t$;

-- 12b. Backfill: linha sem criado_em (como as de antes da migração) ganha o atualizado_em; e rodar a 0146 de novo é inócuo
do $t$ declare i uuid; esperado timestamptz; antes_outros int; begin
  select id into i from st_setup_itens order by atualizado_em desc limit 1;
  select atualizado_em into esperado from st_setup_itens where id = i;
  alter table st_setup_itens alter column criado_em drop not null;
  update st_setup_itens set criado_em = null where id = i;
  select count(*) into antes_outros from st_setup_itens where criado_em is not null;
end $t$;
\i /tmp/0146.sql
\i /tmp/0146.sql
do $t$ begin
  if exists (select 1 from st_setup_itens where criado_em is null) then raise exception 'FALHOU: backfill deixou criado_em nulo'; end if;
  if exists (select 1 from st_setup_itens where criado_em > atualizado_em) then raise exception 'FALHOU: criado_em depois de atualizado_em'; end if;
  if (select is_nullable from information_schema.columns where table_name = 'st_setup_itens' and column_name = 'criado_em') <> 'NO' then
    raise exception 'FALHOU: criado_em deveria voltar a ser NOT NULL';
  end if;
end $t$;
```

Observação para quem implementa: o bloco 12b só prova o backfill de verdade se a linha zerada recebe exatamente o seu `atualizado_em`. Se o `select ... order by atualizado_em desc limit 1` pegar um item cujo `criado_em` já é igual ao `atualizado_em`, o teste passa sem distinguir. Para distinguir, antes de zerar faça `update st_setup_itens set atualizado_em = atualizado_em + interval '1 hour' where id = i;` e **depois** da 0146 confira `criado_em = esperado + interval '1 hour'` (ajuste `esperado` de acordo). Escreva assim.

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `bash supabase/tests/rodar-setup-test.sh`
Expected: FAIL — `\i /tmp/0146.sql` não encontra o arquivo (a migração ainda não existe). Sem a migração, também não há a coluna.

- [ ] **Step 3: Escrever a migração**

`supabase/migrations/0146_setup_itens_criado_em.sql` (molde de estilo: `0139_alertas_intervalos.sql`):

```sql
-- =============================================================
-- SETUP — DATA DE CRIAÇÃO DO ITEM
-- Spec: docs/superpowers/specs/2026-10-08-setup-linha-no-topo-design.md
--
-- A tela de Montar setup passa a mostrar a linha mais recente em primeiro. Para isso é preciso
-- saber QUANDO o item nasceu, e st_setup_itens só tinha atualizado_em, que muda ao editar (e editar
-- NÃO deve mover a linha). Esta migração acrescenta criado_em.
--
-- Nenhuma função muda: st_incluir_item faz insert sem listar a coluna, então o default now() basta;
-- st_editar_item e o caminho "atualizou" do st_incluir_item não tocam em criado_em.
--
-- Backfill: as linhas que já existem recebem o atualizado_em. É a melhor aproximação possível, e para
-- item nunca editado os dois valores são iguais.
--
-- Idempotente: add column if not exists; o update só toca linhas ainda sem criado_em; set default e
-- set not null podem ser repetidos.
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0146_setup_itens_criado_em.sql
-- =============================================================

-- Primeiro SEM default e nulável: com "default now()" no add column, o Postgres preencheria as linhas
-- antigas com a hora da migração e o backfill a partir de atualizado_em nunca valeria.
alter table public.st_setup_itens add column if not exists criado_em timestamptz;

update public.st_setup_itens set criado_em = atualizado_em where criado_em is null;

alter table public.st_setup_itens alter column criado_em set default now();
alter table public.st_setup_itens alter column criado_em set not null;

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `bash supabase/tests/rodar-setup-test.sh`
Expected: `TODOS OS TESTES DO SETUP PASSARAM` e `CONCORRÊNCIA OK`. Conferir também: `grep -c '\$\$' supabase/migrations/0146_setup_itens_criado_em.sql` dá **0**.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0146_setup_itens_criado_em.sql supabase/tests/setup_st_test.sql supabase/tests/rodar-setup-test.sh
git commit -m "setup: criado_em em st_setup_itens (0146), com backfill de atualizado_em

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Funções puras de ordenação (domínio)

**Files:**
- Create: `src/modules/setup/domain/ordenacao-itens.ts`
- Create: `src/modules/setup/domain/__tests__/ordenacao-itens.test.ts`

**Interfaces:**
- Consumes: nada (tipo estrutural próprio; o domínio **não** importa da infra, que é `server-only`).
- Produces:
  - `type ItemOrdenavel = { posicao: string; feeder: string; criadoEm: string }`
  - `compararPorPosicao(a, b): number` — a ordem canônica de hoje, extraída sem mudar o comportamento (`numeric: true`, desempate por feeder). Só precisa de `posicao` e `feeder`.
  - `maisRecentePrimeiro<T extends ItemOrdenavel>(itens: readonly T[]): T[]` — **cópia** ordenada por `criadoEm` decrescente; empate → `compararPorPosicao`. Não altera o array de entrada.

- [ ] **Step 1: Escrever os testes que falham**

`src/modules/setup/domain/__tests__/ordenacao-itens.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { compararPorPosicao, maisRecentePrimeiro } from '../ordenacao-itens'

const item = (posicao: string, feeder: string, criadoEm: string, extra: Record<string, unknown> = {}) =>
  ({ posicao, feeder, criadoEm, ...extra })

describe('compararPorPosicao (a ordem canônica, usada por Abastecimento e Consultas)', () => {
  it('compara posição como número: "2" antes de "10"', () => {
    const lista = [item('10', 'F10', ''), item('2', 'F2', ''), item('1', 'F1', '')]
    expect(lista.sort(compararPorPosicao).map((i) => i.posicao)).toEqual(['1', '2', '10'])
  })
  it('desempata pelo feeder, também numérico', () => {
    const lista = [item('5', 'F10', ''), item('5', 'F2', '')]
    expect(lista.sort(compararPorPosicao).map((i) => i.feeder)).toEqual(['F2', 'F10'])
  })
})

describe('maisRecentePrimeiro', () => {
  it('ordena do criado mais recentemente para o mais antigo', () => {
    const a = item('1', 'F1', '2026-10-09T10:00:00Z')
    const b = item('2', 'F2', '2026-10-09T10:01:00Z')
    const c = item('3', 'F3', '2026-10-09T10:02:00Z')
    expect(maisRecentePrimeiro([a, b, c])).toEqual([c, b, a])
  })

  it('EDITAR NÃO MOVE A LINHA: atualizadoEm é ignorado, só criadoEm conta', () => {
    // O item mais antigo foi editado agora há pouco (atualizadoEm é o mais recente de todos).
    // Quem ordenasse por atualizadoEm subiria "antigo" para o topo; o desenho correto não.
    const antigo = item('1', 'F1', '2026-10-09T10:00:00Z', { atualizadoEm: '2026-10-09T18:00:00Z' })
    const meio = item('2', 'F2', '2026-10-09T10:01:00Z', { atualizadoEm: '2026-10-09T10:01:00Z' })
    const novo = item('3', 'F3', '2026-10-09T10:02:00Z', { atualizadoEm: '2026-10-09T10:02:00Z' })
    expect(maisRecentePrimeiro([antigo, meio, novo]).map((i) => i.posicao)).toEqual(['3', '2', '1'])
  })

  it('empate de criadoEm desempata por posição (numérica), sempre igual entre duas leituras', () => {
    const mesmo = '2026-10-09T10:00:00Z'
    const embaralhado = [item('10', 'F10', mesmo), item('2', 'F2', mesmo), item('1', 'F1', mesmo)]
    const esperado = ['1', '2', '10']
    expect(maisRecentePrimeiro(embaralhado).map((i) => i.posicao)).toEqual(esperado)
    expect(maisRecentePrimeiro([...embaralhado].reverse()).map((i) => i.posicao)).toEqual(esperado)
  })

  it('item de antes da migração (criadoEm vindo do backfill) convive com os novos, sem buraco', () => {
    const antigoBackfill = item('1', 'F1', '2026-09-01T08:00:00Z')
    const novo = item('2', 'F2', '2026-10-09T10:00:00Z')
    expect(maisRecentePrimeiro([antigoBackfill, novo]).map((i) => i.posicao)).toEqual(['2', '1'])
  })

  it('não altera o array de entrada e preserva os outros campos do objeto', () => {
    const entrada = [item('1', 'F1', '2026-10-09T10:00:00Z', { id: 'a' }), item('2', 'F2', '2026-10-09T10:01:00Z', { id: 'b' })]
    const copia = [...entrada]
    const saida = maisRecentePrimeiro(entrada)
    expect(entrada).toEqual(copia)
    expect(saida).not.toBe(entrada)
    expect(saida[0]).toMatchObject({ id: 'b' })
  })

  it('lista vazia devolve lista vazia', () => {
    expect(maisRecentePrimeiro([])).toEqual([])
  })
})
```

Nota: `criadoEm` chega do PostgREST como ISO com fuso (`2026-10-09T10:00:00.123456+00:00`). Dois instantes iguais em fusos escritos diferentes não ocorrem (todos vêm do mesmo banco), mas a comparação deve ser por **instante**, não por texto — o teste de ordenação acima usa `Z`; o código usa `Date.parse`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --maxWorkers=2 src/modules/setup/domain/__tests__/ordenacao-itens.test.ts`
Expected: FAIL — `Cannot find module '../ordenacao-itens'`.

- [ ] **Step 3: Implementar**

`src/modules/setup/domain/ordenacao-itens.ts`:

```ts
// Ordenação dos itens de um setup. Duas ordens, para dois propósitos:
//  - por posição: ler o setup conferindo contra a máquina (Abastecimento, Consultas, e a ordem canônica
//    que o repositório devolve);
//  - mais recente primeiro: conferir o que acabou de bipar (só a tela de Montar).

export interface ItemOrdenavel { posicao: string; feeder: string; criadoEm: string }

const OPCOES = { numeric: true } as const

/** Posição numérica quando dá ("2" antes de "10"), senão texto; empate pelo feeder. */
export function compararPorPosicao(a: Pick<ItemOrdenavel, 'posicao' | 'feeder'>, b: Pick<ItemOrdenavel, 'posicao' | 'feeder'>): number {
  return a.posicao.localeCompare(b.posicao, 'pt-BR', OPCOES) || a.feeder.localeCompare(b.feeder, 'pt-BR', OPCOES)
}

function instante(iso: string): number {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

/**
 * Cópia da lista com o item criado mais recentemente primeiro. Conta só criadoEm: editar um item
 * (que muda atualizadoEm) NÃO o move. Empate de criadoEm desempata por posição, para a lista não
 * embaralhar entre duas leituras.
 */
export function maisRecentePrimeiro<T extends ItemOrdenavel>(itens: readonly T[]): T[] {
  return [...itens].sort((a, b) => instante(b.criadoEm) - instante(a.criadoEm) || compararPorPosicao(a, b))
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --maxWorkers=2 src/modules/setup/domain/__tests__/ordenacao-itens.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/setup/domain/ordenacao-itens.ts src/modules/setup/domain/__tests__/ordenacao-itens.test.ts
git commit -m "setup: funcoes puras de ordenacao dos itens (posicao e mais recente primeiro)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Repositório — traz `criadoEm`, continua por posição

**Files:**
- Modify: `src/modules/setup/infra/setup-repository.ts` (4 pontos: import, `ItemSetup`, `mapItem`, `carregarSetup`)

**Interfaces:**
- Consumes: `compararPorPosicao` (Task 2); coluna `criado_em` (Task 1).
- Produces: `ItemSetup.criadoEm: string`; `carregarSetup` devolve `itens` **na mesma ordem de antes** (por posição). Nenhum chamador muda.

Não há teste unitário deste arquivo (é `server-only` e fala com Supabase). A prova do "continua por posição" é o teste de `compararPorPosicao` da Task 2 (o repositório passa a usar exatamente essa função) mais o `tsc` e o `grep` abaixo.

- [ ] **Step 1: Editar**

1. Import (junto dos outros `import type` do topo):
```ts
import { compararPorPosicao } from '../domain/ordenacao-itens'
```
2. Interface — acrescentar o campo no fim:
```ts
export interface ItemSetup { id: string; posicao: string; feeder: string; componente: string; rolo: string | null; colaborador: string; atualizadoEm: string; criadoEm: string }
```
3. `mapItem` — acrescentar `criadoEm: r.criado_em as string,` ao lado de `atualizadoEm`.
4. `carregarSetup`: a lista de colunas passa a `'id,posicao,feeder,componente,rolo,colaborador,atualizado_em,criado_em'`, e a ordenação vira:
```ts
  // Ordem canônica: por posição (ver compararPorPosicao). Abastecimento e Consultas dependem dela;
  // só a tela de Montar reordena por criadoEm, no cliente.
  lista.sort(compararPorPosicao)
```
(substitui o `lista.sort(...)` inline e o comentário antigo).

- [ ] **Step 2: Verificar que a ordem canônica não mudou**

Run: `npx tsc --noEmit` — Expected: sem erros. Se algum outro arquivo constrói um `ItemSetup` literal (mocks de teste), o `tsc` aponta; acrescentar `criadoEm` ali.
Run: `grep -n "lista.sort" src/modules/setup/infra/setup-repository.ts` — Expected: **uma** linha, `lista.sort(compararPorPosicao)`.
Run: `npx vitest run --maxWorkers=2 src/modules/setup` — Expected: tudo passa.

- [ ] **Step 3: Commit**

```bash
git add src/modules/setup/infra/setup-repository.ts
git commit -m "setup: ItemSetup traz criadoEm; carregarSetup segue ordenando por posicao

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Tela de Montar — reordena e prova que não vazou

**Files:**
- Modify: `src/app/(app)/setup/operar/montar/montar-setup.tsx`

**Interfaces:**
- Consumes: `maisRecentePrimeiro` (Task 2); `ItemSetup.criadoEm` (Task 3).
- Produces: a lista renderizada na tela de Montar vem com o mais recente no topo. Nenhuma outra tela muda.

Onde aplicar: a tela recebe itens em **dois** pontos — `recarregar` (`setItens(r.itens)`, linha ~108) e a abertura/cópia (`setItens(c.itens)`, linha ~139). Aplicar nos dois, no momento de guardar no estado, para o `itens` do estado já estar na ordem de exibição (o `itens.map` da tabela e o `semRolo`/contagens seguem funcionando sem mudança). Conferir com `grep -n "setItens" montar-setup.tsx` se há outros pontos (`setItens([])` não precisa).

- [ ] **Step 1: Editar**

1. Import: `import { maisRecentePrimeiro } from '@/modules/setup/domain/ordenacao-itens'` (junto dos imports de `@/modules/setup/domain/...`).
2. Em `recarregar`: `setItens(maisRecentePrimeiro(r.itens))`.
3. No ponto da abertura (`setItens(c.itens)`): `setItens(maisRecentePrimeiro(c.itens))`.
4. Comentário curto acima de `const [itens, setItens]`: `// Fica na ordem de exibição: mais recente primeiro (só nesta tela; as outras leem por posição).`

Nada de `hover`, nada de texto novo na tela. Não mexer na tabela.

- [ ] **Step 2: Provar que não vazou para as outras telas**

Run: `grep -rn "maisRecentePrimeiro" src --include=*.ts --include=*.tsx | grep -v __tests__`
Expected: aparece **somente** em `ordenacao-itens.ts` (definição) e em `montar-setup.tsx` (uso). Se aparecer em `abastecimento/` ou `consultas/`, algo está errado.

Run: `git diff --stat main -- "src/app/(app)/setup/operar/abastecimento" "src/app/(app)/setup/consultas"`
Expected: **vazio** (nenhuma mudança nessas duas telas).

- [ ] **Step 3: Verificação completa**

Run: `npx tsc --noEmit` — sem erros.
Run: `npx vitest run --maxWorkers=2 src/modules/setup` — tudo verde.
Run: `bash supabase/tests/rodar-setup-test.sh` — `TODOS OS TESTES DO SETUP PASSARAM` + `CONCORRÊNCIA OK`.
Run: `NODE_OPTIONS="--max-old-space-size=4096" npx next build` — build ok.

- [ ] **Step 4: Roteiro de smoke (para o usuário, depois de aplicar a 0146 no Dev — NÃO fazer aqui)**

Registrar no relatório final que isto fica para o usuário, na ordem da spec:
1. Inserir 3 itens em sequência na Montar: lista na ordem **inversa** da inserção.
2. **Editar** o mais antigo (trocar feeder): ele **não** sobe. *(o teste que distingue o desenho)*
3. Abrir o **Abastecimento** do mesmo setup: continua por posição.
4. Setup antigo (itens de antes da migração) aparece sem buraco nem ordem estranha.
5. Recarregar a página duas vezes: a ordem é a mesma (desempate por posição). Atenção: itens trazidos por **copiar de OP anterior** nascem no mesmo instante, então aparecem por posição entre si, todos acima dos mais antigos — esperado.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/setup/operar/montar/montar-setup.tsx"
git commit -m "setup: Montar mostra a linha mais recente em primeiro (so nesta tela)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
