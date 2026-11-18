# Estrutura da OP (receita por PMO) — Plano de implementação (Parte A: SN "o mesmo")

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o ShopFloor apontar cada PRT no Compels quando as peças são aprovadas no posto que conclui o trecho dela, usando uma receita cadastrada por PMO (importável do Compels).

**Architecture:**
- **Banco.** Três tabelas novas guardam a receita (`sf_estruturas`, `sf_estrutura_trechos`) e a cópia por OP (`sf_ordem_trechos`, com a OP filha do Compels já casada). Dois triggers em `sf_registros` cobrem todos os caminhos de bipe (Lançamento, coletivo, NQA, painel):
  - o primeiro **enfileira** a PRT na fila que já existe (`sf_estoque_envios`, com `pmo = código da PRT`, `op = OP filha` e a coluna nova `ordem_id`);
  - o segundo **desfaz** a entrada quando o registro sai (cancelar lançamento).
- **Cron e adaptador.** Seguem iguais. Só ganham a regra de liberação das linhas de PRT (chave `COMPELS_PRT_LIGADO` + liberação da OP-pai).
- **Telas.**
  - **Estruturas** (lista, editor, importar e ativar);
  - **aviso no formulário da OP**;
  - **uma linha no card** do posto que conclui, no Fluxo.

**Tech Stack:** Next.js 16 (App Router, server actions; ler `node_modules/next/dist/docs/` antes de mexer em rota/página), Supabase/Postgres (migração SQL + RLS `tem_permissao`), vitest + Testing Library, harness SQL em Docker (`supabase/tests/`), cliente Compels (`src/modules/compels/infra/cliente.ts`).

**Spec:** `docs/superpowers/specs/2026-11-13-estrutura-op-receita-design.md`

## Escopo desta parte

**Entra:** decisões D1, D2, D5, D6, D7, D8, D9 e D10 da spec, e a opção de SN **"o mesmo"** (D3), que cobre todas as placas do estudo.

**Fica para a Parte B** (plano separado, depois de esta ir para produção):
- SN **próprio** (D3/D4): faixa por trecho, mais o bipe duplo no posto de ligação;
- a montagem em cards.

Nesta parte, a coluna `sn_modo` já existe, mas a tela só oferece "o mesmo" e **ativar recusa** receita com trecho "próprio", com a mensagem "SN próprio ainda não suportado".

## Global Constraints

- **Idioma.** Textos de tela, mensagens e comentários em **PT-BR**. Mensagens ao usuário em linguagem simples; nada técnico na tela.
- **Migração.** O número é **0184** (a última da main é a 0183). Se outra branch ocupar a 0184 antes do merge, renumere o arquivo e as referências.
- **Idempotência.** Toda migração precisa rodar **duas vezes** sem erro: `create ... if not exists`, `drop policy if exists`, `create or replace`.
- **RLS.**
  - Leitura: `(select tem_permissao('shopfloor','visualizar'))`.
  - Escrita: `(select tem_permissao('shopfloor','administrar'))`.
  - Sempre envolva em `(select ...)`, como na 0096; sem isso, a função roda linha a linha.
  - `revoke all ... from public, anon`.
- **Funções.** As que escrevem na fila são `security definer set search_path = public`.
- **Chave e liberação.**
  - **`COMPELS_PRT_LIGADO=1`** liga o envio das PRTs. Ausente ou outro valor = linhas de PRT esperam com o motivo "Apontamento das PRTs ainda desligado".
  - O envio da PMO (Almoxarifado) **não muda em nada**.
- **Destino no Compels.** O estoque de destino da PRT é configurado por trecho: `estoque` `'PA' | 'EINTER'`, padrão `'EINTER'`.
- **Fronteira de módulo.** O Compels só é chamado do servidor (`server-only`). Nunca imprimir token ou senha.
- **Commits.** Uma branch: `feat/estrutura-op-receita`. Cada commit termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Comandos de teste.**
  - vitest: `npx vitest run <arquivo>`
  - tipos: `npx tsc --noEmit -p .`
  - harness SQL: `bash supabase/tests/rodar-estrutura-op-test.sh`

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/0184_estrutura_op.sql` (novo) | tabelas, coluna `ordem_id`, RLS, triggers enfileirar/desfazer |
| `docs/operacao/estrutura-op/rollback-0184.sql` (novo) | desfaz a 0184 |
| `supabase/tests/estrutura_op_esquema.sql`, `estrutura_op_prova.sql`, `rodar-estrutura-op-test.sh` (novos) | harness |
| `src/modules/shopfloor/domain/estrutura.ts` (+ teste) | tipos, validação da receita, sugestão de posto, casamento árvore↔trechos, trechos a partir da árvore |
| `src/modules/compels/domain/arvore-op.ts` (+ teste) | ler a linha de OP do Compels e montar a árvore de descendentes |
| `src/modules/compels/infra/cliente.ts` (+ teste) | `lerNoOp(numero)` e `lerDescendentes(numero)` |
| `src/modules/shopfloor/infra/estrutura-repository.ts` | ler/gravar receitas, cópia para a OP, casar OP filha, corrigir fila sem OP |
| `src/modules/shopfloor/application/estrutura-actions.ts` (+ teste) | salvar, ativar, ler do Compels, importar em lote, aplicar na OP, ler trechos para o Fluxo |
| `src/modules/shopfloor/application/ordens-actions.ts` | chamar `aplicarEstruturaNaOp` ao criar e ao editar |
| `src/modules/shopfloor/application/enviar-estoque.ts` / `infra/estoque-envios-repository.ts` / `infra/compels.ts` (+ testes) | `ordemId` na linha reservada e liberação das PRTs |
| `src/app/(app)/shopfloor/estruturas/page.tsx`, `estruturas-cliente.tsx` (+ teste) | tela Estruturas |
| `src/shared/ui/app-shell.tsx` | item de menu "Estruturas" |
| `src/app/(app)/shopfloor/ordens/ordem-form.tsx`, `page.tsx` | aviso "tem / não tem estrutura" |
| `src/app/(app)/shopfloor/fluxo/fluxo-node.tsx` (+ teste) | linha "└ PRT → Compels" no card do posto que conclui |

---

### Task 1: Migração 0184 + harness SQL

**Files:**
- Create: `supabase/migrations/0184_estrutura_op.sql`
- Create: `docs/operacao/estrutura-op/rollback-0184.sql`
- Create: `supabase/tests/estrutura_op_esquema.sql`, `supabase/tests/estrutura_op_prova.sql`, `supabase/tests/rodar-estrutura-op-test.sh`

**Interfaces:**
- Produces:
  - tabelas `sf_estruturas(pmo, situacao, origem, …)`, `sf_estrutura_trechos(pmo, seq, codigo, descricao, posto_conclui, sn_modo, estoque)` e `sf_ordem_trechos(ordem_id, seq, codigo, posto_conclui, sn_modo, estoque, compels_op)`;
  - coluna `sf_estoque_envios.ordem_id uuid`;
  - triggers `sf_registros_trecho_ins` e `sf_registros_trecho_del`.

- [ ] **Step 1: Escrever o esquema mínimo do harness** (`supabase/tests/estrutura_op_esquema.sql`). É só o que a 0184 e os triggers usam; a `sf_estoque_chave` é cópia fiel da 0132.

```sql
-- Esquema mínimo para testar a 0184 sem as 183 migrações anteriores.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create or replace function public.tem_permissao(p_modulo text, p_acao text) returns boolean language sql as 'select true';
create table public.sf_postos (chave text primary key, ordem int not null default 0);
create table public.sf_ordens (
  id uuid primary key default gen_random_uuid(), pmo text not null, op text not null,
  placas_por_painel int not null default 1, unique (pmo, op));
create table public.sf_registros (
  id uuid primary key default gen_random_uuid(), data_hora timestamptz not null default now(),
  posto text not null, pmo text not null, op text not null, status text not null default '',
  numero_serie text not null default '', numero_serie_norm text not null default '', pecas int not null default 1,
  created_at timestamptz not null default now());
create table public.sf_estoque_envios (
  id uuid primary key default gen_random_uuid(),
  chave text not null, operacao text not null default 'entrada' check (operacao in ('entrada','estorno')),
  pmo text not null, op text not null, posto text not null,
  tipo text not null check (tipo in ('caixa','serie','lote')),
  bipe text not null, serie_norm text not null default '',
  alvo text generated always as (coalesce(nullif(serie_norm, ''), bipe)) stored,
  quantidade int not null check (quantidade > 0),
  ok boolean not null default false, erro text, tentativas int not null default 0,
  reservado_em timestamptz, enviado_em timestamptz, cancelado_em timestamptz,
  criado_em timestamptz not null default now(),
  estoque text not null default 'PA' check (estoque in ('PA','EINTER')),
  check (ok = (enviado_em is not null)),
  check (cancelado_em is null or not ok));
create unique index sf_estoque_envios_chave on public.sf_estoque_envios (chave);
create or replace function public.sf_estoque_chave(
  p_pmo text, p_op text, p_posto text, p_alvo text, p_operacao text
) returns text language sql volatile security definer set search_path = public as $func$
  select 'ALMOX/' || p_pmo || '/' || p_op || '/' || p_posto || '/' || p_alvo || '/'
         || case p_operacao when 'estorno' then 'S' else 'E' end
         || (select count(*) + 1 from public.sf_estoque_envios e
              where e.pmo = p_pmo and e.op = p_op and e.posto = p_posto
                and e.alvo = p_alvo and e.operacao = p_operacao)
$func$;
insert into public.sf_postos (chave, ordem) values
  ('Inspeção AOI TOP', 1), ('Inspeção PTH', 2), ('Teste', 3), ('Almoxarifado', 4);
```

- [ ] **Step 2: Escrever a prova** (`supabase/tests/estrutura_op_prova.sql`). Ela deve falhar hoje, porque não há trigger nem tabelas.

```sql
\set ON_ERROR_STOP on
-- OP 8498 (PMOC14) com 2 trechos: PRT410 fecha na AOI TOP (filha 8500), PRT420 na Inspeção PTH (filha 8499).
insert into sf_ordens (id, pmo, op, placas_por_painel) values ('00000000-0000-0000-0000-000000008498', 'PMOC14', '8498', 1);
insert into sf_ordens (id, pmo, op, placas_por_painel) values ('00000000-0000-0000-0000-000000009000', 'PMOX', '9000', 4);
insert into sf_ordem_trechos (ordem_id, seq, codigo, posto_conclui, sn_modo, estoque, compels_op) values
  ('00000000-0000-0000-0000-000000008498', 1, 'PRT410', 'Inspeção AOI TOP', 'mesmo', 'EINTER', '8500'),
  ('00000000-0000-0000-0000-000000008498', 2, 'PRT420', 'Inspeção PTH', 'mesmo', 'EINTER', '8499'),
  ('00000000-0000-0000-0000-000000009000', 1, 'PRT999', 'Inspeção PTH', 'mesmo', 'PA', null);

do $$
declare n int; r record;
begin
  -- 1) aprovado no posto que conclui → 1 linha da PRT410, op = filha, ordem_id preenchido, estoque do trecho
  insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values ('Inspeção AOI TOP', 'PMOC14', '8498', 'Aprovado', '331001251', '331001251');
  select * into r from sf_estoque_envios where pmo = 'PRT410';
  if r is null or r.op <> '8500' or r.ordem_id <> '00000000-0000-0000-0000-000000008498' or r.quantidade <> 1
     or r.tipo <> 'serie' or r.estoque <> 'EINTER' or r.posto <> 'Inspeção AOI TOP' then
    raise exception 'caso 1 falhou: %', row_to_json(r);
  end if;

  -- 2) reprova não enfileira; posto que não conclui trecho não enfileira; SN vazio não enfileira
  insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values ('Inspeção PTH', 'PMOC14', '8498', 'Reprovado', '331001252', '331001252');
  insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values ('Teste', 'PMOC14', '8498', 'Aprovado', '331001251', '331001251');
  insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values ('Inspeção PTH', 'PMOC14', '8498', 'Aprovado', '', '');
  select count(*) into n from sf_estoque_envios;
  if n <> 1 then raise exception 'caso 2 falhou: % linhas', n; end if;

  -- 3) reaprovação da mesma peça no mesmo posto não duplica (D6)
  insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values ('Inspeção AOI TOP', 'PMOC14', '8498', 'Aprovado', '331001251', '331001251');
  select count(*) into n from sf_estoque_envios where pmo = 'PRT410';
  if n <> 1 then raise exception 'caso 3 falhou: % linhas', n; end if;

  -- 4) painel: quantidade = pecas do registro; OP filha não casada → op ''
  insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm, pecas) values ('Inspeção PTH', 'PMOX', '9000', '', 'PNL1', 'pnl1', 4);
  select * into r from sf_estoque_envios where pmo = 'PRT999';
  if r is null or r.quantidade <> 4 or r.op <> '' or r.estoque <> 'PA' then raise exception 'caso 4 falhou: %', row_to_json(r); end if;

  -- 5) apagar o 1º registro com o 2º (mesma peça, mesmo posto) ainda lá → não desfaz
  delete from sf_registros where id = (select id from sf_registros where posto = 'Inspeção AOI TOP' order by created_at limit 1);
  select count(*) into n from sf_estoque_envios where pmo = 'PRT410' and cancelado_em is null;
  if n <> 1 then raise exception 'caso 5 falhou'; end if;

  -- 6) apagar o último registro aprovado com a linha PENDENTE → a linha é cancelada (não vira estorno)
  delete from sf_registros where posto = 'Inspeção AOI TOP';
  select count(*) into n from sf_estoque_envios where pmo = 'PRT410' and cancelado_em is not null;
  if n <> 1 then raise exception 'caso 6 falhou (cancelada)'; end if;
  select count(*) into n from sf_estoque_envios where pmo = 'PRT410' and operacao = 'estorno';
  if n <> 0 then raise exception 'caso 6 falhou (estorno indevido)'; end if;

  -- 7) rebipe depois do cancelamento → nova entrada (chave E2, não colide)
  insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values ('Inspeção AOI TOP', 'PMOC14', '8498', 'Aprovado', '331001251', '331001251');
  select count(*) into n from sf_estoque_envios where pmo = 'PRT410' and cancelado_em is null and operacao = 'entrada';
  if n <> 1 then raise exception 'caso 7 falhou'; end if;

  -- 8) linha JÁ ENVIADA e o registro sai → estorno com a mesma op/quantidade/estoque
  update sf_estoque_envios set ok = true, enviado_em = now() where pmo = 'PRT410' and cancelado_em is null;
  delete from sf_registros where posto = 'Inspeção AOI TOP';
  select * into r from sf_estoque_envios where pmo = 'PRT410' and operacao = 'estorno';
  if r is null or r.op <> '8500' or r.quantidade <> 1 or r.estoque <> 'EINTER' or r.ordem_id is null then
    raise exception 'caso 8 falhou: %', row_to_json(r);
  end if;

  -- 9) OP sem trechos: nada acontece
  insert into sf_ordens (pmo, op) values ('PMOZ', '9100');
  insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values ('Inspeção PTH', 'PMOZ', '9100', 'Aprovado', 'X1', 'x1');
  select count(*) into n from sf_estoque_envios where ordem_id is null;
  if n <> 0 then raise exception 'caso 9 falhou'; end if;
end $$;
\echo 'PROVA ESTRUTURA OK'
```

- [ ] **Step 3: Escrever o executor** (`supabase/tests/rodar-estrutura-op-test.sh`) e torná-lo executável (`chmod +x`).

```bash
#!/usr/bin/env bash
# Testes SQL da 0184 (estrutura da OP) num Postgres descartável. Uso: supabase/tests/rodar-estrutura-op-test.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-estrutura-op-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker cp supabase/tests/estrutura_op_esquema.sql "$NOME":/tmp/esquema.sql
docker cp supabase/migrations/0184_estrutura_op.sql "$NOME":/tmp/0184.sql
docker cp supabase/tests/estrutura_op_prova.sql "$NOME":/tmp/prova.sql
docker cp docs/operacao/estrutura-op/rollback-0184.sql "$NOME":/tmp/rollback.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/esquema.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f /tmp/0184.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f /tmp/0184.sql   # idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/prova.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f /tmp/rollback.sql
docker exec "$NOME" psql -U postgres -tAq -c "select count(*) from information_schema.tables where table_name in ('sf_estruturas','sf_estrutura_trechos','sf_ordem_trechos')" | grep -qx 0 || { echo "rollback não removeu as tabelas"; exit 1; }
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f /tmp/0184.sql   # volta depois do rollback
echo "ESTRUTURA OP SQL OK"
```

- [ ] **Step 4: Rodar e ver falhar.**
  Run: `bash supabase/tests/rodar-estrutura-op-test.sh`
  Expected: FAIL (`docker cp` falha: `0184_estrutura_op.sql` não existe).

- [ ] **Step 5: Escrever a migração** (`supabase/migrations/0184_estrutura_op.sql`):

```sql
-- 0184: ESTRUTURA DA OP (receita por PMO) — o ShopFloor aponta cada PRT no Compels quando a peça é aprovada no
-- posto que conclui o trecho dela. Spec: docs/superpowers/specs/2026-11-13-estrutura-op-receita-design.md
--
-- 1. sf_estruturas / sf_estrutura_trechos: a RECEITA, uma por PMO, em 'rascunho' (importada do Compels, falta
--    conferir os postos) ou 'ativa' (vale para OP nova). Só 'ativa' é copiada para a OP.
-- 2. sf_ordem_trechos: a CÓPIA da receita na OP (editar a receita não muda OP em andamento) + a OP filha do
--    Compels casada pelo código (compels_op; null = não achada, a linha da fila espera).
-- 3. sf_estoque_envios.ordem_id: liga a linha da fila à OP do ShopFloor. As linhas de PRT têm pmo = código da
--    PRT e op = OP filha, para o adaptador do Compels resolver tudo sem mudança; ordem_id é o que diz "esta
--    linha é PRT" e de qual OP ela veio (liberação, Fluxo).
-- 4. Triggers em sf_registros (cobrem TODOS os caminhos de bipe):
--    - AFTER INSERT: registro não reprovado, com SN, no posto que conclui um trecho → entrada da PRT, UMA vez por
--      peça e trecho (o líquido entradas − estornos vigentes é > 0 → não duplica). quantidade = pecas (painel).
--    - AFTER DELETE (cancelar lançamento move o registro p/ auditoria): se não sobrou outro registro aprovado da
--      peça no mesmo posto, desfaz: pendente → cancela; já enviada → estorno (mesma regra da 0132: não se estorna
--      o que ainda não saiu).

create table if not exists public.sf_estruturas (
  pmo          text primary key,
  situacao     text not null default 'rascunho' check (situacao in ('rascunho', 'ativa')),
  origem       text not null default 'manual',
  criado_em    timestamptz not null default now(),
  criado_por   text not null default '',
  alterado_em  timestamptz not null default now(),
  alterado_por text not null default ''
);

create table if not exists public.sf_estrutura_trechos (
  pmo           text not null references public.sf_estruturas(pmo) on delete cascade,
  seq           int  not null check (seq >= 1),
  codigo        text not null check (btrim(codigo) <> ''),
  descricao     text not null default '',
  posto_conclui text references public.sf_postos(chave),
  sn_modo       text not null default 'mesmo' check (sn_modo in ('mesmo', 'proprio')),
  estoque       text not null default 'EINTER' check (estoque in ('PA', 'EINTER')),
  primary key (pmo, seq)
);

create table if not exists public.sf_ordem_trechos (
  ordem_id      uuid not null references public.sf_ordens(id) on delete cascade,
  seq           int  not null check (seq >= 1),
  codigo        text not null,
  posto_conclui text not null,
  sn_modo       text not null default 'mesmo' check (sn_modo in ('mesmo', 'proprio')),
  estoque       text not null default 'EINTER' check (estoque in ('PA', 'EINTER')),
  compels_op    text,
  primary key (ordem_id, seq)
);
create index if not exists sf_ordem_trechos_posto on public.sf_ordem_trechos (ordem_id, posto_conclui);

alter table public.sf_estoque_envios add column if not exists ordem_id uuid;
create index if not exists sf_estoque_envios_ordem on public.sf_estoque_envios (ordem_id) where ordem_id is not null;

alter table public.sf_estruturas enable row level security;
alter table public.sf_estrutura_trechos enable row level security;
alter table public.sf_ordem_trechos enable row level security;

drop policy if exists sf_estruturas_select on public.sf_estruturas;
create policy sf_estruturas_select on public.sf_estruturas
  for select using ((select tem_permissao('shopfloor', 'visualizar')));
drop policy if exists sf_estruturas_admin on public.sf_estruturas;
create policy sf_estruturas_admin on public.sf_estruturas
  for all using ((select tem_permissao('shopfloor', 'administrar')))
  with check ((select tem_permissao('shopfloor', 'administrar')));

drop policy if exists sf_estrutura_trechos_select on public.sf_estrutura_trechos;
create policy sf_estrutura_trechos_select on public.sf_estrutura_trechos
  for select using ((select tem_permissao('shopfloor', 'visualizar')));
drop policy if exists sf_estrutura_trechos_admin on public.sf_estrutura_trechos;
create policy sf_estrutura_trechos_admin on public.sf_estrutura_trechos
  for all using ((select tem_permissao('shopfloor', 'administrar')))
  with check ((select tem_permissao('shopfloor', 'administrar')));

drop policy if exists sf_ordem_trechos_select on public.sf_ordem_trechos;
create policy sf_ordem_trechos_select on public.sf_ordem_trechos
  for select using ((select tem_permissao('shopfloor', 'visualizar')));
drop policy if exists sf_ordem_trechos_admin on public.sf_ordem_trechos;
create policy sf_ordem_trechos_admin on public.sf_ordem_trechos
  for all using ((select tem_permissao('shopfloor', 'administrar')))
  with check ((select tem_permissao('shopfloor', 'administrar')));

revoke all on public.sf_estruturas, public.sf_estrutura_trechos, public.sf_ordem_trechos from public, anon;
grant select, insert, update, delete on public.sf_estruturas, public.sf_estrutura_trechos, public.sf_ordem_trechos
  to authenticated, service_role;

-- ---------- enfileirar a PRT no bipe aprovado ----------
create or replace function public.sf_trecho_enfileirar()
returns trigger language plpgsql security definer set search_path = public as $func$
declare
  t record;
  v_liquido int;
begin
  if new.numero_serie_norm = '' or new.status ilike 'reprov%' then
    return new;
  end if;
  for t in
    select ot.codigo, coalesce(ot.compels_op, '') as op_filha, ot.estoque, o.id as ordem_id
      from public.sf_ordens o
      join public.sf_ordem_trechos ot on ot.ordem_id = o.id
     where o.pmo = new.pmo and o.op = new.op and ot.posto_conclui = new.posto
  loop
    select count(*) filter (where e.operacao = 'entrada') - count(*) filter (where e.operacao = 'estorno')
      into v_liquido
      from public.sf_estoque_envios e
     where e.ordem_id = t.ordem_id and e.pmo = t.codigo and e.posto = new.posto
       and e.alvo = new.numero_serie_norm and e.cancelado_em is null;
    if v_liquido > 0 then
      continue;  -- a peça já entrou neste trecho (reaprovação depois da Manutenção, rebipe): não duplica
    end if;
    insert into public.sf_estoque_envios
      (chave, operacao, pmo, op, posto, tipo, bipe, serie_norm, quantidade, estoque, ordem_id)
    values
      (public.sf_estoque_chave(t.codigo, t.op_filha, new.posto, new.numero_serie_norm, 'entrada'), 'entrada',
       t.codigo, t.op_filha, new.posto, 'serie', coalesce(nullif(new.numero_serie, ''), new.numero_serie_norm),
       new.numero_serie_norm, greatest(coalesce(new.pecas, 1), 1), t.estoque, t.ordem_id);
  end loop;
  return new;
end
$func$;

-- ---------- desfazer quando o registro sai ----------
create or replace function public.sf_trecho_desfazer()
returns trigger language plpgsql security definer set search_path = public as $func$
declare
  t record;
  v_id uuid;
  v_env record;
  v_liquido int;
begin
  if old.numero_serie_norm = '' or old.status ilike 'reprov%' then
    return old;
  end if;
  for t in
    select ot.codigo, o.id as ordem_id
      from public.sf_ordens o
      join public.sf_ordem_trechos ot on ot.ordem_id = o.id
     where o.pmo = old.pmo and o.op = old.op and ot.posto_conclui = old.posto
  loop
    -- outra aprovação da mesma peça no mesmo posto continua valendo: nada a desfazer
    if exists (select 1 from public.sf_registros r
                where r.pmo = old.pmo and r.op = old.op and r.posto = old.posto
                  and r.numero_serie_norm = old.numero_serie_norm and r.id <> old.id
                  and r.status not ilike 'reprov%') then
      continue;
    end if;
    -- ainda na fila → cancela (não se estorna o que não saiu)
    select e.id into v_id
      from public.sf_estoque_envios e
     where e.ordem_id = t.ordem_id and e.pmo = t.codigo and e.posto = old.posto
       and e.alvo = old.numero_serie_norm and e.operacao = 'entrada' and not e.ok and e.cancelado_em is null
     order by e.criado_em desc limit 1;
    if v_id is not null then
      update public.sf_estoque_envios set cancelado_em = now() where id = v_id;
      continue;
    end if;
    -- já enviada e ainda não estornada → estorno com a mesma op, quantidade e estoque
    select count(*) filter (where e.operacao = 'entrada') - count(*) filter (where e.operacao = 'estorno')
      into v_liquido
      from public.sf_estoque_envios e
     where e.ordem_id = t.ordem_id and e.pmo = t.codigo and e.posto = old.posto
       and e.alvo = old.numero_serie_norm and e.cancelado_em is null;
    if v_liquido <= 0 then
      continue;
    end if;
    select e.op, e.bipe, e.quantidade, e.estoque into v_env
      from public.sf_estoque_envios e
     where e.ordem_id = t.ordem_id and e.pmo = t.codigo and e.posto = old.posto
       and e.alvo = old.numero_serie_norm and e.operacao = 'entrada' and e.ok
     order by e.criado_em desc limit 1;
    insert into public.sf_estoque_envios
      (chave, operacao, pmo, op, posto, tipo, bipe, serie_norm, quantidade, estoque, ordem_id)
    values
      (public.sf_estoque_chave(t.codigo, v_env.op, old.posto, old.numero_serie_norm, 'estorno'), 'estorno',
       t.codigo, v_env.op, old.posto, 'serie', v_env.bipe, old.numero_serie_norm, v_env.quantidade, v_env.estoque,
       t.ordem_id);
  end loop;
  return old;
end
$func$;

revoke all on function public.sf_trecho_enfileirar() from public, anon, authenticated;
revoke all on function public.sf_trecho_desfazer() from public, anon, authenticated;

drop trigger if exists sf_registros_trecho_ins on public.sf_registros;
create trigger sf_registros_trecho_ins after insert on public.sf_registros
  for each row execute function public.sf_trecho_enfileirar();
drop trigger if exists sf_registros_trecho_del on public.sf_registros;
create trigger sf_registros_trecho_del after delete on public.sf_registros
  for each row execute function public.sf_trecho_desfazer();

notify pgrst, 'reload schema';
```

- [ ] **Step 6: Escrever o rollback** (`docs/operacao/estrutura-op/rollback-0184.sql`). As linhas de PRT da fila que já existirem **ficam**. Elas só perdem o `ordem_id`; quem desfaz a 0184 decide o que fazer com elas.

```sql
-- Rollback da 0184 (estrutura da OP). Roda numa transação (psql -1).
drop trigger if exists sf_registros_trecho_ins on public.sf_registros;
drop trigger if exists sf_registros_trecho_del on public.sf_registros;
drop function if exists public.sf_trecho_enfileirar();
drop function if exists public.sf_trecho_desfazer();
drop index if exists public.sf_estoque_envios_ordem;
alter table public.sf_estoque_envios drop column if exists ordem_id;
drop table if exists public.sf_ordem_trechos;
drop table if exists public.sf_estrutura_trechos;
drop table if exists public.sf_estruturas;
notify pgrst, 'reload schema';
```

- [ ] **Step 7: Rodar o harness e ver passar.**
  Run: `bash supabase/tests/rodar-estrutura-op-test.sh`
  Expected: `PROVA ESTRUTURA OK` e `ESTRUTURA OP SQL OK`.

- [ ] **Step 8: Commit.**

```bash
git add supabase/migrations/0184_estrutura_op.sql docs/operacao/estrutura-op/rollback-0184.sql supabase/tests/estrutura_op_esquema.sql supabase/tests/estrutura_op_prova.sql supabase/tests/rodar-estrutura-op-test.sh
git commit -m "feat(estrutura): 0184 receita por PMO, cópia por OP e fila das PRTs pelos registros

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Domínio da estrutura (regras puras)

**Files:**
- Create: `src/modules/shopfloor/domain/estrutura.ts`
- Test: `src/modules/shopfloor/domain/__tests__/estrutura.test.ts`

**Interfaces:**
- Produces (exatos):
  - `type SnModo = 'mesmo' | 'proprio'`
  - `type EstoqueTrecho = 'PA' | 'EINTER'`
  - `interface TrechoReceita { seq: number; codigo: string; descricao: string; postoConclui: string | null; snModo: SnModo; estoque: EstoqueTrecho }`
  - `interface NoArvore { numero: number; codigo: string; descricao: string; nivel: number; mae: number | null }`
  - `validarParaAtivar(trechos: TrechoReceita[], rota: string[], ehAlmoxarifado: (posto: string) => boolean): { ok: true } | { ok: false; erros: string[] }`
  - `sugerirPosto(descricao: string, rota: string[]): string | null`
  - `trechosDaArvore(raiz: number, nos: NoArvore[], rota: string[]): TrechoReceita[]`
  - `casarTrechos(trechos: { seq: number; codigo: string }[], nos: NoArvore[]): Map<number, number | null>`

- [ ] **Step 1: Escrever o teste que falha.**

```ts
import { describe, expect, it } from 'vitest'
import { casarTrechos, sugerirPosto, trechosDaArvore, validarParaAtivar, type NoArvore, type TrechoReceita } from '../estrutura'

const ROTA = ['Printer BOT', 'Inspeção SPI BOT', 'Inspeção AOI BOT', 'Printer TOP', 'Inspeção SPI TOP', 'Inspeção AOI TOP',
  'Montagem PTH', 'Inspeção PTH', 'Teste', 'Embalagem', 'Almoxarifado']
const almox = (p: string) => p === 'Almoxarifado'
const t = (seq: number, codigo: string, postoConclui: string | null, extra: Partial<TrechoReceita> = {}): TrechoReceita =>
  ({ seq, codigo, descricao: '', postoConclui, snModo: 'mesmo', estoque: 'EINTER', ...extra })

// Família real 8498 (PMOC14): 8499 PRT420 PTH (mãe 8498), 8500 PRT410 SMD (mãe 8499).
const ARVORE_8498: NoArvore[] = [
  { numero: 8499, codigo: 'PRT420', descricao: 'PARTES PTH DA PLACA INTERFACE SPECTRUM', nivel: 2, mae: 8498 },
  { numero: 8500, codigo: 'PRT410', descricao: 'PARTES SMD DA PLACA INTERFACE SPECTRUM', nivel: 3, mae: 8499 },
]

describe('sugerirPosto', () => {
  it('SMD → último posto de inspeção SMD/AOI/SPI antes da Montagem PTH', () => {
    expect(sugerirPosto('PARTES SMD DA PLACA', ROTA)).toBe('Inspeção AOI TOP')
  })
  it('PTH → Inspeção PTH', () => {
    expect(sugerirPosto('PARTES PTH DA PLACA', ROTA)).toBe('Inspeção PTH')
  })
  it('sem pista ou posto fora da rota → null', () => {
    expect(sugerirPosto('GABINETE', ROTA)).toBeNull()
    expect(sugerirPosto('PARTES PTH', ['Printer BOT', 'Teste'])).toBeNull()
  })
})

describe('trechosDaArvore', () => {
  it('ordena do mais fundo para cima (SMD antes da PTH) e sugere os postos', () => {
    expect(trechosDaArvore(8498, ARVORE_8498, ROTA)).toEqual([
      t(1, 'PRT410', 'Inspeção AOI TOP', { descricao: 'PARTES SMD DA PLACA INTERFACE SPECTRUM' }),
      t(2, 'PRT420', 'Inspeção PTH', { descricao: 'PARTES PTH DA PLACA INTERFACE SPECTRUM' }),
    ])
  })
  it('ignora OPs da família que não descendem da raiz (ex.: gabinete irmão)', () => {
    const nos = [...ARVORE_8498, { numero: 8501, codigo: 'PMOC36', descricao: 'GABINETE', nivel: 2, mae: 8497 }]
    expect(trechosDaArvore(8498, nos, ROTA).map((x) => x.codigo)).toEqual(['PRT410', 'PRT420'])
  })
})

describe('casarTrechos', () => {
  it('casa pelo código, sem diferenciar maiúsculas/espaços; o que não acha vira null', () => {
    const m = casarTrechos([{ seq: 1, codigo: ' prt410 ' }, { seq: 2, codigo: 'PRT420' }, { seq: 3, codigo: 'PRT999' }], ARVORE_8498)
    expect([...m]).toEqual([[1, 8500], [2, 8499], [3, null]])
  })
  it('código repetido na árvore → o de menor número', () => {
    const nos = [...ARVORE_8498, { numero: 8510, codigo: 'PRT410', descricao: '', nivel: 3, mae: 8499 }]
    expect(casarTrechos([{ seq: 1, codigo: 'PRT410' }], nos).get(1)).toBe(8500)
  })
})

describe('validarParaAtivar', () => {
  it('receita boa passa', () => {
    expect(validarParaAtivar([t(1, 'PRT410', 'Inspeção AOI TOP'), t(2, 'PRT420', 'Inspeção PTH')], ROTA, almox)).toEqual({ ok: true })
  })
  it('acusa posto vazio, fora da rota, repetido, fora de ordem, no Almoxarifado e SN próprio', () => {
    const r = validarParaAtivar(
      [
        t(1, 'PRT1', null),
        t(2, 'PRT2', 'Burn-in'),
        t(3, 'PRT3', 'Inspeção PTH'),
        t(4, 'PRT4', 'Inspeção PTH'),
        t(5, 'PRT5', 'Inspeção AOI TOP'),
        t(6, 'PRT6', 'Almoxarifado'),
        t(7, 'PRT7', 'Teste', { snModo: 'proprio' }),
      ],
      ROTA,
      almox,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erros).toEqual([
      'PRT1: escolha o posto que conclui este trecho.',
      'PRT2: o posto "Burn-in" não está na rota da PMO.',
      'PRT4: o posto "Inspeção PTH" já conclui outro trecho.',
      'PRT5: os trechos precisam seguir a ordem da rota (este posto vem antes do trecho anterior).',
      'PRT6: o Almoxarifado é o posto da PMO, não de uma PRT.',
      'PRT7: SN próprio ainda não suportado.',
    ])
  })
  it('receita sem trechos não ativa', () => {
    expect(validarParaAtivar([], ROTA, almox)).toEqual({ ok: false, erros: ['A estrutura não tem nenhum trecho.'] })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar.**
  Run: `npx vitest run src/modules/shopfloor/domain/__tests__/estrutura.test.ts`
  Expected: FAIL ("Failed to resolve import '../estrutura'").

- [ ] **Step 3: Implementar** (`src/modules/shopfloor/domain/estrutura.ts`).

```ts
/**
 * ESTRUTURA DA OP (spec 2026-11-13): a receita de uma PMO diz em que posto termina cada PRT (trecho). Regras
 * puras — sem banco nem Compels — para a tela Estruturas, a importação do Compels e a criação da OP.
 */
export type SnModo = 'mesmo' | 'proprio'
export type EstoqueTrecho = 'PA' | 'EINTER'

export interface TrechoReceita {
  /** Ordem do trecho na rota: 1 = o mais fundo (SMD), depois PTH… */
  seq: number
  /** Código da PRT no Compels (ex.: PRT410). */
  codigo: string
  descricao: string
  /** Posto da rota que conclui o trecho; null = ainda não escolhido (rascunho). */
  postoConclui: string | null
  snModo: SnModo
  estoque: EstoqueTrecho
}

/** Uma OP do Compels na árvore abaixo da OP da PMO. */
export interface NoArvore {
  numero: number
  codigo: string
  descricao: string
  nivel: number
  /** Número da OP mãe (null na raiz). */
  mae: number | null
}

const norm = (s: string) => s.trim().toUpperCase()

/** Sugestão de posto pela descrição da PRT: SMD → última inspeção SMD/AOI/SPI antes da PTH; PTH → Inspeção PTH. */
export function sugerirPosto(descricao: string, rota: string[]): string | null {
  const d = norm(descricao)
  if (/\bPTH\b/.test(d)) return rota.find((p) => norm(p) === 'INSPEÇÃO PTH') ?? null
  if (/\bSM[DT]\b/.test(d)) {
    const fimSmd = rota.findIndex((p) => /PTH/i.test(p))
    const antes = fimSmd >= 0 ? rota.slice(0, fimSmd) : rota
    const candidatos = antes.filter((p) => /AOI|SPI|SMD/i.test(p) && /INSPE/i.test(p))
    return candidatos.at(-1) ?? null
  }
  return null
}

/** Descendentes da raiz (pela cadeia de mães), do mais fundo para cima, como trechos de receita em rascunho. */
export function trechosDaArvore(raiz: number, nos: NoArvore[], rota: string[]): TrechoReceita[] {
  const porNumero = new Map(nos.map((n) => [n.numero, n]))
  const desce = (n: NoArvore): boolean => {
    let atual: NoArvore | undefined = n
    for (let i = 0; i < 20 && atual; i++) {
      if (atual.mae === raiz) return true
      atual = atual.mae === null ? undefined : porNumero.get(atual.mae)
    }
    return false
  }
  return nos
    .filter(desce)
    .sort((a, b) => b.nivel - a.nivel || a.numero - b.numero)
    .map((n, i) => ({
      seq: i + 1,
      codigo: n.codigo,
      descricao: n.descricao,
      postoConclui: sugerirPosto(n.descricao, rota),
      snModo: 'mesmo' as const,
      estoque: 'EINTER' as const,
    }))
}

/** Para cada trecho, a OP filha do Compels com o mesmo código (a de menor número se houver mais de uma). */
export function casarTrechos(trechos: { seq: number; codigo: string }[], nos: NoArvore[]): Map<number, number | null> {
  const m = new Map<number, number | null>()
  for (const t of trechos) {
    const achadas = nos.filter((n) => norm(n.codigo) === norm(t.codigo)).map((n) => n.numero).sort((a, b) => a - b)
    m.set(t.seq, achadas[0] ?? null)
  }
  return m
}

/** Pode ativar? Mensagens na ordem dos trechos, uma por problema. */
export function validarParaAtivar(
  trechos: TrechoReceita[],
  rota: string[],
  ehAlmoxarifado: (posto: string) => boolean,
): { ok: true } | { ok: false; erros: string[] } {
  if (trechos.length === 0) return { ok: false, erros: ['A estrutura não tem nenhum trecho.'] }
  const erros: string[] = []
  const usados = new Set<string>()
  let ultimaPos = -1
  for (const t of [...trechos].sort((a, b) => a.seq - b.seq)) {
    if (!t.postoConclui) { erros.push(`${t.codigo}: escolha o posto que conclui este trecho.`); continue }
    if (ehAlmoxarifado(t.postoConclui)) { erros.push(`${t.codigo}: o Almoxarifado é o posto da PMO, não de uma PRT.`); continue }
    const pos = rota.indexOf(t.postoConclui)
    if (pos < 0) { erros.push(`${t.codigo}: o posto "${t.postoConclui}" não está na rota da PMO.`); continue }
    if (usados.has(t.postoConclui)) { erros.push(`${t.codigo}: o posto "${t.postoConclui}" já conclui outro trecho.`); continue }
    if (pos < ultimaPos) { erros.push(`${t.codigo}: os trechos precisam seguir a ordem da rota (este posto vem antes do trecho anterior).`); continue }
    if (t.snModo === 'proprio') { erros.push(`${t.codigo}: SN próprio ainda não suportado.`); continue }
    usados.add(t.postoConclui)
    ultimaPos = pos
  }
  return erros.length ? { ok: false, erros } : { ok: true }
}
```

- [ ] **Step 4: Rodar e ver passar.**
  Run: `npx vitest run src/modules/shopfloor/domain/__tests__/estrutura.test.ts`
  Expected: PASS (todos).

- [ ] **Step 5: Commit.**

```bash
git add src/modules/shopfloor/domain/estrutura.ts src/modules/shopfloor/domain/__tests__/estrutura.test.ts
git commit -m "feat(estrutura): regras da receita (sugestão de posto, árvore, casamento, validação)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Ler a árvore de OPs no Compels

**Files:**
- Create: `src/modules/compels/domain/arvore-op.ts`
- Modify: `src/modules/compels/infra/cliente.ts` (dois métodos novos no fim da classe)
- Test: `src/modules/compels/domain/__tests__/arvore-op.test.ts`, `src/modules/compels/infra/__tests__/cliente.test.ts` (casos novos)

**Interfaces:**
- Consumes: `NoArvore` de `src/modules/shopfloor/domain/estrutura.ts` (Task 2). O módulo compels **não importa** de shopfloor, por isso o tipo é redeclarado igual aqui.
- Produces:
  - `noDaLinhaOp(linha: unknown, detalhe: unknown): NoOp | null`, com `interface NoOp { numero: number; codigo: string; descricao: string; nivel: number; mae: number | null; principal: number | null; status: string }`
  - `ClienteCompels.lerNoOp(numero: number): Promise<NoOp | null>`
  - `ClienteCompels.lerDescendentes(numero: number): Promise<NoOp[]>`: só os descendentes, sem a raiz; varre os números seguintes enquanto a OP-principal for a mesma (máx. 25).

- [ ] **Step 1: Teste de domínio que falha** (`src/modules/compels/domain/__tests__/arvore-op.test.ts`). Formato real visto em 11/11 no `estrutura-op.mjs`:

```ts
import { describe, expect, it } from 'vitest'
import { noDaLinhaOp } from '../arvore-op'

const LINHA_8683 = { id: 13061, numero: 8683, status: 'Em Processo', nivel: 3, ordemProducaoMaeNumero: 8682, ordemProducaoPrincipalNumero: 8681 }
const DET_8683 = { data: { composicaoProduto: { item: { codigo: 'PRT706', descricao: 'PARTES PTH DA PLACA FONTE FACIAL ' } } } }

describe('noDaLinhaOp', () => {
  it('monta o nó com mãe, principal, nível e o código do produto', () => {
    expect(noDaLinhaOp(LINHA_8683, DET_8683)).toEqual({
      numero: 8683, codigo: 'PRT706', descricao: 'PARTES PTH DA PLACA FONTE FACIAL', nivel: 3, mae: 8682, principal: 8681, status: 'Em Processo',
    })
  })
  it('raiz sem mãe/principal → null nesses campos; nível ausente vale 1', () => {
    const n = noDaLinhaOp({ numero: 8681, status: 'Aberta' }, { data: { composicaoProduto: { item: { codigo: 'PMOF48', descricao: 'COLETOR' } } } })
    expect(n).toMatchObject({ numero: 8681, mae: null, principal: null, nivel: 1 })
  })
  it('sem código do produto → null (resposta inesperada não vira nó)', () => {
    expect(noDaLinhaOp(LINHA_8683, { data: {} })).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar.**
  Run: `npx vitest run src/modules/compels/domain/__tests__/arvore-op.test.ts`
  Expected: FAIL (import não resolve).

- [ ] **Step 3: Implementar** (`src/modules/compels/domain/arvore-op.ts`).

```ts
/**
 * Uma OP do Compels como nó da árvore mãe→filhas (estudo de 11/11/2026): a LISTA de OPs (`findAllFilter`) traz
 * `nivel`, `ordemProducaoMaeNumero` e `ordemProducaoPrincipalNumero`; o código do produto só vem no DETALHE
 * (`findById` → composicaoProduto.item). Nó sem código = resposta inesperada → null (nunca inventa).
 */
export interface NoOp {
  numero: number
  codigo: string
  descricao: string
  nivel: number
  mae: number | null
  principal: number | null
  status: string
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function noDaLinhaOp(linha: unknown, detalhe: unknown): NoOp | null {
  const l = (linha ?? {}) as Record<string, unknown>
  const d = ((detalhe as { data?: unknown } | null)?.data ?? detalhe ?? {}) as Record<string, unknown>
  const item = (d.composicaoProduto as { item?: Record<string, unknown> } | undefined)?.item
  const numero = num(l.numero)
  if (numero === null || typeof item?.codigo !== 'string' || item.codigo.trim() === '') return null
  return {
    numero,
    codigo: item.codigo.trim(),
    descricao: typeof item.descricao === 'string' ? item.descricao.trim() : '',
    nivel: num(l.nivel) ?? 1,
    mae: num(l.ordemProducaoMaeNumero),
    principal: num(l.ordemProducaoPrincipalNumero),
    status: typeof l.status === 'string' ? l.status : '',
  }
}
```

- [ ] **Step 4: Rodar e ver passar.**
  Run: `npx vitest run src/modules/compels/domain/__tests__/arvore-op.test.ts`
  Expected: PASS.

- [ ] **Step 5: Teste do cliente que falha.** Acrescente no fim do `describe('ClienteCompels')` de `src/modules/compels/infra/__tests__/cliente.test.ts`, antes do `})` final:

```ts
  it('lerDescendentes: varre os números seguintes da mesma principal e devolve só quem descende da raiz', async () => {
    const LISTA: Record<number, Record<string, unknown>> = {
      8682: { id: 2, numero: 8682, status: 'Em Processo', nivel: 2, ordemProducaoMaeNumero: 8681, ordemProducaoPrincipalNumero: 8681 },
      8683: { id: 3, numero: 8683, status: 'Em Processo', nivel: 3, ordemProducaoMaeNumero: 8682, ordemProducaoPrincipalNumero: 8681 },
      8684: { id: 4, numero: 8684, status: 'Em Processo', nivel: 4, ordemProducaoMaeNumero: 8683, ordemProducaoPrincipalNumero: 8681 },
      8685: { id: 5, numero: 8685, status: 'Aberta', nivel: 2, ordemProducaoMaeNumero: 8681, ordemProducaoPrincipalNumero: 8681 },
      8686: { id: 6, numero: 8686, status: 'Aberta', nivel: 1, ordemProducaoMaeNumero: null, ordemProducaoPrincipalNumero: null },
    }
    const COD: Record<string, string> = { '2': 'PMOF52', '3': 'PRT706', '4': 'PRT705', '5': 'PMOF51', '6': 'OUTRA' }
    const { buscar } = fingirCompels({
      '/ordemProducaoSimples/findAllFilter': () => json({ data: [] }),
    })
    const buscarComArvore = (async (url: string | URL | Request, init: RequestInit = {}) => {
      const u = String(url).replace('https://api.erpeasy.compels.net', '')
      const corpo = init.body as URLSearchParams | undefined
      if (u.startsWith('/ordemProducaoSimples/findAllFilter')) {
        const n = Number(JSON.parse(corpo!.get('filtro')!).numero)
        return json({ data: LISTA[n] ? [LISTA[n]] : [] })
      }
      if (u.startsWith('/ordemProducaoSimples/findById')) {
        return json({ data: { composicaoProduto: { item: { codigo: COD[corpo!.get('id')!], descricao: 'X' } } } })
      }
      return buscar(url, init)
    }) as unknown as typeof fetch
    const c = new ClienteCompels(config, tokenFixo(), buscarComArvore)
    const desc = await c.lerDescendentes(8682)
    expect(desc.map((n) => [n.numero, n.codigo])).toEqual([[8683, 'PRT706'], [8684, 'PRT705']])
    expect(await c.lerNoOp(9999)).toBeNull()
  })
```

- [ ] **Step 6: Rodar e ver falhar.**
  Run: `npx vitest run src/modules/compels/infra/__tests__/cliente.test.ts`
  Expected: FAIL ("c.lerDescendentes is not a function").

- [ ] **Step 7: Implementar no cliente.**
  - Em `src/modules/compels/infra/cliente.ts`, junte ao import do topo: `import { noDaLinhaOp, type NoOp } from '../domain/arvore-op'`.
  - Antes da última `}` da classe, acrescente:

```ts
  /** Uma OP como nó da árvore (número, código, mãe, principal, nível). `null` = não existe ou resposta sem código. */
  async lerNoOp(numero: number): Promise<NoOp | null> {
    const filtro = {
      numero: String(numero), codigoNegociante: null, nomeNegociante: null, cpfCnpjNegociante: null,
      clientePedido: '', item: '', linha: '', tipoPropriedade: null, statusList: null,
      selecionarPor: 'Data Documento',
      dataInicial: dataIso(this.agora() - TRES_ANOS_MS), dataFinal: dataIso(this.agora()),
      numeroPedido: '', centroCusto: '', listarPendentes: false, prototipo: false, etapa: '',
      selecionarOPPor: 'op', observacao: '', nivel: '', responsavelCriacao: '', responsavelAlteracao: '',
      situacaoId: null, semVinculoComSolicitacaoInternaCompra: false,
    }
    const busca = await this.json(
      '/ordemProducaoSimples/findAllFilter',
      this.formulario({ sortFilter: 'null', filtro: JSON.stringify(filtro), page: '1', start: '0', limit: '25' }),
    )
    const linha = listaDe(busca, 'busca de OP').find((o) => o.numero === numero)
    if (!linha || typeof linha.id !== 'number') return null
    const detalhe = await this.json(
      '/ordemProducaoSimples/findById',
      this.formulario({ id: String(linha.id), page: '1', start: '0', limit: '25' }),
    )
    return noDaLinhaOp(linha, detalhe)
  }

  /**
   * Os DESCENDENTES de uma OP (filhas, netas…). No Compels a família é numerada em sequência (8681, 8682, 8683…),
   * então varre os números seguintes enquanto a OP principal for a mesma; para no primeiro que não existe ou é de
   * outra família. Devolve só quem descende da OP pedida (a fonte 8682 não leva o gabinete 8685, irmão dela).
   */
  async lerDescendentes(numero: number): Promise<NoOp[]> {
    const raiz = await this.lerNoOp(numero)
    if (!raiz) return []
    const familia = raiz.principal ?? raiz.numero
    const nos: NoOp[] = []
    for (let n = numero + 1, i = 0; i < 25; n++, i++) {
      const no = await this.lerNoOp(n)
      if (!no || (no.principal ?? no.numero) !== familia) break
      nos.push(no)
    }
    const porNumero = new Map(nos.map((x) => [x.numero, x]))
    const desce = (x: NoOp): boolean => {
      let atual: NoOp | undefined = x
      for (let i = 0; i < 20 && atual; i++) {
        if (atual.mae === numero) return true
        atual = atual.mae === null ? undefined : porNumero.get(atual.mae)
      }
      return false
    }
    return nos.filter(desce)
  }
```

- [ ] **Step 8: Rodar e ver passar.**
  Run: `npx vitest run src/modules/compels`
  Expected: PASS (inclui os testes antigos do cliente).

- [ ] **Step 9: Commit.**

```bash
git add src/modules/compels/domain/arvore-op.ts src/modules/compels/domain/__tests__/arvore-op.test.ts src/modules/compels/infra/cliente.ts src/modules/compels/infra/__tests__/cliente.test.ts
git commit -m "feat(compels): ler a árvore de OPs (nó e descendentes) para a estrutura

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Repositório + actions da estrutura (salvar, ativar, ler/importar do Compels, aplicar na OP)

**Files:**
- Create: `src/modules/shopfloor/infra/estrutura-repository.ts`
- Create: `src/modules/shopfloor/application/estrutura-actions.ts`
- Modify: `src/modules/shopfloor/application/ordens-actions.ts` (chamar `aplicarEstruturaNaOp` depois de `criarOrdem` e depois de `atualizarOrdem`)
- Test: `src/modules/shopfloor/application/__tests__/estrutura-actions.test.ts`

**Interfaces:**
- Consumes:
  - Task 2: `TrechoReceita`, `NoArvore`, `trechosDaArvore`, `casarTrechos`, `validarParaAtivar`
  - Task 3: `ClienteCompels.lerDescendentes`
- Produces:
  - Repositório:
    - `listarEstruturas(): Promise<EstruturaView[]>`, com `interface EstruturaView { pmo: string; situacao: 'rascunho'|'ativa'; origem: string; trechos: TrechoReceita[] }`
    - `salvarEstrutura(pmo: string, trechos: TrechoReceita[], usuario: string, origem?: string): Promise<void>`: substitui os trechos e volta a situação para `rascunho`
    - `marcarAtiva(pmo: string, usuario: string): Promise<void>`
    - `rotaDeReferencia(pmo: string): Promise<string[]>`: rota da OP mais recente da PMO
    - `ultimaOpNumericaPorPmo(): Promise<{ pmo: string; op: string }[]>`
    - `copiarParaOp(ordemId: string, pmo: string, rotaDaOp: string[]): Promise<{ seq: number; codigo: string }[]>`
    - `gravarFilhas(ordemId: string, filhas: Map<number, number | null>): Promise<void>`
  - Actions (`'use server'`):
    - `salvarEstruturaAction(pmo, trechos)`
    - `ativarEstruturaAction(pmo)`
    - `lerDoCompelsAction(pmo, op)`
    - `importarDoCompelsAction()`
    - `aplicarEstruturaNaOp(ordemId, pmo, op, rota)`: não lança; devolve um aviso em texto ou `null`

  Todas devolvem `{ ok: true, … } | { ok: false; erro: string }`.

- [ ] **Step 1: Teste que falha** (`src/modules/shopfloor/application/__tests__/estrutura-actions.test.ts`). O teste usa mocks do repositório, do cliente e da sessão, seguindo o padrão dos outros testes de actions do módulo: `vi.mock` do caminho.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const repo = vi.hoisted(() => ({
  listarEstruturas: vi.fn(), salvarEstrutura: vi.fn(), marcarAtiva: vi.fn(), rotaDeReferencia: vi.fn(),
  ultimaOpNumericaPorPmo: vi.fn(), copiarParaOp: vi.fn(), gravarFilhas: vi.fn(), estruturaDaPmo: vi.fn(),
}))
const compels = vi.hoisted(() => ({ lerDescendentes: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao: vi.fn(async () => ({ perfil: 'admin', nome: 'Matheus', email: 'm@x' })) }))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: vi.fn(() => true) }))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog: vi.fn() }))
vi.mock('../../infra/estrutura-repository', () => repo)
vi.mock('../../infra/postos-repository', () => ({ mapaPostoPerfil: vi.fn(async () => ({ Almoxarifado: { recurso: 'almoxarifado' } })) }))
vi.mock('@/modules/compels/infra/cliente', () => ({ ClienteCompels: vi.fn(() => compels) }))
vi.mock('@/modules/compels/infra/config', () => ({ configDoAmbiente: vi.fn(() => ({})), ConfiguracaoIncompleta: class extends Error {} }))

import { aplicarEstruturaNaOp, ativarEstruturaAction, importarDoCompelsAction, lerDoCompelsAction } from '../estrutura-actions'

const ROTA = ['Inspeção AOI TOP', 'Montagem PTH', 'Inspeção PTH', 'Teste', 'Almoxarifado']
beforeEach(() => { vi.clearAllMocks(); repo.rotaDeReferencia.mockResolvedValue(ROTA) })

describe('lerDoCompelsAction', () => {
  it('lê a árvore da OP e devolve os trechos sugeridos', async () => {
    compels.lerDescendentes.mockResolvedValue([
      { numero: 8499, codigo: 'PRT420', descricao: 'PARTES PTH', nivel: 2, mae: 8498, principal: 8498, status: '' },
      { numero: 8500, codigo: 'PRT410', descricao: 'PARTES SMD', nivel: 3, mae: 8499, principal: 8498, status: '' },
    ])
    const r = await lerDoCompelsAction('PMOC14', '8498')
    expect(r).toMatchObject({ ok: true, trechos: [{ codigo: 'PRT410', postoConclui: 'Inspeção AOI TOP' }, { codigo: 'PRT420', postoConclui: 'Inspeção PTH' }] })
  })
  it('OP com sufixo (_F) consulta o número sem sufixo', async () => {
    compels.lerDescendentes.mockResolvedValue([])
    await lerDoCompelsAction('PMOF52_F', '8682_F')
    expect(compels.lerDescendentes).toHaveBeenCalledWith(8682)
  })
})

describe('ativarEstruturaAction', () => {
  it('recusa com as mensagens da validação', async () => {
    repo.estruturaDaPmo.mockResolvedValue({ pmo: 'P', situacao: 'rascunho', origem: 'manual', trechos: [{ seq: 1, codigo: 'PRT1', descricao: '', postoConclui: null, snModo: 'mesmo', estoque: 'EINTER' }] })
    expect(await ativarEstruturaAction('P')).toEqual({ ok: false, erro: 'PRT1: escolha o posto que conclui este trecho.' })
    expect(repo.marcarAtiva).not.toHaveBeenCalled()
  })
  it('ativa quando está tudo certo', async () => {
    repo.estruturaDaPmo.mockResolvedValue({ pmo: 'P', situacao: 'rascunho', origem: 'manual', trechos: [{ seq: 1, codigo: 'PRT1', descricao: '', postoConclui: 'Inspeção PTH', snModo: 'mesmo', estoque: 'EINTER' }] })
    expect(await ativarEstruturaAction('P')).toEqual({ ok: true })
    expect(repo.marcarAtiva).toHaveBeenCalledWith('P', 'Matheus')
  })
})

describe('importarDoCompelsAction', () => {
  it('cria rascunho só para PMO sem estrutura e com filhas; conta as sem filhas', async () => {
    repo.listarEstruturas.mockResolvedValue([{ pmo: 'JA', situacao: 'ativa', origem: 'manual', trechos: [] }])
    repo.ultimaOpNumericaPorPmo.mockResolvedValue([{ pmo: 'JA', op: '1' }, { pmo: 'PMOC14', op: '8498' }, { pmo: 'SOLO', op: '8739' }])
    compels.lerDescendentes.mockImplementation(async (n: number) =>
      n === 8498 ? [{ numero: 8499, codigo: 'PRT420', descricao: 'PARTES PTH', nivel: 2, mae: 8498, principal: 8498, status: '' }] : [])
    const r = await importarDoCompelsAction()
    expect(r).toEqual({ ok: true, criadas: 1, semFilhas: 1, falhas: 0 })
    expect(repo.salvarEstrutura).toHaveBeenCalledTimes(1)
    expect(repo.salvarEstrutura.mock.calls[0]![0]).toBe('PMOC14')
    expect(repo.salvarEstrutura.mock.calls[0]![3]).toBe('compels:8498')
  })
})

describe('aplicarEstruturaNaOp', () => {
  it('PMO sem estrutura ativa: não copia nada e não avisa', async () => {
    repo.copiarParaOp.mockResolvedValue([])
    expect(await aplicarEstruturaNaOp('id', 'P', '1', ROTA)).toBeNull()
    expect(compels.lerDescendentes).not.toHaveBeenCalled()
  })
  it('copia, casa as filhas e avisa o que não achou', async () => {
    repo.copiarParaOp.mockResolvedValue([{ seq: 1, codigo: 'PRT410' }, { seq: 2, codigo: 'PRT420' }])
    compels.lerDescendentes.mockResolvedValue([{ numero: 8500, codigo: 'PRT410', descricao: '', nivel: 3, mae: 8499, principal: 8498, status: '' }])
    const aviso = await aplicarEstruturaNaOp('id', 'PMOC14', '8498', ROTA)
    expect(repo.gravarFilhas).toHaveBeenCalledWith('id', new Map([[1, 8500], [2, null]]))
    expect(aviso).toBe('PRT420 não foi encontrada no Compels abaixo da OP 8498: esse trecho não será apontado até a OP ser salva de novo.')
  })
  it('Compels fora do ar: a OP segue, com aviso', async () => {
    repo.copiarParaOp.mockResolvedValue([{ seq: 1, codigo: 'PRT410' }])
    compels.lerDescendentes.mockRejectedValue(new Error('rede'))
    expect(await aplicarEstruturaNaOp('id', 'PMOC14', '8498', ROTA)).toBe(
      'Não foi possível consultar o Compels agora: as OPs filhas serão procuradas quando a OP for salva de novo.')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar.**
  Run: `npx vitest run src/modules/shopfloor/application/__tests__/estrutura-actions.test.ts`
  Expected: FAIL (import não resolve).

- [ ] **Step 3: Implementar o repositório** (`src/modules/shopfloor/infra/estrutura-repository.ts`).

```ts
import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { EstoqueTrecho, SnModo, TrechoReceita } from '../domain/estrutura'

export interface EstruturaView {
  pmo: string
  situacao: 'rascunho' | 'ativa'
  origem: string
  trechos: TrechoReceita[]
}

interface LinhaTrecho { seq: number; codigo: string; descricao: string; posto_conclui: string | null; sn_modo: SnModo; estoque: EstoqueTrecho }
const paraTrecho = (l: LinhaTrecho): TrechoReceita => ({
  seq: l.seq, codigo: l.codigo, descricao: l.descricao, postoConclui: l.posto_conclui, snModo: l.sn_modo, estoque: l.estoque,
})

export async function listarEstruturas(): Promise<EstruturaView[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb
    .from('sf_estruturas')
    .select('pmo, situacao, origem, sf_estrutura_trechos(seq, codigo, descricao, posto_conclui, sn_modo, estoque)')
    .order('pmo')
  if (error) throw new Error(`sf_estruturas: ${error.message}`)
  return ((data ?? []) as unknown as (Omit<EstruturaView, 'trechos'> & { sf_estrutura_trechos: LinhaTrecho[] })[]).map((e) => ({
    pmo: e.pmo, situacao: e.situacao, origem: e.origem,
    trechos: [...e.sf_estrutura_trechos].sort((a, b) => a.seq - b.seq).map(paraTrecho),
  }))
}

export async function estruturaDaPmo(pmo: string): Promise<EstruturaView | null> {
  return (await listarEstruturas()).find((e) => e.pmo === pmo) ?? null
}

/** Grava a receita inteira (substitui os trechos) e volta para rascunho: mudou, precisa conferir e ativar de novo. */
export async function salvarEstrutura(pmo: string, trechos: TrechoReceita[], usuario: string, origem?: string): Promise<void> {
  const sb = await createServerSupabase()
  const agora = new Date().toISOString()
  const { error: e1 } = await sb.from('sf_estruturas').upsert(
    { pmo, situacao: 'rascunho', alterado_em: agora, alterado_por: usuario, ...(origem ? { origem } : {}), criado_por: usuario },
    { onConflict: 'pmo', ignoreDuplicates: false },
  )
  if (e1) throw new Error(`sf_estruturas: ${e1.message}`)
  const { error: e2 } = await sb.from('sf_estrutura_trechos').delete().eq('pmo', pmo)
  if (e2) throw new Error(`sf_estrutura_trechos (limpar): ${e2.message}`)
  if (trechos.length === 0) return
  const { error: e3 } = await sb.from('sf_estrutura_trechos').insert(
    trechos.map((t) => ({ pmo, seq: t.seq, codigo: t.codigo.trim(), descricao: t.descricao, posto_conclui: t.postoConclui, sn_modo: t.snModo, estoque: t.estoque })),
  )
  if (e3) throw new Error(`sf_estrutura_trechos: ${e3.message}`)
}

export async function marcarAtiva(pmo: string, usuario: string): Promise<void> {
  const sb = await createServerSupabase()
  const { error } = await sb.from('sf_estruturas').update({ situacao: 'ativa', alterado_em: new Date().toISOString(), alterado_por: usuario }).eq('pmo', pmo)
  if (error) throw new Error(`sf_estruturas (ativar): ${error.message}`)
}

/** Rota da OP mais recente da PMO (a referência para validar os postos da receita). */
export async function rotaDeReferencia(pmo: string): Promise<string[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb
    .from('sf_ordens').select('created_at, sf_ordem_postos(posto, ordem)')
    .eq('pmo', pmo).order('created_at', { ascending: false }).limit(1)
  if (error) throw new Error(`rota da PMO: ${error.message}`)
  const postos = ((data?.[0] as { sf_ordem_postos?: { posto: string; ordem: number }[] } | undefined)?.sf_ordem_postos ?? [])
  return [...postos].sort((a, b) => a.ordem - b.ordem).map((p) => p.posto)
}

/** A OP mais recente (com número só de dígitos, opcionalmente com sufixo _/_F) de cada PMO do ShopFloor. */
export async function ultimaOpNumericaPorPmo(): Promise<{ pmo: string; op: string }[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.from('sf_ordens').select('pmo, op, created_at').order('created_at', { ascending: false })
  if (error) throw new Error(`sf_ordens: ${error.message}`)
  const vistas = new Map<string, string>()
  for (const o of (data ?? []) as { pmo: string; op: string }[]) {
    const pmo = o.pmo.replace(/_[A-Za-z]*$/, '')
    if (!vistas.has(pmo) && /^\d+/.test(o.op)) vistas.set(pmo, o.op)
  }
  return [...vistas].map(([pmo, op]) => ({ pmo, op }))
}

/**
 * Copia a receita ATIVA da PMO para a OP (substitui a cópia anterior; só trechos cujo posto está na rota da OP).
 * Devolve os trechos copiados (vazio = PMO sem estrutura ativa).
 */
export async function copiarParaOp(ordemId: string, pmo: string, rotaDaOp: string[]): Promise<{ seq: number; codigo: string }[]> {
  const e = await estruturaDaPmo(pmo.replace(/_[A-Za-z]*$/, ''))
  const sb = await createServerSupabase()
  const { error: e1 } = await sb.from('sf_ordem_trechos').delete().eq('ordem_id', ordemId)
  if (e1) throw new Error(`sf_ordem_trechos (limpar): ${e1.message}`)
  if (!e || e.situacao !== 'ativa') return []
  const validos = e.trechos.filter((t) => t.postoConclui && rotaDaOp.includes(t.postoConclui))
  if (validos.length === 0) return []
  const { error: e2 } = await sb.from('sf_ordem_trechos').insert(
    validos.map((t) => ({ ordem_id: ordemId, seq: t.seq, codigo: t.codigo, posto_conclui: t.postoConclui, sn_modo: t.snModo, estoque: t.estoque })),
  )
  if (e2) throw new Error(`sf_ordem_trechos: ${e2.message}`)
  return validos.map((t) => ({ seq: t.seq, codigo: t.codigo }))
}

/** Grava a OP filha casada de cada trecho e corrige as linhas da fila que nasceram sem ela (op = ''). */
export async function gravarFilhas(ordemId: string, filhas: Map<number, number | null>): Promise<void> {
  const sb = await createServerSupabase()
  for (const [seq, numero] of filhas) {
    const { data, error } = await sb.from('sf_ordem_trechos')
      .update({ compels_op: numero === null ? null : String(numero) })
      .eq('ordem_id', ordemId).eq('seq', seq).select('codigo')
    if (error) throw new Error(`sf_ordem_trechos (filha): ${error.message}`)
    const codigo = (data?.[0] as { codigo?: string } | undefined)?.codigo
    if (numero !== null && codigo) {
      const { error: e2 } = await sb.from('sf_estoque_envios').update({ op: String(numero) })
        .eq('ordem_id', ordemId).eq('pmo', codigo).eq('op', '').eq('ok', false).is('cancelado_em', null)
      if (e2) throw new Error(`sf_estoque_envios (filha): ${e2.message}`)
    }
  }
}
```

  ⚠️ O `update` em `sf_estoque_envios` precisa de permissão. Se a RLS da fila não deixar o usuário administrador atualizar, troque `createServerSupabase()` por `createServiceSupabase()` (de `@/shared/lib/supabase/service`) **só nesse trecho**. A action já conferiu a permissão `shopfloor.administrar` antes. Confira a política da fila na 0132 e anote no commit qual cliente foi usado.

- [ ] **Step 4: Implementar as actions** (`src/modules/shopfloor/application/estrutura-actions.ts`).

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { ClienteCompels } from '@/modules/compels/infra/cliente'
import { configDoAmbiente } from '@/modules/compels/infra/config'
import { casarTrechos, trechosDaArvore, validarParaAtivar, type NoArvore, type TrechoReceita } from '../domain/estrutura'
import { mapaPostoPerfil } from '../infra/postos-repository'
import {
  copiarParaOp, estruturaDaPmo, gravarFilhas, listarEstruturas, marcarAtiva, rotaDeReferencia, salvarEstrutura, ultimaOpNumericaPorPmo,
} from '../infra/estrutura-repository'

type Resultado<T = object> = ({ ok: true } & T) | { ok: false; erro: string }
const SEM_PERMISSAO = 'Você não tem permissão para gerenciar estruturas.'
const numeroDaOp = (op: string) => Number(/^(\d+)/.exec(op.trim())?.[1] ?? NaN)

async function sessaoAdmin() {
  const s = await getSessao()
  return s && podeNoModulo(s.perfil, 'shopfloor', 'administrar') ? s : null
}

async function descendentes(op: string): Promise<NoArvore[]> {
  const n = numeroDaOp(op)
  if (!Number.isInteger(n)) return []
  const cliente = new ClienteCompels(configDoAmbiente())
  return (await cliente.lerDescendentes(n)).map(({ numero, codigo, descricao, nivel, mae }) => ({ numero, codigo, descricao, nivel, mae }))
}

const ehAlmox = async () => {
  const perfis = await mapaPostoPerfil()
  return (p: string) => (perfis as Record<string, { recurso?: string }>)[p]?.recurso === 'almoxarifado'
}

export async function salvarEstruturaAction(pmo: string, trechos: TrechoReceita[]): Promise<Resultado> {
  const s = await sessaoAdmin()
  if (!s) return { ok: false, erro: SEM_PERMISSAO }
  const alvo = pmo.trim()
  if (!alvo) return { ok: false, erro: 'Informe a PMO.' }
  if (trechos.some((t) => !t.codigo.trim())) return { ok: false, erro: 'Todo trecho precisa do código da PRT.' }
  try {
    await salvarEstrutura(alvo, trechos.map((t, i) => ({ ...t, seq: i + 1 })), s.nome || s.email)
  } catch {
    return { ok: false, erro: 'Não foi possível salvar a estrutura.' }
  }
  await registrarLog({ entidade: 'sf_estrutura', acao: 'alterar_campo', descricao: `Estrutura ${alvo} salva (rascunho)`, dados: { trechos } })
  revalidatePath('/shopfloor/estruturas')
  return { ok: true }
}

export async function ativarEstruturaAction(pmo: string): Promise<Resultado> {
  const s = await sessaoAdmin()
  if (!s) return { ok: false, erro: SEM_PERMISSAO }
  const e = await estruturaDaPmo(pmo)
  if (!e) return { ok: false, erro: 'Estrutura não encontrada.' }
  const v = validarParaAtivar(e.trechos, await rotaDeReferencia(pmo), await ehAlmox())
  if (!v.ok) return { ok: false, erro: v.erros.join(' ') }
  try {
    await marcarAtiva(pmo, s.nome || s.email)
  } catch {
    return { ok: false, erro: 'Não foi possível ativar a estrutura.' }
  }
  await registrarLog({ entidade: 'sf_estrutura', acao: 'mudar_status', descricao: `Estrutura ${pmo} ativada`, dados: { pmo } })
  revalidatePath('/shopfloor/estruturas')
  return { ok: true }
}

/** "Ler do Compels": os trechos sugeridos a partir de UMA OP da PMO (não grava nada). */
export async function lerDoCompelsAction(pmo: string, op: string): Promise<Resultado<{ trechos: TrechoReceita[] }>> {
  if (!(await sessaoAdmin())) return { ok: false, erro: SEM_PERMISSAO }
  try {
    const nos = await descendentes(op)
    return { ok: true, trechos: trechosDaArvore(numeroDaOp(op), nos, await rotaDeReferencia(pmo.trim())) }
  } catch {
    return { ok: false, erro: 'Não foi possível consultar o Compels agora.' }
  }
}

/** Importa em lote (D9): rascunho para cada PMO do ShopFloor sem estrutura e com filhas no Compels. */
export async function importarDoCompelsAction(): Promise<Resultado<{ criadas: number; semFilhas: number; falhas: number }>> {
  const s = await sessaoAdmin()
  if (!s) return { ok: false, erro: SEM_PERMISSAO }
  const existentes = new Set((await listarEstruturas()).map((e) => e.pmo))
  let criadas = 0, semFilhas = 0, falhas = 0
  for (const { pmo, op } of await ultimaOpNumericaPorPmo()) {
    if (existentes.has(pmo)) continue
    try {
      const trechos = trechosDaArvore(numeroDaOp(op), await descendentes(op), await rotaDeReferencia(pmo))
      if (trechos.length === 0) { semFilhas++; continue }
      await salvarEstrutura(pmo, trechos, s.nome || s.email, `compels:${numeroDaOp(op)}`)
      criadas++
    } catch {
      falhas++
    }
  }
  await registrarLog({ entidade: 'sf_estrutura', acao: 'importar', descricao: `Estruturas importadas do Compels: ${criadas}`, dados: { criadas, semFilhas, falhas } })
  revalidatePath('/shopfloor/estruturas')
  return { ok: true, criadas, semFilhas, falhas }
}

/**
 * Aplica a receita ATIVA da PMO na OP (cópia + OP filha casada). Nunca derruba a criação da OP: devolve um aviso
 * em texto (ou null). Chamado por criarOrdemAction/editarOrdemAction depois de gravar a OP.
 */
export async function aplicarEstruturaNaOp(ordemId: string, pmo: string, op: string, rota: string[]): Promise<string | null> {
  let copiados: { seq: number; codigo: string }[]
  try {
    copiados = await copiarParaOp(ordemId, pmo, rota)
  } catch {
    return 'Não foi possível aplicar a estrutura da PMO nesta OP.'
  }
  if (copiados.length === 0) return null
  let nos: NoArvore[]
  try {
    nos = await descendentes(op)
  } catch {
    return 'Não foi possível consultar o Compels agora: as OPs filhas serão procuradas quando a OP for salva de novo.'
  }
  const filhas = casarTrechos(copiados, nos)
  try {
    await gravarFilhas(ordemId, filhas)
  } catch {
    return 'Não foi possível gravar as OPs filhas do Compels nesta OP.'
  }
  const faltando = copiados.filter((t) => filhas.get(t.seq) === null).map((t) => t.codigo)
  return faltando.length
    ? `${faltando.join(', ')} não foi encontrada no Compels abaixo da OP ${numeroDaOp(op)}: esse trecho não será apontado até a OP ser salva de novo.`
    : null
}
```

  O `registrarLog` aceita `acao` só dos valores do check da tabela `logs`: `criar`, `importar`, `alterar_campo`, `mudar_status`, `gerar_etiqueta`, `excluir` e `login`. Os usados aqui estão nessa lista.

- [ ] **Step 5: Ligar na criação e na edição da OP.**
  - Em `src/modules/shopfloor/application/ordens-actions.ts`, importe `aplicarEstruturaNaOp` de `./estrutura-actions`.
  - Em `criarOrdemAction`, logo depois do `registrarLog` de criação:

```ts
  const avisoEstrutura = await aplicarEstruturaNaOp(id, dados.pmo, dados.op, postos)
  revalidatePath('/shopfloor/ordens')
  return { ok: true, id, pmo: dados.pmo, op: dados.op, ...(avisoEstrutura ? { aviso: avisoEstrutura } : {}) }
```

  O código acima substitui as duas linhas finais atuais (`revalidatePath` e `return`).
  - Em `editarOrdemAction`, depois de gravar com sucesso (antes do `revalidatePath` final), chame `const avisoEstrutura = await aplicarEstruturaNaOp(id, dados.pmo, dados.op, postos)` com a rota gravada naquela função e devolva `aviso` do mesmo jeito.
  - Acrescente `aviso?: string` no tipo `ResultadoOrdem` (caso `ok: true`).
  - No `ordem-form.tsx`, onde o resultado de sucesso mostra o toast, mostre também `toast.warning(r.aviso)` quando existir.

- [ ] **Step 6: Rodar e ver passar.**
  Run: `npx vitest run src/modules/shopfloor/application/__tests__/estrutura-actions.test.ts src/modules/shopfloor && npx tsc --noEmit -p .`
  Expected: PASS e tsc limpo.

- [ ] **Step 7: Commit.**

```bash
git add src/modules/shopfloor/infra/estrutura-repository.ts src/modules/shopfloor/application/estrutura-actions.ts src/modules/shopfloor/application/__tests__/estrutura-actions.test.ts src/modules/shopfloor/application/ordens-actions.ts "src/app/(app)/shopfloor/ordens/ordem-form.tsx"
git commit -m "feat(estrutura): salvar/ativar/importar receitas e aplicar na OP com as filhas do Compels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Fila — liberação das linhas de PRT

**Files:**
- Modify: `src/modules/shopfloor/application/enviar-estoque.ts` (campo `ordemId` em `EnvioEstoqueReservado`)
- Modify: `src/modules/shopfloor/infra/estoque-envios-repository.ts` (`comEstoque` lê também `ordem_id`; nova `criarOrdemDaLinha`)
- Modify: `src/modules/shopfloor/infra/compels.ts` (regra das PRTs)
- Test: `src/modules/shopfloor/infra/__tests__/compels.test.ts` (casos novos; se o arquivo de teste do adaptador tiver outro nome, use o existente: `grep -rl criarPortaCompels src/modules/shopfloor/infra/__tests__`)

**Interfaces:**
- Produces:
  - `EnvioEstoqueReservado.ordemId?: string | null`
  - `criarOrdemDaLinha(): (ordemId: string) => Promise<{ op: string; integrar: boolean } | null>`
  - `DependenciasPortaCompels.ordemDaLinha?`

- [ ] **Step 1: Teste que falha.** Acrescente ao teste do adaptador. Use o `erp` falso já usado ali: o caso "liberada" só precisa chegar ao `enviarEntrada` e não esperar a liberação.

```ts
describe('linhas de PRT (estrutura da OP)', () => {
  const linhaPrt = { ...ENVIO_BASE, pmo: 'PRT420', op: '8499', ordemId: 'ord-1' }

  it('chave COMPELS_PRT_LIGADO ausente → espera, com motivo próprio', async () => {
    const porta = criarPortaCompels({ env: { COMPELS_OPS_LIBERADAS: '*' }, ordemDaLinha: async () => ({ op: '8498', integrar: true }) })
    expect(await porta(linhaPrt)).toEqual({
      ok: false, aguardar: true, esperado: true,
      erro: 'Apontamento das PRTs ainda desligado: a linha fica esperando até a chave COMPELS_PRT_LIGADO ser ligada.',
    })
  })

  it('chave ligada, OP-pai não liberada → espera com o número da OP do ShopFloor', async () => {
    const porta = criarPortaCompels({ env: { COMPELS_PRT_LIGADO: '1' }, ordemDaLinha: async () => ({ op: '8498', integrar: false }) })
    const r = await porta(linhaPrt)
    expect(r).toMatchObject({ ok: false, aguardar: true, esperado: true })
    expect((r as { erro: string }).erro).toBe('OP 8498 ainda não está liberada para a integração com o Compels (PRT420 da OP 8499). Faça a entrada à mão no ERP, ou libere a OP.')
  })

  it('OP filha não encontrada (op vazia) → espera com orientação', async () => {
    const porta = criarPortaCompels({ env: { COMPELS_PRT_LIGADO: '1', COMPELS_OPS_LIBERADAS: '*' }, ordemDaLinha: async () => ({ op: '8498', integrar: true }) })
    expect(await porta({ ...linhaPrt, op: '' })).toEqual({
      ok: false, aguardar: true, esperado: true,
      erro: 'PRT420 não tem OP filha no Compels: confira a estrutura e salve a OP 8498 de novo para procurar.',
    })
  })
})
```

  `ENVIO_BASE` é a linha de exemplo que o teste do adaptador já usa. Se tiver outro nome no arquivo, use o existente.

- [ ] **Step 2: Rodar e ver falhar.**
  Run: `npx vitest run src/modules/shopfloor/infra/__tests__`
  Expected: FAIL (`ordemDaLinha` não existe; a linha de PRT cai na regra antiga).

- [ ] **Step 3: Implementar.**
  1. Em `enviar-estoque.ts`, dentro de `EnvioEstoqueReservado`, depois de `estoque?`:

```ts
  /** Linha de PRT da estrutura da OP (0184): a OP do ShopFloor de onde a peça veio. Ausente/null = linha da PMO (Almoxarifado). */
  ordemId?: string | null
```

  2. Em `estoque-envios-repository.ts`, `comEstoque`:
     - troque o `select('id, estoque')` por uma leitura que tenta `select('id, estoque, ordem_id')` e, se o erro for de coluna inexistente (`42703`, ou mensagem com `ordem_id` e `does not exist`), repete com `select('id, estoque')`;
     - guarde `ordem_id` num `Map` igual ao de `estoque`;
     - no `return` final, acrescente `ordemId: ordemPorId.get(e.id) ?? null`;
     - no ramo `semColuna` existente (sem `estoque`), também devolva `ordemId: null`.

     No fim do arquivo:

```ts
/** A OP do ShopFloor de uma linha de PRT (0184): o número dela e se a integração automática está ligada. */
export function criarOrdemDaLinha(sb?: SupabaseClient): (ordemId: string) => Promise<{ op: string; integrar: boolean } | null> {
  return async (ordemId) => {
    const cliente = sb ?? createServiceSupabase()
    const { data, error } = await cliente.from('sf_ordens').select('op, integrar_compels').eq('id', ordemId).maybeSingle()
    if (error) throw new Error(`sf_ordens (ordem da linha): ${error.message}`)
    if (!data) return null
    const d = data as { op: string; integrar_compels?: unknown }
    return { op: d.op, integrar: d.integrar_compels === true }
  }
}
```

  3. Em `compels.ts`:
     - importe `criarOrdemDaLinha`;
     - acrescente `ordemDaLinha?: (ordemId: string) => Promise<{ op: string; integrar: boolean } | null>` em `DependenciasPortaCompels`;
     - em `criarPortaCompels`, declare `const ordemDaLinha = deps.ordemDaLinha ?? criarOrdemDaLinha()`;
     - dentro da função devolvida, **logo depois** do `if (envio.operacao === 'estorno') …`, insira:

```ts
    // LINHA DE PRT (estrutura da OP, 0184): liberada pela chave das PRTs E pela OP do ShopFloor de onde veio.
    if (envio.ordemId) {
      if (env.COMPELS_PRT_LIGADO !== '1') {
        return {
          ok: false, aguardar: true, esperado: true,
          erro: 'Apontamento das PRTs ainda desligado: a linha fica esperando até a chave COMPELS_PRT_LIGADO ser ligada.',
        }
      }
      let pai: { op: string; integrar: boolean } | null
      try {
        pai = await ordemDaLinha(envio.ordemId)
      } catch (e) {
        return { ok: false, aguardar: true, erro: `Não foi possível conferir a OP da PRT ${envio.pmo}: ${e instanceof Error ? e.message : String(e)}` }
      }
      if (!pai || !(opLiberada(pai.op, env.COMPELS_OPS_LIBERADAS) || pai.integrar)) {
        return {
          ok: false, aguardar: true, esperado: true,
          erro: `OP ${pai?.op ?? '?'} ainda não está liberada para a integração com o Compels (${envio.pmo} da OP ${envio.op}). Faça a entrada à mão no ERP, ou libere a OP.`,
        }
      }
      if (!envio.op.trim()) {
        return {
          ok: false, aguardar: true, esperado: true,
          erro: `${envio.pmo} não tem OP filha no Compels: confira a estrutura e salve a OP ${pai.op} de novo para procurar.`,
        }
      }
    } else if (!opLiberada(envio.op, env.COMPELS_OPS_LIBERADAS)) {
```

     - O `if (!opLiberada(…))` original passa a ser o `else if` acima. Mantenha o corpo dele (a consulta `opIntegrada`) exatamente como está e feche as chaves normalmente.

- [ ] **Step 4: Rodar e ver passar.**
  Run: `npx vitest run src/modules/shopfloor src/modules/compels && npx tsc --noEmit -p .`
  Expected: PASS (inclui os testes antigos da PMO, sem mudança) e tsc limpo.

- [ ] **Step 5: Commit.**

```bash
git add src/modules/shopfloor/application/enviar-estoque.ts src/modules/shopfloor/infra/estoque-envios-repository.ts src/modules/shopfloor/infra/compels.ts src/modules/shopfloor/infra/__tests__
git commit -m "feat(estrutura): fila do Compels libera as PRTs pela chave COMPELS_PRT_LIGADO e pela OP-pai

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Tela Estruturas

**Files:**
- Create: `src/app/(app)/shopfloor/estruturas/page.tsx`
- Create: `src/app/(app)/shopfloor/estruturas/estruturas-cliente.tsx`
- Modify: `src/shared/ui/app-shell.tsx` (item de menu)
- Test: `src/app/(app)/shopfloor/estruturas/__tests__/estruturas-cliente.test.tsx`

**Interfaces:**
- Consumes:
  - Task 4: `listarEstruturas`, `salvarEstruturaAction`, `ativarEstruturaAction`, `lerDoCompelsAction`, `importarDoCompelsAction`
  - `listarPostos` de `ordem-repository`

- [ ] **Step 1: Ler a doc do App Router** antes de criar a rota: `ls node_modules/next/dist/docs/` e o guia de páginas/server components. Siga o padrão de `src/app/(app)/shopfloor/ordens/page.tsx`.

- [ ] **Step 2: Teste que falha** (`__tests__/estruturas-cliente.test.tsx`).

```tsx
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const acoes = vi.hoisted(() => ({
  salvarEstruturaAction: vi.fn(async () => ({ ok: true })),
  ativarEstruturaAction: vi.fn(async () => ({ ok: false, erro: 'PRT1: escolha o posto que conclui este trecho.' })),
  lerDoCompelsAction: vi.fn(async () => ({ ok: true, trechos: [{ seq: 1, codigo: 'PRT410', descricao: 'SMD', postoConclui: 'Inspeção AOI TOP', snModo: 'mesmo', estoque: 'EINTER' }] })),
  importarDoCompelsAction: vi.fn(async () => ({ ok: true, criadas: 3, semFilhas: 2, falhas: 0 })),
}))
vi.mock('@/modules/shopfloor/application/estrutura-actions', () => acoes)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { EstruturasCliente } from '../estruturas-cliente'

const ESTRUTURAS = [
  { pmo: 'PMOC14', situacao: 'rascunho' as const, origem: 'compels:8498', trechos: [{ seq: 1, codigo: 'PRT1', descricao: '', postoConclui: null, snModo: 'mesmo' as const, estoque: 'EINTER' as const }] },
  { pmo: 'PMOG14', situacao: 'ativa' as const, origem: 'manual', trechos: [] },
]

describe('EstruturasCliente', () => {
  it('lista as PMOs com a situação legível', () => {
    render(<EstruturasCliente estruturas={ESTRUTURAS} postos={['Inspeção AOI TOP', 'Inspeção PTH']} />)
    expect(screen.getByText('PMOC14')).toBeTruthy()
    expect(screen.getByText('Rascunho — conferir postos')).toBeTruthy()
    expect(screen.getByText('Ativa')).toBeTruthy()
  })

  it('ativar mostra o motivo da recusa', async () => {
    render(<EstruturasCliente estruturas={ESTRUTURAS} postos={['Inspeção AOI TOP']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar PMOC14' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ativar' }))
    await waitFor(() => expect(screen.getByText('PRT1: escolha o posto que conclui este trecho.')).toBeTruthy())
  })

  it('importar do Compels mostra o resumo', async () => {
    render(<EstruturasCliente estruturas={ESTRUTURAS} postos={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Importar do Compels' }))
    await waitFor(() => expect(screen.getByText('3 estrutura(s) criada(s) em rascunho · 2 PMO(s) sem PRT no Compels · 0 falha(s)')).toBeTruthy())
  })
})
```

- [ ] **Step 3: Rodar e ver falhar.**
  Run: `npx vitest run "src/app/(app)/shopfloor/estruturas"`
  Expected: FAIL (componente não existe).

- [ ] **Step 4: Implementar a página** (`page.tsx`).

```tsx
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarPostos } from '@/modules/shopfloor/infra/ordem-repository'
import { listarEstruturas } from '@/modules/shopfloor/infra/estrutura-repository'
import { EstruturasCliente } from './estruturas-cliente'

export default async function EstruturasPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return <SemPermissao descricao="Você não tem permissão para gerenciar estruturas." />
  }
  const [estruturas, postos] = await Promise.all([listarEstruturas(), listarPostos()])
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Estruturas</h2>
        <p className="text-sm text-muted-foreground">
          Em que posto termina cada PRT de uma PMO. Com a estrutura ativa, o ShopFloor aponta as PRTs no Compels.
        </p>
      </div>
      <EstruturasCliente estruturas={estruturas} postos={postos.map((p) => p.chave).filter((c) => c !== 'Manutenção')} />
    </div>
  )
}
```

- [ ] **Step 5: Implementar o cliente** (`estruturas-cliente.tsx`). A lista tem um botão "Editar <PMO>" por linha, e o editor abre abaixo. Use os componentes de UI já usados em `ordem-form.tsx` (`Button`, `Input`, `Label`, `Select`).

```tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { TrechoReceita } from '@/modules/shopfloor/domain/estrutura'
import type { EstruturaView } from '@/modules/shopfloor/infra/estrutura-repository'
import {
  ativarEstruturaAction, importarDoCompelsAction, lerDoCompelsAction, salvarEstruturaAction,
} from '@/modules/shopfloor/application/estrutura-actions'

const SITUACAO = { rascunho: 'Rascunho — conferir postos', ativa: 'Ativa' } as const
const trechoVazio = (seq: number): TrechoReceita => ({ seq, codigo: '', descricao: '', postoConclui: null, snModo: 'mesmo', estoque: 'EINTER' })

export function EstruturasCliente({ estruturas, postos }: { estruturas: EstruturaView[]; postos: string[] }) {
  const [editando, setEditando] = useState<EstruturaView | null>(null)
  const [trechos, setTrechos] = useState<TrechoReceita[]>([])
  const [opCompels, setOpCompels] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [resumo, setResumo] = useState<string | null>(null)
  const [pendente, start] = useTransition()

  function abrir(e: EstruturaView) {
    setEditando(e); setTrechos(e.trechos.length ? e.trechos : [trechoVazio(1)]); setErro(null)
  }
  function novo() {
    abrir({ pmo: '', situacao: 'rascunho', origem: 'manual', trechos: [] })
  }
  const mudar = (i: number, parcial: Partial<TrechoReceita>) =>
    setTrechos((ts) => ts.map((t, j) => (j === i ? { ...t, ...parcial } : t)))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={novo}>Nova estrutura</Button>
        <Button
          variant="outline"
          disabled={pendente}
          onClick={() => start(async () => {
            const r = await importarDoCompelsAction()
            if (r.ok) setResumo(`${r.criadas} estrutura(s) criada(s) em rascunho · ${r.semFilhas} PMO(s) sem PRT no Compels · ${r.falhas} falha(s)`)
            else toast.error(r.erro)
          })}
        >
          Importar do Compels
        </Button>
      </div>
      {resumo && <p className="text-sm text-muted-foreground">{resumo}</p>}

      <table className="w-full text-sm">
        <thead><tr className="text-left text-muted-foreground"><th>PMO</th><th>Trechos</th><th>Situação</th><th /></tr></thead>
        <tbody>
          {estruturas.map((e) => (
            <tr key={e.pmo} className="border-t border-border">
              <td className="py-2 font-medium">{e.pmo}</td>
              <td>{e.trechos.map((t) => `${t.codigo} → ${t.postoConclui ?? '?'}`).join(' · ') || '—'}</td>
              <td>{SITUACAO[e.situacao]}</td>
              <td className="text-right">
                <Button size="sm" variant="outline" aria-label={`Editar ${e.pmo}`} onClick={() => abrir(e)}>Editar</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editando && (
        <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">PMO
              <Input value={editando.pmo} onChange={(ev) => setEditando({ ...editando, pmo: ev.target.value.toUpperCase() })} disabled={editando.trechos.length > 0} />
            </label>
            <label className="flex flex-col gap-1 text-sm">Ler do Compels (nº de uma OP da PMO)
              <Input value={opCompels} onChange={(ev) => setOpCompels(ev.target.value)} placeholder="ex.: 8498" />
            </label>
            <Button
              variant="outline"
              disabled={pendente || !opCompels.trim() || !editando.pmo.trim()}
              onClick={() => start(async () => {
                const r = await lerDoCompelsAction(editando.pmo, opCompels)
                if (r.ok) setTrechos(r.trechos.length ? r.trechos : [trechoVazio(1)])
                else toast.error(r.erro)
              })}
            >
              Ler do Compels
            </Button>
          </div>

          {trechos.map((t, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[8rem_1fr_14rem_8rem_auto]">
              <Input aria-label={`Código do trecho ${i + 1}`} value={t.codigo} onChange={(ev) => mudar(i, { codigo: ev.target.value.toUpperCase() })} placeholder="PRT…" />
              <span className="self-center truncate text-xs text-muted-foreground">{t.descricao}</span>
              <select aria-label={`Posto que conclui o trecho ${i + 1}`} className="h-9 rounded-md border border-border bg-background px-2"
                value={t.postoConclui ?? ''} onChange={(ev) => mudar(i, { postoConclui: ev.target.value || null })}>
                <option value="">— escolha o posto —</option>
                {postos.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select aria-label={`Estoque do trecho ${i + 1}`} className="h-9 rounded-md border border-border bg-background px-2"
                value={t.estoque} onChange={(ev) => mudar(i, { estoque: ev.target.value as TrechoReceita['estoque'] })}>
                <option value="EINTER">EINTER</option>
                <option value="PA">PA</option>
              </select>
              <Button variant="ghost" size="sm" onClick={() => setTrechos((ts) => ts.filter((_, j) => j !== i))}>Remover</Button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Trechos na ordem da rota (o primeiro é o mais fundo, ex.: SMD). Número de série: o mesmo da PMO.</p>

          {erro && <p className="text-sm text-red-600">{erro}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setTrechos((ts) => [...ts, trechoVazio(ts.length + 1)])}>Adicionar trecho</Button>
            <Button
              disabled={pendente}
              onClick={() => start(async () => {
                const r = await salvarEstruturaAction(editando.pmo, trechos)
                if (r.ok) { toast.success('Estrutura salva como rascunho.'); setErro(null) } else setErro(r.erro)
              })}
            >
              Salvar
            </Button>
            <Button
              variant="secondary"
              disabled={pendente}
              onClick={() => start(async () => {
                const r = await ativarEstruturaAction(editando.pmo)
                if (r.ok) { toast.success('Estrutura ativa: vale para as próximas OPs desta PMO.'); setErro(null) } else setErro(r.erro)
              })}
            >
              Ativar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
```

  **Ativar vale a última versão salva.** Isso é intencional: a pessoa salva e depois ativa. Deixe claro no rótulo, se o revisor pedir.

- [ ] **Step 6: Item de menu.** Em `src/shared/ui/app-shell.tsx`, no array `SHOPFLOOR`, logo depois da linha `op-ordens`:

```ts
  { chave: 'op-estruturas', rotulo: 'Estruturas', href: '/shopfloor/estruturas', icone: Network, modulo: 'shopfloor', perm: 'administrar' },
```

  Acrescente `Network` ao import de `lucide-react` do arquivo.

- [ ] **Step 7: Rodar e ver passar.**
  Run: `npx vitest run "src/app/(app)/shopfloor/estruturas" && npx tsc --noEmit -p .`
  Expected: PASS e tsc limpo.

- [ ] **Step 8: Commit.**

```bash
git add "src/app/(app)/shopfloor/estruturas" src/shared/ui/app-shell.tsx
git commit -m "feat(estrutura): tela Estruturas (lista, editor, ler/importar do Compels, ativar)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Aviso no formulário da OP + linha no Fluxo

**Files:**
- Modify: `src/app/(app)/shopfloor/ordens/page.tsx` (passar `situacaoEstruturaPorPmo`)
- Modify: `src/app/(app)/shopfloor/ordens/ordens-lista.tsx` e `ordem-form.tsx` (receber e mostrar o aviso)
- Modify: `src/modules/shopfloor/application/estrutura-actions.ts` (`lerTrechosCompelsAction`)
- Modify: `src/modules/shopfloor/infra/estrutura-repository.ts` (`resumoTrechosDaOp`)
- Modify: `src/app/(app)/shopfloor/fluxo/fluxo-node.tsx` (hook `useTrechosCompels` + linha no card)
- Test: `src/app/(app)/shopfloor/ordens/__tests__/estrutura-aviso-form.test.tsx`, `src/app/(app)/shopfloor/fluxo/__tests__/fluxo-node-trecho.test.tsx`

**Interfaces:**
- Produces:
  - `resumoTrechosDaOp(pmo, op): Promise<ResumoTrecho[]>`, com `interface ResumoTrecho { posto: string; codigo: string; compelsOp: string | null; apontadas: number; naFila: number; motivo: string | null }`
  - `lerTrechosCompelsAction(pmo, op): Promise<ResumoTrecho[]>`: sem sessão ou sem permissão `visualizar` devolve `[]`

- [ ] **Step 1: Teste do aviso do formulário que falha** (`estrutura-aviso-form.test.tsx`). Monte o `OrdemForm` como os testes vizinhos da pasta (`faixas-sn-form.test.tsx` mostra as props mínimas) e passe `situacaoEstruturaPorPmo`:

```tsx
// Mesmo arranjo de props/mocks de faixas-sn-form.test.tsx; só os casos novos:
it('PMO com estrutura ativa mostra que as PRTs serão apontadas', () => {
  renderForm({ situacaoEstruturaPorPmo: { PMOC14: 'ativa' }, pmoInicial: 'PMOC14' })
  expect(screen.getByText('Esta PMO tem estrutura ativa: as PRTs serão apontadas no Compels pelo ShopFloor.')).toBeTruthy()
})
it('PMO sem estrutura mostra o aviso com link para Estruturas', () => {
  renderForm({ situacaoEstruturaPorPmo: {}, pmoInicial: 'PMOX' })
  expect(screen.getByText('Esta PMO não tem estrutura — as PRTs não serão apontadas pelo ShopFloor.')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Cadastrar estrutura' }).getAttribute('href')).toBe('/shopfloor/estruturas?pmo=PMOX')
})
it('estrutura em rascunho avisa que ainda não vale', () => {
  renderForm({ situacaoEstruturaPorPmo: { PMOC14: 'rascunho' }, pmoInicial: 'PMOC14' })
  expect(screen.getByText('A estrutura desta PMO está em rascunho: ative-a em Estruturas para valer nesta OP.')).toBeTruthy()
})
```

  `renderForm` é o helper do arquivo vizinho. Se não existir, copie o `render(<OrdemForm …/>)` dele para uma função local, com `pmoInicial` preenchendo o campo PMO por `fireEvent.change`.

- [ ] **Step 2: Rodar e ver falhar.**
  Run: `npx vitest run "src/app/(app)/shopfloor/ordens/__tests__/estrutura-aviso-form.test.tsx"`
  Expected: FAIL.

- [ ] **Step 3: Implementar o aviso.**
  - **Em `page.tsx`:** busque `listarEstruturas()` junto do `Promise.all`, monte `const situacaoEstruturaPorPmo = Object.fromEntries(estruturas.map((e) => [e.pmo, e.situacao]))` e passe a `OrdensLista`, que repassa ao `OrdemForm` (prop nova `situacaoEstruturaPorPmo: Record<string, 'rascunho' | 'ativa'>`).
  - **Em `ordem-form.tsx`:** logo abaixo do campo PMO, renderize:

```tsx
{pmo.trim() !== '' && (() => {
  const s = situacaoEstruturaPorPmo[pmo.trim().replace(/_[A-Za-z]*$/, '')]
  if (s === 'ativa') return <p className="text-xs text-muted-foreground">Esta PMO tem estrutura ativa: as PRTs serão apontadas no Compels pelo ShopFloor.</p>
  if (s === 'rascunho') return <p className="text-xs text-amber-700">A estrutura desta PMO está em rascunho: ative-a em Estruturas para valer nesta OP.</p>
  return (
    <p className="text-xs text-muted-foreground">
      Esta PMO não tem estrutura — as PRTs não serão apontadas pelo ShopFloor.{' '}
      <a className="underline" href={`/shopfloor/estruturas?pmo=${encodeURIComponent(pmo.trim())}`}>Cadastrar estrutura</a>
    </p>
  )
})()}
```

  - **Na página Estruturas:** leia o `searchParams.pmo` (veja a doc do Next sobre `searchParams` assíncrono na versão do projeto) e, se vier, passe `pmoInicial` ao `EstruturasCliente`. Ele chama `novo()` já com a PMO preenchida. Prop opcional: `pmoInicial?: string`.

- [ ] **Step 4: Teste da linha do Fluxo que falha** (`fluxo-node-trecho.test.tsx`). Siga o arranjo de `fluxo-node-estoque.test.tsx` (mock das actions e render do nó). O mock de `estrutura-actions` devolve um resumo:

```tsx
const trechos = vi.hoisted(() => ({ lerTrechosCompelsAction: vi.fn(async () => [
  { posto: 'Inspeção PTH', codigo: 'PRT420', compelsOp: '8499', apontadas: 160, naFila: 26, motivo: 'Aguardando requisição no Compels: PRT410' },
]) }))
vi.mock('@/modules/shopfloor/application/estrutura-actions', () => trechos)

it('o card do posto que conclui um trecho mostra a PRT, a OP filha, apontadas e fila com o motivo', async () => {
  renderNo({ id: 'Inspeção PTH', pmo: 'PMOC14', op: '8498' })
  await waitFor(() => expect(screen.getByText('PRT420 → Compels 8499')).toBeTruthy())
  expect(screen.getByText('apontadas 160 · na fila 26')).toBeTruthy()
  expect(screen.getByLabelText('atenção').closest('[title]')?.getAttribute('title')).toContain('Aguardando requisição no Compels')
})
it('posto que não conclui trecho não mostra nada', async () => {
  renderNo({ id: 'Teste', pmo: 'PMOC14', op: '8498' })
  await new Promise((r) => setTimeout(r, 0))
  expect(screen.queryByText(/→ Compels/)).toBeNull()
})
```

  `renderNo` é o helper do teste vizinho (`fluxo-node-estoque.test.tsx`). Reaproveite-o, passando os dados de um nó de posto comum.

- [ ] **Step 5: Implementar o resumo e a linha.**
  - **Em `estrutura-repository.ts`:**

```ts
export interface ResumoTrecho { posto: string; codigo: string; compelsOp: string | null; apontadas: number; naFila: number; motivo: string | null }

/** Por trecho da OP: quantas peças já foram apontadas no Compels (entradas − estornos enviados) e quantas esperam. */
export async function resumoTrechosDaOp(pmo: string, op: string): Promise<ResumoTrecho[]> {
  const sb = await createServerSupabase()
  const { data: o, error: e1 } = await sb.from('sf_ordens')
    .select('id, sf_ordem_trechos(seq, codigo, posto_conclui, compels_op)').eq('pmo', pmo).eq('op', op).maybeSingle()
  if (e1) throw new Error(`sf_ordens: ${e1.message}`)
  const ordem = o as { id: string; sf_ordem_trechos: { seq: number; codigo: string; posto_conclui: string; compels_op: string | null }[] } | null
  if (!ordem || ordem.sf_ordem_trechos.length === 0) return []
  const { data: linhas, error: e2 } = await sb.from('sf_estoque_envios')
    .select('pmo, operacao, quantidade, ok, cancelado_em, erro, criado_em').eq('ordem_id', ordem.id)
  if (e2) throw new Error(`sf_estoque_envios: ${e2.message}`)
  const ls = (linhas ?? []) as { pmo: string; operacao: string; quantidade: number; ok: boolean; cancelado_em: string | null; erro: string | null; criado_em: string }[]
  return [...ordem.sf_ordem_trechos].sort((a, b) => a.seq - b.seq).map((t) => {
    const dele = ls.filter((l) => l.pmo === t.codigo && !l.cancelado_em)
    const sinal = (l: { operacao: string }) => (l.operacao === 'estorno' ? -1 : 1)
    const pend = dele.filter((l) => !l.ok && l.operacao === 'entrada').sort((a, b) => a.criado_em.localeCompare(b.criado_em))
    return {
      posto: t.posto_conclui,
      codigo: t.codigo,
      compelsOp: t.compels_op,
      apontadas: dele.filter((l) => l.ok).reduce((s, l) => s + sinal(l) * l.quantidade, 0),
      naFila: pend.reduce((s, l) => s + l.quantidade, 0),
      motivo: pend[0]?.erro ?? null,
    }
  })
}
```

  - **Em `estrutura-actions.ts`:**

```ts
export async function lerTrechosCompelsAction(pmo: string, op: string): Promise<ResumoTrecho[]> {
  const s = await getSessao()
  if (!s || !podeNoModulo(s.perfil, 'shopfloor', 'visualizar')) return []
  try { return await resumoTrechosDaOp(String(pmo ?? ''), String(op ?? '')) } catch { return [] }
}
```

  Importe `resumoTrechosDaOp` e `type ResumoTrecho` do repositório.
  - **Em `fluxo-node.tsx`:**
    - Crie um hook com **cache por OP no módulo**, para os N cards de posto não dispararem N consultas: um `Map<string, { ate: number; promessa: Promise<ResumoTrecho[]> }>` com validade de 10 s, e um `useEffect` que relê a cada 10 s (mesmo intervalo do estoque, `INTERVALO_ESTOQUE_MS`).
    - Em `FluxoNodeBase`, para nó de posto comum (`!d.ehSaida && d.pmo && d.op`), use `useTrechosCompels(d.pmo, d.op)`, ache o trecho com `posto === d.id` e, se existir, renderize abaixo do conteúdo do card:

```tsx
{trecho && (
  <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-1 text-xs text-muted-foreground"
       title={trecho.motivo ?? undefined}>
    <span>└ {trecho.compelsOp ? `${trecho.codigo} → Compels ${trecho.compelsOp}` : `${trecho.codigo} → sem OP no Compels`}</span>
    <span className="flex items-center gap-1">
      {`apontadas ${formatarQuantidade(trecho.apontadas)} · na fila ${formatarQuantidade(trecho.naFila)}`}
      {trecho.naFila > 0 && trecho.motivo && <AlertTriangle aria-label="atenção" className="size-3.5 text-amber-600" />}
    </span>
  </div>
)}
```

  Para o teste achar o texto exato `PRT420 → Compels 8499`, deixe o "└ " num `<span>` próprio, antes do texto: `<span aria-hidden>└</span> <span>{…}</span>`. O mesmo vale para `apontadas 160 · na fila 26`, que fica num `<span>` só.

- [ ] **Step 6: Rodar e ver passar.**
  Run: `npx vitest run "src/app/(app)/shopfloor" src/modules/shopfloor && npx tsc --noEmit -p .`
  Expected: PASS e tsc limpo.

- [ ] **Step 7: Commit.**

```bash
git add "src/app/(app)/shopfloor" src/modules/shopfloor
git commit -m "feat(estrutura): aviso de estrutura no formulário da OP e linha da PRT no card do Fluxo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Verificação completa + smoke local

**Files:** nenhum código novo. Se o smoke achar defeito, ele é corrigido na task correspondente, com teste.

- [ ] **Step 1: Suíte inteira, tipos, lint e build.**
  - Run: `npx vitest run && npx tsc --noEmit -p . && npx eslint src --max-warnings=0 && bash supabase/tests/rodar-estrutura-op-test.sh`
  - Expected: tudo verde.
  - Os testes `etiquetar-rolo` às vezes estouram o tempo com a suíte inteira. Se falharem, rode-os sozinhos e registre o resultado.
  - Build (worktree com `node_modules` em hard link, `cp -al`, nunca symlink): `npx next build`. Expected: OK.

- [ ] **Step 2: Smoke local.**
  - **Ambiente:** banco local (`SUPABASE_GO_BINARY=$HOME/.local/share/supabase/supabase-go npx supabase start`, `db push` até a 0184 e os grants para `anon`, `authenticated` e `service_role`), app local e Chrome automatizado (`playwright-core` com `/usr/bin/google-chrome`, numa pasta do scratchpad, fora do projeto).
  - **Cenário:**
    - OP de teste `PMOC14/9498` com a rota da 8498;
    - estrutura `PMOC14`: PRT410 → Inspeção AOI TOP e PRT420 → Inspeção PTH, ativa;
    - Compels simulado (o servidor de mentira do smoke do Almoxarifado), devolvendo a árvore 9498 → 9499 PRT420 → 9500 PRT410.
  - **Conferir no banco a cada passo:**
    1. Criar a OP: `sf_ordem_trechos` com `compels_op` 9500 e 9499.
    2. Bipar 3 peças aprovadas na AOI TOP: 3 linhas `PRT410/9500`.
    3. Reprovar uma na Inspeção PTH: nenhuma linha.
    4. Mandar para a Manutenção e reaprovar: 1 linha `PRT420/9499`, sem duplicar.
    5. Cancelar o último lançamento: a linha pendente aparece cancelada.
    6. Rodar o cron com `COMPELS_PRT_LIGADO` ausente: o motivo é "Apontamento das PRTs ainda desligado".
    7. Ligar a chave: o Compels simulado recebe os apontamentos de 9500 antes de 9499.
    8. Fluxo: os cards AOI TOP e Inspeção PTH mostram a linha `└ PRT… → Compels …` com os números certos.

- [ ] **Step 3: Desligar tudo** (app, banco local, worktree de teste) e registrar o resultado no fim deste plano (seção "Resultado do smoke").

- [ ] **Step 4: Commit do registro.**

```bash
git add docs/superpowers/plans/2026-11-13-estrutura-op-receita.md
git commit -m "docs(plano): resultado do smoke da estrutura da OP

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Deploy (depois da revisão e do merge; faz o usuário)

1. **RDS:** aplicar a 0184 (`psql … -1 -f supabase/migrations/0184_estrutura_op.sql`). A chave das PRTs continua **desligada**, então nada vai ao Compels ainda.
2. **App:** `cd ~/ShopFloor && bash deploy/aws/deploy.sh`.
3. **Estruturas:**
   - Rodar **Importar do Compels**.
   - Conferir os rascunhos da OP piloto e ativar.
   - Criar a OP piloto, que precisa ser nova: a estrutura só vale para OP nova.
4. **Liberar:**
   - Quando a frequência for decidida, acrescentar `COMPELS_PRT_LIGADO=1` no `.env.production` e `pm2 restart shopfloor`.
   - Desligar: apagar a linha e reiniciar.
5. **Rollback:** `docs/operacao/estrutura-op/rollback-0184.sql`, mais o app anterior.

## Resultado do smoke

Rodado em 13/11/2026, na branch `feat/estrutura-op-receita` (`dd644db1`).

**Verificação automática**
- vitest: 3610 de 3611 testes passaram. A única falha foi `modal-abastecimento.test.tsx`, que não é desta branch: estourou o tempo com a suíte inteira e passou sozinho (37/37). Os testes `etiquetar-rolo` passaram com a suíte inteira.
- `tsc --noEmit`: sem erro.
- eslint: 1 erro e cerca de 35 avisos que já existiam na main (o erro é `camera-captura.tsx`). Esta branch acrescenta 2 avisos de variável não usada em `ordens/__tests__/estrutura-aviso-form.test.tsx` (`waitFor` e `_o`).
- Harness SQL (`rodar-estrutura-op-test.sh`): `PROVA ESTRUTURA OK` e `ESTRUTURA OP SQL OK`, com a 0184 rodando duas vezes e o rollback.
- `next build` (worktree com `cp -al`): OK. Sem `.env.local`, a coleta de dados de `/api/alertas/avaliar` falha; isso é do ambiente, não da branch.

**Smoke local**
- **Ambiente:** banco local com a 0182–0184 aplicadas por psql e os grants; `next dev` na porta 3002; Compels simulado na porta 4590 com a família 9498 PMOC14 → 9499 PRT420 → 9500 PRT410; Chrome automatizado. O banco local não tem a OP 8498 nem o posto AOI TOP. Por isso foram criados:
  - o posto `Inspeção AOI TOP`;
  - a OP de referência `PMOC14/9400`, com a rota SPI › AOI TOP › Montagem PTH › Inspeção PTH › Teste › Embalagem › NQA › Almoxarifado;
  - o padrão "Rota 8498" com essa mesma rota.
- **Estrutura, pela tela:**
  - "Ler do Compels" com 9498 trouxe PRT410 e PRT420.
  - Postos escolhidos: AOI TOP e Inspeção PTH. Salvar e Ativar funcionaram.
  - O formulário da OP mostrou "Esta PMO tem estrutura ativa…".
1. ✅ **Criar a OP** `PMOC14/9498` pela tela, com a rota puxada do padrão: `sf_ordem_trechos` ficou com PRT410 → `compels_op` 9500 e PRT420 → 9499, os dois com estoque EINTER.
2. ✅ **3 peças aprovadas na AOI TOP:** 3 linhas `PRT410/9500`, `quantidade` 1, EINTER, com `ordem_id`.
3. ✅ **Reprovar na Inspeção PTH:** nenhuma linha nova.
4. ✅ **Manutenção e reaprovação na PTH:** 1 linha `PRT420/9499`. Um segundo bipe aprovado da mesma peça não duplicou a linha.
5. ✅ **Cancelar o último lançamento** (`sf_cancelar_lancamento`, como Administrador):
   - Cancelar o bipe repetido manteve a linha, porque a outra aprovação ainda vale.
   - Cancelar a reaprovação deixou a linha `PRT420/9499` cancelada.
   - A peça foi reaprovada depois, e isso criou uma linha nova (`…/E2`) para o passo 7.
6. ✅ **Cron sem `COMPELS_PRT_LIGADO`:** as 4 linhas de PRT ficaram esperando com "Apontamento das PRTs ainda desligado…". Ficaram com `erro_esperado` true, sem gastar tentativa, e com o envio adiado.
7. ✅ **Com `COMPELS_PRT_LIGADO=1`:**
   - O cron respondeu `enviados: 4`.
   - O Compels simulado recebeu, nesta ordem: 9500, 9500, 9500 e depois 9499, com quantidade 1 cada e estoque/locação EINTER (300/400).
   - A Observação levou a chave da linha.
   - As linhas ficaram `ok`.
8. ✅ **Fluxo:** com uma 4ª peça aprovada na AOI TOP ainda na fila, os cards mostram:
   - AOI TOP: `└ PRT410 → Compels 9500 · apontadas 3 · na fila 1`
   - Inspeção PTH: `└ PRT420 → Compels 9499 · apontadas 1 · na fila 0`

As 3 falhas do cron são linhas antigas de teste do banco local (`PMOTESTE/9101`, OP que o Compels simulado não conhece). Não têm relação com esta feature.

**Observações, sem defeito:**
- A estrutura montada com "Ler do Compels" no editor fica com `origem = manual`. Só o "Importar do Compels" grava outra origem.
- A chave e a Observação das linhas de PRT começam com `ALMOX/`, como as da PMO.
- Na largura de 1800 px, o texto `PRT… → Compels …` quebra em duas linhas no card.

**Desligado ao final:** app, Compels simulado e `supabase stop` (volume mantido; os dados do smoke continuam no banco local); `.env.local` e worktree de teste removidos.
