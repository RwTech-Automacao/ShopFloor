# Finalização automática de OP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma rotina, dentro do cron de 5 minutos dos alertas, mantém o `status` de `sf_ordens` em sincronia com `pct_conclusao >= 100`, sem desfazer o que uma pessoa encerrou à mão e sem nunca poder derrubar os alertas.

**Architecture:** Uma função SQL `sf_sincronizar_finalizacao()` (migração **0145**) faz tudo num único comando com CTEs modificadoras: calcula a conclusão uma vez (reaproveitando `sf_ops_com_bipes(null, null)` da 0121) e fecha/reabre só o que pode provar que é dela, usando a nova coluna `sf_ordens.finalizada_por` (`'rotina'` | `'manual'` | nulo). O app só ganha duas coisas: a tela de OP passa a gravar `manual` (no **servidor**, em `ordens-actions.ts`) e o endpoint `POST /api/alertas/avaliar` chama a rotina **depois** de `avaliarEEnviar`, dentro de um invólucro que nunca lança e tem teto de tempo.

**Tech Stack:** Next.js 16 (App Router, Server Actions, Route Handler), TypeScript, Supabase/PostgREST (`rpc`), Postgres 15, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-finalizar-op-automatico-design.md`

## Restrições globais

- Tudo em **PT-BR**: identificadores, comentários, mensagens de erro e de log.
- ⚠️ `--maxWorkers=2` é **obrigatório** em todo `vitest` nesta máquina (4 núcleos; sem isso o processo morre com exit 137). Ex.: `npx vitest run --maxWorkers=2 <arquivo>`.
- ⚠️ `next build` **roda** nesta worktree: `NODE_OPTIONS="--max-old-space-size=4096" npx next build`.
- ⚠️ `tem_permissao` sempre com **DOIS** argumentos `(módulo, ação)`; a de 1 argumento checa a permissão GLOBAL e anula o RBAC por módulo. (Esta feature não cria política nova; se criar, use a de dois.)
- ⚠️ Em migração, delimitador de corpo **`$func$`, NUNCA `$$`** — o SQL Editor do Supabase recusa, inclusive dentro de comentário. `grep -c '\$\$' supabase/migrations/0145_sf_finalizacao_automatica.sql` tem de dar **0**.
- Migração **idempotente**: o projeto aplica cada uma **duas vezes** para provar. Última linha: `notify pgrst, 'reload schema';`.
- ⚠️ O harness de teste SQL **existe** (`supabase/tests/`, Postgres descartável em Docker). Molde: `rodar-alertas-test.sh` / `rodar-conserto-test.sh`. Esta feature ganha o seu: `rodar-finalizacao-test.sh`.
- ⚠️ **Não rodar nada contra Dev nem Prod.** Só o Postgres descartável do harness. Aplicar a 0145 no Dev/Prod/RDS é decisão do usuário, depois.
- ⚠️ A **próxima migração livre é a 0145** (a 0141 é do resumo diário e a 0142–0144 são da justificativa de divergência, em branches ainda não mergeadas).
- `git add` com **caminhos explícitos** — nunca `git add -A` nem `git add .`. `.superpowers/` está no `.gitignore` de propósito.
- Toda mensagem de commit termina com: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- ⚠️ `ordens-actions.ts` é `'use server'`: **só pode exportar funções async**. Tipos e constantes novos nascem no DOMÍNIO (`finalizacao.ts`), nunca ali — um tipo exportado de módulo `'use server'` derruba o `next build` sem o `tsc` nem o eslint avisarem.

## Regras de desenho que o plano preserva (leia antes de mexer)

1. **A rotina não pode derrubar os alertas.** Ela roda **depois** de `avaliarEEnviar` ter terminado e enviado. O invólucro `rodarFinalizacaoContida` **nunca lança** (nem erro síncrono, nem rejeição) e tem **teto de tempo** (15 s) para não estourar o `curl -m 60` do cron. A resposta HTTP continua sendo **exatamente** o resumo dos alertas (o campo da finalização não entra no JSON; vai só para o log). Um defeito na rotina pode atrasar o encerramento de uma OP; não pode calar um alerta de taxa de aprovação.
2. **A rotina só reabre o que consegue provar que fechou:** `finalizada_por = 'rotina'`. `'manual'` e nulo (as 7 de 08/10, edições antigas) ficam **intocados para sempre**.
3. **Convergência:** duas rodadas seguidas sem nada mudar no meio deixam o banco **bit a bit igual** (inclusive `updated_at`). O teste SQL cobra isso com um hash do estado, não com "a função não deu erro".
4. `pct_conclusao >= 100` (pode passar de 100). `pct` nulo (qtd nula/0) **nunca** fecha.
5. A OP que `sf_ops_com_bipes` não devolve (zero registros, p.ex. todos cancelados) conta como **sem conclusão**, não como "sem informação": se foi fechada pela rotina, reabre.

## Estrutura de arquivos

| arquivo | responsabilidade |
|---|---|
| `supabase/migrations/0145_sf_finalizacao_automatica.sql` | **criar** — coluna `finalizada_por` + função `sf_sincronizar_finalizacao()` |
| `supabase/tests/finalizacao_esquema.sql` | **criar** — esquema mínimo (roles + `sf_ordens`, `sf_ordem_postos`, `sf_registros`) para o harness |
| `supabase/tests/finalizacao_test.sql` | **criar** — os 8 casos da spec + convergência |
| `supabase/tests/rodar-finalizacao-test.sh` | **criar** — sobe o Postgres, aplica 0121 e 0145 (2x) e roda o teste |
| `src/modules/shopfloor/domain/finalizacao.ts` | **criar** — tipos, `finalizadaPorDoCadastro`, `lerResumoFinalizacao` (puros) |
| `src/modules/shopfloor/domain/__tests__/finalizacao.test.ts` | **criar** |
| `src/modules/shopfloor/infra/ordem-repository.ts` | **modificar** — `DadosOrdem.finalizada_por` |
| `src/modules/shopfloor/application/ordens-actions.ts` | **modificar** — `lerDados` grava `manual` |
| `src/modules/shopfloor/application/__tests__/ordens-actions-finalizacao.test.ts` | **criar** |
| `src/modules/shopfloor/infra/finalizacao-repository.ts` | **criar** — `rpc('sf_sincronizar_finalizacao')` com service role |
| `src/modules/shopfloor/application/rodar-finalizacao.ts` | **criar** — invólucro que nunca lança |
| `src/modules/shopfloor/application/__tests__/rodar-finalizacao.test.ts` | **criar** |
| `src/app/api/alertas/avaliar/route.ts` | **modificar** — chama a rotina depois dos alertas |
| `src/modules/alertas/application/__tests__/rota-avaliar.test.ts` | **modificar** — caso 8 + ordem + mock |

`src/app/(app)/shopfloor/ordens/ordem-form.tsx` **NÃO muda**: o seletor continua enviando `status`; quem decide o `manual` é o servidor (um cliente adulterado não pode forjar `rotina`, e o formulário não precisa saber da coluna).

---

### Task 1: Migração 0145 + teste SQL (o coração da feature)

**Files:**
- Create: `supabase/migrations/0145_sf_finalizacao_automatica.sql`
- Create: `supabase/tests/finalizacao_esquema.sql`
- Create: `supabase/tests/finalizacao_test.sql`
- Create: `supabase/tests/rodar-finalizacao-test.sh`

**Interfaces:**
- Consome: `sf_ordens` (id, pmo, op, qtd, status, updated_at) e `public.sf_ops_com_bipes(timestamptz, timestamptz)` da 0121.
- Produz: `sf_ordens.finalizada_por text null check in ('rotina','manual')`; `public.sf_sincronizar_finalizacao() returns jsonb` = `{"finalizadas": n, "reabertas": m}`, executável **só** por `service_role`.

- [ ] **Step 1: Escreva o esquema mínimo do harness**

Crie `supabase/tests/finalizacao_esquema.sql`:

```sql
-- Esquema mínimo para provar a 0145 sem subir o banco inteiro. Só o que a 0121 e a 0145 leem.
-- Roda ANTES da 0121 (que referencia estas tabelas e dá grant a authenticated/service_role).
create role anon;
create role authenticated;
create role service_role bypassrls;

create table public.sf_ordens (
  id uuid primary key default gen_random_uuid(),
  pmo text not null,
  op text not null,
  qtd int,
  status text not null default '',
  updated_at timestamptz not null default now(),
  unique (pmo, op)
);

create table public.sf_ordem_postos (
  ordem_id uuid not null references public.sf_ordens(id) on delete cascade,
  posto text not null,
  ordem int not null default 0,
  primary key (ordem_id, posto)
);

create table public.sf_registros (
  id uuid primary key default gen_random_uuid(),
  data_hora timestamptz not null default now(),
  pmo text not null,
  op text not null,
  posto text not null,
  status text not null default 'aprovado',
  numero_serie_norm text not null
);

grant select, insert, update, delete on public.sf_ordens, public.sf_ordem_postos, public.sf_registros
  to authenticated, service_role;
```

- [ ] **Step 2: Escreva o teste SQL (vai falhar: a função ainda não existe)**

Crie `supabase/tests/finalizacao_test.sql`:

```sql
-- Prova a 0145. Roda depois da 0121 e da 0145 (esta aplicada duas vezes).
\set ON_ERROR_STOP on

-- ---------- ferramentas ----------
create function pg_temp.confere(cond boolean, msg text) returns void language plpgsql as $func$
begin
  if cond is not true then raise exception 'FALHOU: %', msg; end if;
end $func$;

-- Estado legível: "OP=STATUS/origem" em ordem de OP.
create function pg_temp.estado() returns text language sql as $func$
  select string_agg(op || '=' || status || '/' || coalesce(finalizada_por, '-'), ' ' order by op)
    from public.sf_ordens
$func$;

-- Impressão digital do banco INTEIRO de ordens, inclusive updated_at: prova "não reescreveu nada".
create function pg_temp.digital() returns text language sql as $func$
  select md5(coalesce(string_agg(id::text || '|' || status || '|' || coalesce(finalizada_por, '~')
                                 || '|' || updated_at::text, ';' order by id), ''))
    from public.sf_ordens
$func$;

create function pg_temp.rodar() returns jsonb language sql as $func$
  select public.sf_sincronizar_finalizacao()
$func$;

-- Insere n peças aprovadas no ÚLTIMO posto (EMB) de uma OP.
create function pg_temp.pecas(p_op text, n int, p_status text default 'aprovado') returns void language sql as $func$
  insert into public.sf_registros (pmo, op, posto, status, numero_serie_norm)
  select 'PMO1', p_op, 'EMB', p_status, p_op || '-SN' || g from generate_series(1, n) g
$func$;

-- ---------- cenário ----------
-- Toda OP tem rota MONT(1) -> EMB(2): o último posto é EMB.
insert into public.sf_ordens (pmo, op, qtd, status, finalizada_por) values
  ('PMO1', 'A', 2,    'ATIVA',      null),      -- 100%                         -> fecha (caso 1)
  ('PMO1', 'B', 2,    'ATIVA',      null),      -- 50%                          -> fica
  ('PMO1', 'C', 0,    'ATIVA',      null),      -- qtd 0, com peças             -> nunca fecha (caso 6)
  ('PMO1', 'D', null, 'ATIVA',      null),      -- qtd nulo, com peças          -> nunca fecha (caso 6)
  ('PMO1', 'E', 2,    'FINALIZADA', 'manual'),  -- 50%, fechada por pessoa      -> continua (caso 4)
  ('PMO1', 'F', 2,    'FINALIZADA', null),      -- 50%, sem marcação (as 7)     -> intocada (caso 5)
  ('PMO1', 'G', 2,    'FINALIZADA', null),      -- 100%, sem marcação           -> intocada, continua nula
  ('PMO1', 'H', 3,    'ATIVA',      null),      -- 100%, depois a qtd sobe      -> reabre (caso 3)
  ('PMO1', 'I', 2,    '',           null),      -- status vazio conta como ativa-> fecha
  ('PMO1', 'J', 1,    'ATIVA',      null),      -- só reprovada                 -> 0%, fica
  ('PMO1', 'K', 1,    'ATIVA',      null),      -- fecha, depois perde os bipes -> reabre
  ('PMO1', 'L', 2,    'finalizada', 'manual');  -- grafia minúscula, manual, 100% -> intocada
insert into public.sf_ordem_postos (ordem_id, posto, ordem)
  select id, p.posto, p.ordem from public.sf_ordens, (values ('MONT', 1), ('EMB', 2)) as p(posto, ordem);

select pg_temp.pecas('A', 2);
select pg_temp.pecas('B', 1);
select pg_temp.pecas('C', 2);
select pg_temp.pecas('D', 2);
select pg_temp.pecas('E', 1);
select pg_temp.pecas('F', 1);
select pg_temp.pecas('G', 2);
select pg_temp.pecas('H', 3);
select pg_temp.pecas('I', 2);
select pg_temp.pecas('J', 1, 'reprovado');
select pg_temp.pecas('K', 1);
select pg_temp.pecas('L', 2);

-- ---------- 0. a coluna recusa valor fora da lista ----------
do $func$
begin
  begin
    update public.sf_ordens set finalizada_por = 'robo' where op = 'B';
    raise exception 'FALHOU: aceitou finalizada_por = robo';
  exception when check_violation then null;
  end;
end $func$;

-- ---------- caso 1: 100% e ativa -> fecha, marcada como rotina ----------
create temp table r1 as select pg_temp.rodar() as j;
select pg_temp.confere((select j->>'finalizadas' from r1) = '4',
  'primeira rodada deveria finalizar A, H, I e K (4); resumo=' || (select j::text from r1));
select pg_temp.confere((select j->>'reabertas' from r1) = '0', 'primeira rodada não reabre nada');
select pg_temp.confere(pg_temp.estado() =
  'A=FINALIZADA/rotina B=ATIVA/- C=ATIVA/- D=ATIVA/- E=FINALIZADA/manual F=FINALIZADA/- G=FINALIZADA/- '
  || 'H=FINALIZADA/rotina I=FINALIZADA/rotina J=ATIVA/- K=FINALIZADA/rotina L=finalizada/manual',
  'estado depois da rodada 1: ' || pg_temp.estado());

-- ---------- caso 2: segunda rodada -> NADA muda (convergência, bit a bit) ----------
create temp table d1 as select pg_temp.digital() as d;
create temp table r2 as select pg_temp.rodar() as j;
select pg_temp.confere((select j from r2) = '{"finalizadas": 0, "reabertas": 0}'::jsonb,
  'segunda rodada deveria ser {0,0}; veio ' || (select j::text from r2));
select pg_temp.confere(pg_temp.digital() = (select d from d1),
  'segunda rodada MEXEU no banco (status, origem ou updated_at)');
create temp table r2b as select pg_temp.rodar() as j;
select pg_temp.confere(pg_temp.digital() = (select d from d1), 'terceira rodada mexeu no banco');

-- ---------- caso 7: rebipar peça JÁ contada numa OP fechada -> a OP não pisca ----------
insert into public.sf_registros (pmo, op, posto, status, numero_serie_norm)
  values ('PMO1', 'A', 'EMB', 'aprovado', 'A-SN1'), ('PMO1', 'A', 'EMB', 'retrabalho', 'A-SN2');
select pg_temp.confere((select pct_conclusao from public.sf_ops_com_bipes(null, null) where op = 'A') = 100.0,
  'a conta de A deveria seguir em 100 depois de rebipar peça já contada');
select pg_temp.confere(pg_temp.rodar() = '{"finalizadas": 0, "reabertas": 0}'::jsonb,
  'rebipe de peça já contada fez a rotina agir (piscou)');
select pg_temp.confere(pg_temp.digital() = (select d from d1), 'rebipe mudou o status/updated_at de A');

-- ---------- caso 3: fechada pela rotina cuja qtd sobe -> reabre (e volta a fechar se desfizer) ----------
update public.sf_ordens set qtd = 4 where op = 'H';   -- 3/4 = 75%
create temp table r3 as select pg_temp.rodar() as j;
select pg_temp.confere((select j->>'reabertas' from r3) = '1', 'H deveria reabrir; resumo=' || (select j::text from r3));
select pg_temp.confere((select status || '/' || coalesce(finalizada_por, '-') from public.sf_ordens where op = 'H') = 'ATIVA/-',
  'H reaberta deveria ficar ATIVA sem origem');
update public.sf_ordens set qtd = 3 where op = 'H';   -- volta a 100%
select pg_temp.confere((pg_temp.rodar()->>'finalizadas') = '1', 'H deveria fechar de novo');
select pg_temp.confere((select finalizada_por from public.sf_ordens where op = 'H') = 'rotina', 'H fechada de novo pela rotina');

-- ---------- caso 4: manual abaixo de 100% -> continua fechada, rodada após rodada ----------
select pg_temp.rodar(); select pg_temp.rodar(); select pg_temp.rodar();
select pg_temp.confere((select status || '/' || finalizada_por from public.sf_ordens where op = 'E') = 'FINALIZADA/manual',
  'E (manual, 50%) foi reaberta pela rotina');

-- ---------- caso 5: FINALIZADA sem marcação (as 7 de 08/10) -> a rotina não encosta ----------
select pg_temp.confere((select status || '/' || coalesce(finalizada_por, '-') from public.sf_ordens where op = 'F') = 'FINALIZADA/-',
  'F (sem marcação, 50%) foi tocada');
select pg_temp.confere((select status || '/' || coalesce(finalizada_por, '-') from public.sf_ordens where op = 'G') = 'FINALIZADA/-',
  'G (sem marcação, 100%) foi marcada ou reescrita: a rotina não pode "adotar" a OP');

-- ---------- caso 6: qtd nulo ou zero -> nunca fecha ----------
select pg_temp.confere((select count(*) from public.sf_ordens where op in ('C', 'D') and status <> 'ATIVA') = 0,
  'OP com qtd nulo/zero foi finalizada');

-- ---------- fechada pela rotina que perde TODOS os bipes (sumiu da sf_ops_com_bipes) -> reabre ----------
delete from public.sf_registros where op = 'K';
select pg_temp.confere((pg_temp.rodar()->>'reabertas') = '1', 'K sem nenhum bipe deveria reabrir');
select pg_temp.confere((select status from public.sf_ordens where op = 'K') = 'ATIVA', 'K deveria estar ATIVA');

-- ---------- qtd zerada depois de fechada pela rotina -> pct nulo -> reabre ----------
update public.sf_ordens set qtd = 0 where op = 'A';
select pg_temp.confere((pg_temp.rodar()->>'reabertas') = '1', 'A com qtd 0 deveria reabrir (sem denominador não há conclusão)');
update public.sf_ordens set qtd = 2 where op = 'A';
select pg_temp.rodar();   -- A volta a fechar

-- ---------- convergência final depois de toda a bagunça ----------
create temp table d2 as select pg_temp.digital() as d;
select pg_temp.confere(pg_temp.rodar() = '{"finalizadas": 0, "reabertas": 0}'::jsonb, 'estado final não convergiu');
select pg_temp.confere(pg_temp.digital() = (select d from d2), 'rodada final mexeu no banco');

-- ---------- permissões: só service_role executa ----------
set role authenticated;
do $func$
begin
  begin
    perform public.sf_sincronizar_finalizacao();
    raise exception 'FALHOU: authenticated conseguiu executar a rotina';
  exception when insufficient_privilege then null;
  end;
end $func$;
reset role;
set role anon;
do $func$
begin
  begin
    perform public.sf_sincronizar_finalizacao();
    raise exception 'FALHOU: anon conseguiu executar a rotina';
  exception when insufficient_privilege then null;
  end;
end $func$;
reset role;
set role service_role;
select pg_temp.confere(public.sf_sincronizar_finalizacao() is not null, 'service_role deveria executar');
reset role;

\echo 'finalizacao_test: ok'
```

- [ ] **Step 3: Escreva o runner**

Crie `supabase/tests/rodar-finalizacao-test.sh` (e `chmod +x`):

```bash
#!/usr/bin/env bash
# Teste SQL da 0145 (finalização automática de OP) num Postgres descartável (Docker).
# Uso: supabase/tests/rodar-finalizacao-test.sh
# Aplica a 0121 REAL (a conta de conclusão não é reinventada nem simulada) e a 0145 duas vezes.
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-finalizacao-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

docker cp supabase/tests/finalizacao_esquema.sql "$NOME":/tmp/esquema.sql
docker cp supabase/migrations/0121_sf_ops_com_bipes_pct_conclusao.sql "$NOME":/tmp/0121.sql
docker cp supabase/migrations/0145_sf_finalizacao_automatica.sql "$NOME":/tmp/0145.sql
docker cp supabase/tests/finalizacao_test.sql "$NOME":/tmp/teste.sql

docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/esquema.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0121.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0145.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0145.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql
echo "FINALIZACAO SQL OK"
```

- [ ] **Step 4: Rode e veja falhar**

Run: `chmod +x supabase/tests/rodar-finalizacao-test.sh && supabase/tests/rodar-finalizacao-test.sh`
Expected: FAIL no `docker cp` da 0145 (o arquivo ainda não existe). Isso é o vermelho.

- [ ] **Step 5: Escreva a migração**

Crie `supabase/migrations/0145_sf_finalizacao_automatica.sql`:

```sql
-- =============================================================
-- FINALIZAÇÃO AUTOMÁTICA DE OP
-- Spec: docs/superpowers/specs/2026-10-08-finalizar-op-automatico-design.md
--
-- Nada no ShopFloor marcava uma OP como terminada, e o Dashboard monta uma aba por OP ativa.
-- Esta migração dá ao cron de 5 minutos dos alertas uma rotina que mantém sf_ordens.status em
-- sincronia com a % de conclusão que a 0121 já calcula (sf_ops_com_bipes) — sem tirar do gestor o
-- poder de encerrar na mão.
--
-- QUEM ENCERROU (sf_ordens.finalizada_por):
--   'rotina' = a regra dos 100% fechou  -> a rotina PODE reabrir se a conta cair abaixo de 100
--   'manual' = uma pessoa fechou pela tela de OP -> a rotina NUNCA mexe
--   nulo     = não dá para saber (as 7 OPs fechadas à mão em 08/10/2026, qualquer edição antiga)
--              -> a rotina NUNCA mexe. Regra de ouro: só reabre o que consegue provar que fechou.
-- Não há backfill de propósito: as linhas existentes ficam nulas.
--
-- COMPORTAMENTO:
--   - Fecha: status não finalizado (vazio, ATIVA, qualquer coisa que não seja FINALIZADA) e
--     pct_conclusao >= 100 (pode passar de 100). pct nulo (qtd nulo/0) nunca fecha.
--   - Reabre: finalizada_por = 'rotina', status FINALIZADA e a OP NÃO está mais em 100%. A OP que
--     a sf_ops_com_bipes não devolve (zero registros) conta como sem conclusão e também reabre.
--   - Estável: duas rodadas seguidas sem mudança no meio não escrevem NADA (nem updated_at). Os dois
--     update são disjuntos (um exige não-finalizada, o outro finalizada) e rodam sobre UMA leitura
--     da conta, num único comando.
--   - Rebipar peça já contada não muda a conta (é por número de série distinto): a OP não pisca.
--
-- Só o service_role executa (o cron). security definer + search_path travado para não depender dos
-- grants da tabela. Corpo com $func$ (o SQL Editor não aceita dois cifrões, nem em comentário).
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0145_sf_finalizacao_automatica.sql
--
-- ORDEM DE DEPLOY: aplicar esta migração ANTES de subir o código (a tela de OP passa a gravar a
-- coluna nova; sem ela, salvar uma OP falha).
-- =============================================================

-- ---------- quem finalizou ----------
alter table public.sf_ordens add column if not exists finalizada_por text;

alter table public.sf_ordens drop constraint if exists sf_ordens_finalizada_por_check;
alter table public.sf_ordens
  add constraint sf_ordens_finalizada_por_check
  check (finalizada_por is null or finalizada_por in ('rotina', 'manual'));

-- ---------- a rotina ----------
create or replace function public.sf_sincronizar_finalizacao()
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_finalizadas integer;
  v_reabertas   integer;
begin
  with conclusao as materialized (
    -- Uma leitura só da conta. LEFT JOIN: a OP sem nenhum registro não aparece na sf_ops_com_bipes
    -- e fica com pct nulo (= sem conclusão).
    select o.id, c.pct_conclusao as pct
      from public.sf_ordens o
      left join public.sf_ops_com_bipes(null, null) c on c.pmo = o.pmo and c.op = o.op
  ),
  fechadas as (
    update public.sf_ordens o
       set status = 'FINALIZADA', finalizada_por = 'rotina', updated_at = now()
      from conclusao k
     where k.id = o.id
       and k.pct >= 100
       and upper(btrim(o.status)) <> 'FINALIZADA'
    returning o.id
  ),
  reabertas as (
    update public.sf_ordens o
       set status = 'ATIVA', finalizada_por = null, updated_at = now()
      from conclusao k
     where k.id = o.id
       and o.finalizada_por = 'rotina'
       and upper(btrim(o.status)) = 'FINALIZADA'
       and (k.pct is null or k.pct < 100)
    returning o.id
  )
  select (select count(*) from fechadas), (select count(*) from reabertas)
    into v_finalizadas, v_reabertas;

  return jsonb_build_object('finalizadas', v_finalizadas, 'reabertas', v_reabertas);
end
$func$;

revoke all on function public.sf_sincronizar_finalizacao() from public, anon, authenticated;
grant execute on function public.sf_sincronizar_finalizacao() to service_role;

notify pgrst, 'reload schema';
```

- [ ] **Step 6: Confira o delimitador e rode o harness**

Run: `grep -c '\$\$' supabase/migrations/0145_sf_finalizacao_automatica.sql` → Expected: `0`.
Run: `supabase/tests/rodar-finalizacao-test.sh`
Expected: `finalizacao_test: ok` e `FINALIZACAO SQL OK`.

Se o caso 3 (H) falhar por `reabertas` ser 0: o `update ... set qtd = 4` da própria OP-H muda a conta para 75% — confirme que `sf_ops_com_bipes` leu `qtd` novo (a função é `stable`, lê na hora). Não "conserte" o teste; investigue a migração.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0145_sf_finalizacao_automatica.sql supabase/tests/finalizacao_esquema.sql supabase/tests/finalizacao_test.sql supabase/tests/rodar-finalizacao-test.sh
git commit -m "feat(shopfloor): rotina SQL de finalizacao automatica de OP (0145)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: A tela de OP passa a gravar `manual`

**Files:**
- Create: `src/modules/shopfloor/domain/finalizacao.ts`
- Create: `src/modules/shopfloor/domain/__tests__/finalizacao.test.ts`
- Modify: `src/modules/shopfloor/infra/ordem-repository.ts` (`DadosOrdem`)
- Modify: `src/modules/shopfloor/application/ordens-actions.ts` (`lerDados`)
- Create: `src/modules/shopfloor/application/__tests__/ordens-actions-finalizacao.test.ts`

**Interfaces:**
- Consome: `ehOpFinalizada` de `domain/ops-ativas.ts`.
- Produz: `FinalizadaPor`, `finalizadaPorDoCadastro(status)`, `ResumoFinalizacao`, `lerResumoFinalizacao(bruto)` (este último usado na Task 3); `DadosOrdem.finalizada_por: 'manual' | null`.

Regra: ao salvar pela tela, `FINALIZADA` → `'manual'`; qualquer outro status → `null` (reabrir à mão limpa a marca; a rotina pode voltar a fechar se a OP estiver em 100%).

- [ ] **Step 1: Teste do domínio (falha)**

Crie `src/modules/shopfloor/domain/__tests__/finalizacao.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { finalizadaPorDoCadastro, lerResumoFinalizacao } from '../finalizacao'

describe('finalizadaPorDoCadastro', () => {
  it('FINALIZADA pela tela é "manual"', () => {
    expect(finalizadaPorDoCadastro('FINALIZADA')).toBe('manual')
  })

  it('ignora caixa e espaços, como ehOpFinalizada', () => {
    expect(finalizadaPorDoCadastro('  finalizada ')).toBe('manual')
  })

  it('ATIVA, vazio e lixo limpam a marca', () => {
    expect(finalizadaPorDoCadastro('ATIVA')).toBeNull()
    expect(finalizadaPorDoCadastro('')).toBeNull()
    expect(finalizadaPorDoCadastro('EM ANDAMENTO')).toBeNull()
  })
})

describe('lerResumoFinalizacao', () => {
  it('lê o jsonb da função', () => {
    expect(lerResumoFinalizacao({ finalizadas: 2, reabertas: 1 })).toEqual({ finalizadas: 2, reabertas: 1 })
  })

  it.each([null, undefined, 'x', 7, [], {}, { finalizadas: '2', reabertas: 1 }, { finalizadas: 1, reabertas: -1 }, { finalizadas: 1.5, reabertas: 0 }])(
    'recusa formato inesperado: %j',
    (bruto) => {
      expect(() => lerResumoFinalizacao(bruto)).toThrow(/resposta inesperada/i)
    },
  )
})
```

- [ ] **Step 2: Rode e veja falhar**

Run: `npx vitest run --maxWorkers=2 src/modules/shopfloor/domain/__tests__/finalizacao.test.ts`
Expected: FAIL (módulo `../finalizacao` não existe).

- [ ] **Step 3: Implemente o domínio**

Crie `src/modules/shopfloor/domain/finalizacao.ts`:

```ts
import { ehOpFinalizada } from './ops-ativas'

/**
 * Quem encerrou a OP (coluna `sf_ordens.finalizada_por`, migração 0145).
 * 'rotina' = a regra dos 100% fechou (a rotina pode reabrir); 'manual' = uma pessoa fechou pela
 * tela (a rotina nunca mexe). O banco guarda também NULO = "não dá para saber"; nunca é gravado
 * por código novo, só herdado.
 */
export type FinalizadaPor = 'rotina' | 'manual'

/**
 * O que a tela de Cadastro de OP grava em `finalizada_por` ao salvar.
 * FINALIZADA pela tela é decisão de pessoa -> 'manual'. Qualquer outro status limpa a marca:
 * reabrir à mão não deixa um 'manual' pendurado numa OP ativa.
 */
export function finalizadaPorDoCadastro(status: string): 'manual' | null {
  return ehOpFinalizada(status) ? 'manual' : null
}

/** Contagem devolvida por `sf_sincronizar_finalizacao()`. */
export interface ResumoFinalizacao {
  finalizadas: number
  reabertas: number
}

function inteiroNaoNegativo(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

/** Valida o jsonb da função. Formato inesperado lança (o invólucro da rotina contém o erro). */
export function lerResumoFinalizacao(bruto: unknown): ResumoFinalizacao {
  if (typeof bruto === 'object' && bruto !== null && !Array.isArray(bruto)) {
    const { finalizadas, reabertas } = bruto as Record<string, unknown>
    if (inteiroNaoNegativo(finalizadas) && inteiroNaoNegativo(reabertas)) return { finalizadas, reabertas }
  }
  throw new Error('sf_sincronizar_finalizacao: resposta inesperada do banco')
}
```

- [ ] **Step 4: Rode e veja passar**

Run: `npx vitest run --maxWorkers=2 src/modules/shopfloor/domain/__tests__/finalizacao.test.ts`
Expected: PASS.

- [ ] **Step 5: Teste da ação (falha)**

Crie `src/modules/shopfloor/application/__tests__/ordens-actions-finalizacao.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const m = vi.hoisted(() => ({
  criarOrdem: vi.fn(async () => 'id-novo'),
  atualizarOrdem: vi.fn(async () => undefined),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao: vi.fn(async () => ({ perfil: {} })) }))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: vi.fn(() => true) }))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog: vi.fn(async () => undefined) }))
vi.mock('../../infra/postos-repository', () => ({ mapaPostoPerfil: vi.fn(async () => ({})) }))
vi.mock('../../infra/ordem-repository', () => ({
  criarOrdem: m.criarOrdem,
  atualizarOrdem: m.atualizarOrdem,
  excluirOrdem: vi.fn(),
  contarRegistros: vi.fn(),
  buscarOrdemBase: vi.fn(),
  buscarOpEmUso: vi.fn(async () => null),
  listarPostos: vi.fn(async () => []),
}))

import { criarOrdemAction, editarOrdemAction } from '../ordens-actions'

function formulario(status: string): FormData {
  const fd = new FormData()
  fd.set('id', 'id-1')
  fd.set('pmo', 'PMO1')
  fd.set('op', '100')
  fd.set('cliente', 'Cliente')
  fd.set('qtd', '2')
  fd.set('status', status)
  fd.set('sn_ini', 'SN0001')
  fd.set('sn_fim', 'SN0002')
  return fd
}

beforeEach(() => vi.clearAllMocks())

describe('o cadastro de OP marca quem finalizou', () => {
  it('editar para FINALIZADA grava finalizada_por = manual', async () => {
    const r = await editarOrdemAction(undefined, formulario('FINALIZADA'))
    expect(r.ok).toBe(true)
    expect(m.atualizarOrdem).toHaveBeenCalledTimes(1)
    expect(m.atualizarOrdem.mock.calls[0][1]).toMatchObject({ status: 'FINALIZADA', finalizada_por: 'manual' })
  })

  it('editar para ATIVA limpa a marca (reabrir à mão)', async () => {
    const r = await editarOrdemAction(undefined, formulario('ATIVA'))
    expect(r.ok).toBe(true)
    expect(m.atualizarOrdem.mock.calls[0][1]).toMatchObject({ status: 'ATIVA', finalizada_por: null })
  })

  it('criar já FINALIZADA também é manual', async () => {
    const r = await criarOrdemAction(undefined, formulario('FINALIZADA'))
    expect(r.ok).toBe(true)
    expect(m.criarOrdem.mock.calls[0][0]).toMatchObject({ finalizada_por: 'manual' })
  })

  it('o formulário não consegue forjar "rotina": o campo do cliente é ignorado', async () => {
    const fd = formulario('FINALIZADA')
    fd.set('finalizada_por', 'rotina')
    await editarOrdemAction(undefined, fd)
    expect(m.atualizarOrdem.mock.calls[0][1]).toMatchObject({ finalizada_por: 'manual' })
  })
})
```

- [ ] **Step 6: Rode e veja falhar**

Run: `npx vitest run --maxWorkers=2 src/modules/shopfloor/application/__tests__/ordens-actions-finalizacao.test.ts`
Expected: FAIL (`finalizada_por` ausente nos dados). Se falhar antes, em `validarOrdem` (faixa SN), ajuste só os valores `sn_ini`/`sn_fim` do `formulario` para um par coerente com `qtd` — não mexa na validação.

- [ ] **Step 7: Implemente**

Em `src/modules/shopfloor/infra/ordem-repository.ts`, na interface `DadosOrdem`, acrescente o campo ao final:

```ts
  embalagem_individual: boolean
  /** Quem encerrou (0145). A tela só grava 'manual' ou null; 'rotina' é exclusivo da rotina SQL. */
  finalizada_por: 'manual' | null
}
```

(`criarOrdem` faz `.insert(dados)` e `atualizarOrdem` faz `.update({ ...dados, ... })`: o campo vai junto, sem mais mudanças no repositório.)

Em `src/modules/shopfloor/application/ordens-actions.ts`, importe e use em `lerDados`:

```ts
import { finalizadaPorDoCadastro } from '../domain/finalizacao'
```

```ts
function lerDados(fd: FormData): DadosOrdem {
  const qtdBruto = String(fd.get('qtd') ?? '').trim()
  const status = String(fd.get('status') ?? '').trim() || 'ATIVA'
  return {
    pmo: String(fd.get('pmo') ?? '').trim(),
    op: String(fd.get('op') ?? '').trim(),
    cliente: String(fd.get('cliente') ?? '').trim(),
    qtd: qtdBruto === '' || Number.isNaN(Number(qtdBruto)) ? null : Number(qtdBruto),
    descricao: String(fd.get('descricao') ?? '').trim(),
    acp: String(fd.get('acp') ?? '').trim(),
    status,
    sn_ini: String(fd.get('sn_ini') ?? '').trim(),
    sn_fim: String(fd.get('sn_fim') ?? '').trim(),
    embalagem_individual: fd.get('embalagem_individual') === 'on', // checkbox: 1 produto por caixa
    // Salvar pela tela é decisão de pessoa: FINALIZADA vira 'manual' (a rotina não desfaz); outro
    // status limpa a marca. Nunca lido do formulário, para o cliente não forjar 'rotina'.
    finalizada_por: finalizadaPorDoCadastro(status),
  }
}
```

- [ ] **Step 8: Rode tudo da área**

Run: `npx vitest run --maxWorkers=2 src/modules/shopfloor && npx tsc --noEmit`
Expected: PASS e sem erros de tipo.

- [ ] **Step 9: Commit**

```bash
git add src/modules/shopfloor/domain/finalizacao.ts src/modules/shopfloor/domain/__tests__/finalizacao.test.ts src/modules/shopfloor/infra/ordem-repository.ts src/modules/shopfloor/application/ordens-actions.ts src/modules/shopfloor/application/__tests__/ordens-actions-finalizacao.test.ts
git commit -m "feat(shopfloor): cadastro de OP marca finalizada_por = manual

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: O repositório da rotina e o invólucro que nunca lança

**Files:**
- Create: `src/modules/shopfloor/infra/finalizacao-repository.ts`
- Create: `src/modules/shopfloor/application/rodar-finalizacao.ts`
- Create: `src/modules/shopfloor/application/__tests__/rodar-finalizacao.test.ts`

**Interfaces:**
- Consome: `lerResumoFinalizacao`, `ResumoFinalizacao` (Task 2); `createServiceSupabase`.
- Produz: `sincronizarFinalizacaoDasOps(sb?) : Promise<ResumoFinalizacao>` (infra; lança em erro); `rodarFinalizacaoContida(sincronizar, opcoes?) : Promise<ResultadoFinalizacao>` (**nunca lança**), `LIMITE_FINALIZACAO_MS = 15_000`.

- [ ] **Step 1: Teste do invólucro (falha)**

Crie `src/modules/shopfloor/application/__tests__/rodar-finalizacao.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { rodarFinalizacaoContida, LIMITE_FINALIZACAO_MS } from '../rodar-finalizacao'

afterEach(() => vi.useRealTimers())

describe('rodarFinalizacaoContida', () => {
  it('devolve o resumo quando a rotina funciona', async () => {
    const log = vi.fn()
    const r = await rodarFinalizacaoContida(async () => ({ finalizadas: 2, reabertas: 1 }), { log })
    expect(r).toEqual({ ok: true, finalizadas: 2, reabertas: 1 })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('2 finalizada'))
  })

  it('não loga ruído quando não há o que fazer', async () => {
    const log = vi.fn()
    await rodarFinalizacaoContida(async () => ({ finalizadas: 0, reabertas: 0 }), { log })
    expect(log).not.toHaveBeenCalled()
  })

  it('rejeição vira resultado de erro, nunca exceção', async () => {
    const logErro = vi.fn()
    const r = await rodarFinalizacaoContida(async () => { throw new Error('connection refused') }, { logErro })
    expect(r).toEqual({ ok: false, erro: 'connection refused' })
    expect(logErro).toHaveBeenCalledWith(expect.stringContaining('connection refused'))
  })

  it('erro SÍNCRONO (ex.: env do banco ausente) também é contido', async () => {
    const r = await rodarFinalizacaoContida(() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente') }, { logErro: vi.fn() })
    expect(r.ok).toBe(false)
  })

  it('valor que não é Error também é contido', async () => {
    const r = await rodarFinalizacaoContida(() => Promise.reject('texto solto'), { logErro: vi.fn() })
    expect(r).toEqual({ ok: false, erro: 'texto solto' })
  })

  it('se o próprio log lançar, ainda assim não lança', async () => {
    const r = await rodarFinalizacaoContida(async () => { throw new Error('x') }, {
      logErro: () => { throw new Error('log quebrado') },
    })
    expect(r.ok).toBe(false)
  })

  it('estoura o teto de tempo em vez de pendurar o cron', async () => {
    vi.useFakeTimers()
    const logErro = vi.fn()
    const pendente = rodarFinalizacaoContida(() => new Promise(() => {}), { logErro })
    await vi.advanceTimersByTimeAsync(LIMITE_FINALIZACAO_MS + 1)
    const r = await pendente
    expect(r).toEqual({ ok: false, erro: expect.stringContaining('tempo') })
    expect(logErro).toHaveBeenCalled()
  })

  it('o teto é configurável', async () => {
    vi.useFakeTimers()
    const pendente = rodarFinalizacaoContida(() => new Promise(() => {}), { limiteMs: 50, logErro: vi.fn() })
    await vi.advanceTimersByTimeAsync(51)
    expect((await pendente).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Rode e veja falhar**

Run: `npx vitest run --maxWorkers=2 src/modules/shopfloor/application/__tests__/rodar-finalizacao.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implemente o repositório**

Crie `src/modules/shopfloor/infra/finalizacao-repository.ts`:

```ts
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceSupabase } from '@/shared/lib/supabase/service'
import { lerResumoFinalizacao, type ResumoFinalizacao } from '../domain/finalizacao'

/**
 * Chama a rotina `sf_sincronizar_finalizacao()` (0145) com o client de SERVICE ROLE — a função só
 * é executável por esse papel. Lança em qualquer falha; quem contém o erro é `rodarFinalizacaoContida`.
 */
export async function sincronizarFinalizacaoDasOps(
  sb: SupabaseClient = createServiceSupabase(),
): Promise<ResumoFinalizacao> {
  const { data, error } = await sb.rpc('sf_sincronizar_finalizacao')
  if (error) throw new Error(`sf_sincronizar_finalizacao: ${error.message}`)
  return lerResumoFinalizacao(data)
}
```

- [ ] **Step 4: Implemente o invólucro**

Crie `src/modules/shopfloor/application/rodar-finalizacao.ts`:

```ts
import type { ResumoFinalizacao } from '../domain/finalizacao'

/**
 * Teto de tempo da rotina. O cron chama com `curl -m 60` e os alertas já podem ter gasto até 40 s
 * entregando a fila: a finalização não pode ser o que estoura a chamada.
 */
export const LIMITE_FINALIZACAO_MS = 15_000

export type ResultadoFinalizacao = ({ ok: true } & ResumoFinalizacao) | { ok: false; erro: string }

export interface OpcoesFinalizacao {
  limiteMs?: number
  log?: (mensagem: string) => void
  logErro?: (mensagem: string) => void
}

function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Roda a finalização automática CONTENDO qualquer falha: esta função NUNCA lança.
 *
 * Existe para que um defeito na finalização (banco fora, função ausente, resposta estranha, demora)
 * não consiga calar os alertas, que são críticos. Pode atrasar o encerramento de uma OP; não pode
 * mudar a resposta do cron. Cobre erro síncrono, rejeição, valor que não é Error, teto de tempo e
 * até o `log` que lança.
 */
export async function rodarFinalizacaoContida(
  sincronizar: () => Promise<ResumoFinalizacao>,
  opcoes: OpcoesFinalizacao = {},
): Promise<ResultadoFinalizacao> {
  const limiteMs = opcoes.limiteMs ?? LIMITE_FINALIZACAO_MS
  const log = opcoes.log ?? ((m: string) => console.info(m))
  const logErro = opcoes.logErro ?? ((m: string) => console.error(m))
  const seguro = (f: (m: string) => void, m: string) => {
    try { f(m) } catch { /* o log não pode derrubar o cron */ }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const teto = new Promise<never>((_, rejeitar) => {
      timer = setTimeout(() => rejeitar(new Error(`passou do tempo (${limiteMs} ms)`)), limiteMs)
    })
    // Promise.resolve().then(...) captura inclusive o erro SÍNCRONO de `sincronizar`.
    const resumo = await Promise.race([Promise.resolve().then(sincronizar), teto])
    if (resumo.finalizadas > 0 || resumo.reabertas > 0) {
      seguro(log, `[finalizacao] ${resumo.finalizadas} finalizada(s), ${resumo.reabertas} reaberta(s)`)
    }
    return { ok: true, ...resumo }
  } catch (e) {
    const erro = mensagemDe(e)
    seguro(logErro, `[finalizacao] falhou (os alertas não foram afetados): ${erro}`)
    return { ok: false, erro }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
```

- [ ] **Step 5: Rode e veja passar**

Run: `npx vitest run --maxWorkers=2 src/modules/shopfloor/application/__tests__/rodar-finalizacao.test.ts && npx tsc --noEmit`
Expected: PASS, sem erro de tipo.

- [ ] **Step 6: Commit**

```bash
git add src/modules/shopfloor/infra/finalizacao-repository.ts src/modules/shopfloor/application/rodar-finalizacao.ts src/modules/shopfloor/application/__tests__/rodar-finalizacao.test.ts
git commit -m "feat(shopfloor): repositorio e invólucro contido da finalizacao automatica

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Ligar no cron, depois dos alertas (caso 8)

**Files:**
- Modify: `src/app/api/alertas/avaliar/route.ts`
- Modify: `src/modules/alertas/application/__tests__/rota-avaliar.test.ts`

**Interfaces:**
- Consome: `sincronizarFinalizacaoDasOps`, `rodarFinalizacaoContida`.
- Produz: `POST /api/alertas/avaliar` com a **mesma** resposta de antes; efeito colateral novo: a rotina roda após `avaliarEEnviar` resolver.

- [ ] **Step 1: Teste (falha)**

Em `src/modules/alertas/application/__tests__/rota-avaliar.test.ts`:

1. No `vi.hoisted` existente, acrescente `sincronizarFinalizacaoDasOps` e registre o mock (logo abaixo dos dois `vi.mock` atuais):

```ts
const { criarDependenciasAlertas, avaliarEEnviar, sincronizarFinalizacaoDasOps } = vi.hoisted(() => ({
  criarDependenciasAlertas: vi.fn(() => ({ portas: {}, repo: {} })),
  avaliarEEnviar: vi.fn(async () => ({ avaliadas: 2, enviados: 3, falhas: 0, ocupado: false })),
  sincronizarFinalizacaoDasOps: vi.fn(async () => ({ finalizadas: 0, reabertas: 0 })),
}))
vi.mock('@/modules/alertas/infra/fabrica', () => ({ criarDependenciasAlertas }))
vi.mock('@/modules/alertas/application/enviar-alertas', () => ({ avaliarEEnviar }))
vi.mock('@/modules/shopfloor/infra/finalizacao-repository', () => ({ sincronizarFinalizacaoDasOps }))
```

2. No `beforeEach`, depois do `mockResolvedValue` do `avaliarEEnviar`:

```ts
  sincronizarFinalizacaoDasOps.mockResolvedValue({ finalizadas: 0, reabertas: 0 })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
```

3. Dentro do `describe('POST /api/alertas/avaliar'`, acrescente:

```ts
  describe('finalização automática de OP', () => {
    it('roda DEPOIS de os alertas terminarem', async () => {
      const ordem: string[] = []
      avaliarEEnviar.mockImplementationOnce(async () => {
        ordem.push('alertas:inicio')
        await new Promise((r) => setTimeout(r, 5))
        ordem.push('alertas:fim')
        return { avaliadas: 1, enviados: 1, falhas: 0, ocupado: false }
      })
      sincronizarFinalizacaoDasOps.mockImplementationOnce(async () => {
        ordem.push('finalizacao')
        return { finalizadas: 1, reabertas: 0 }
      })
      const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
      expect(res.status).toBe(200)
      expect(ordem).toEqual(['alertas:inicio', 'alertas:fim', 'finalizacao'])
    })

    it('a resposta continua sendo exatamente a dos alertas, com ou sem OP finalizada', async () => {
      sincronizarFinalizacaoDasOps.mockResolvedValueOnce({ finalizadas: 3, reabertas: 1 })
      const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
      expect(await res.json()).toEqual({ avaliadas: 2, enviados: 3, falhas: 0, ocupado: false })
    })

    it('CASO 8: erro na finalização não impede os alertas de sair nem muda a resposta', async () => {
      sincronizarFinalizacaoDasOps.mockRejectedValueOnce(new Error('função inexistente'))
      const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
      expect(avaliarEEnviar).toHaveBeenCalledTimes(1)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ avaliadas: 2, enviados: 3, falhas: 0, ocupado: false })
    })

    it('CASO 8: erro SÍNCRONO na finalização (ex.: env ausente) também não muda a resposta', async () => {
      sincronizarFinalizacaoDasOps.mockImplementationOnce(() => {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente')
      })
      const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ avaliadas: 2, enviados: 3, falhas: 0, ocupado: false })
    })

    it('se os alertas falham (503), a finalização não roda', async () => {
      avaliarEEnviar.mockRejectedValueOnce(new Error('connection refused'))
      const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
      expect(res.status).toBe(503)
      expect(sincronizarFinalizacaoDasOps).not.toHaveBeenCalled()
    })

    it('sem autorização, nenhuma das duas roda', async () => {
      await POST(pedido())
      expect(sincronizarFinalizacaoDasOps).not.toHaveBeenCalled()
    })
  })
```

- [ ] **Step 2: Rode e veja falhar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas/application/__tests__/rota-avaliar.test.ts`
Expected: os testes novos de "roda DEPOIS" falham (`sincronizarFinalizacaoDasOps` nunca chamado); os antigos passam.

- [ ] **Step 3: Implemente na rota**

Em `src/app/api/alertas/avaliar/route.ts`, acrescente os imports:

```ts
import { sincronizarFinalizacaoDasOps } from '@/modules/shopfloor/infra/finalizacao-repository'
import { rodarFinalizacaoContida } from '@/modules/shopfloor/application/rodar-finalizacao'
```

Atualize o comentário do `POST` (acrescente ao final do bloco existente):

```ts
 *
 * Depois de os alertas saírem, o mesmo cron mantém o status das OPs em sincronia com a % de conclusão
 * (finalização automática, migração 0145). Isso é SECUNDÁRIO: roda contido (nunca lança, tem teto de
 * tempo) e não altera a resposta — um defeito ali atrasa o encerramento de uma OP, nunca cala um alerta.
```

E troque o `try` do corpo por:

```ts
  try {
    const { portas, repo } = criarDependenciasAlertas()
    const resumo = await avaliarEEnviar(portas, repo)
    // Depois do envio, de propósito. Contido: não lança, não muda a resposta.
    await rodarFinalizacaoContida(() => sincronizarFinalizacaoDasOps())
    return Response.json(resumo)
  } catch (e) {
```

(o `catch` fica como está.)

- [ ] **Step 4: Rode e veja passar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas src/modules/shopfloor && npx tsc --noEmit`
Expected: PASS em tudo, sem erro de tipo.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/alertas/avaliar/route.ts src/modules/alertas/application/__tests__/rota-avaliar.test.ts
git commit -m "feat(alertas): cron de avaliar tambem finaliza OPs, depois dos alertas e contido

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Verificação final (nada de novo, tudo medido)

**Files:** nenhum arquivo novo — só provas. Se algo falhar, volte à task dona do arquivo.

- [ ] **Step 1: Suíte inteira**

Run: `npx vitest run --maxWorkers=2`
Expected: tudo verde (nenhum teste antigo quebrou, em especial os dos alertas e de `ops-ativas`).

- [ ] **Step 2: Tipos e lint**

Run: `npx tsc --noEmit && npx eslint src/modules/shopfloor src/modules/alertas src/app/api/alertas`
Expected: sem erros.

- [ ] **Step 3: Build**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx next build`
Expected: build completo. É o que pega export proibido em módulo `'use server'` (`ordens-actions.ts` não pode ter ganho nenhum export não-async: confira `git diff src/modules/shopfloor/application/ordens-actions.ts` — só o import e o corpo de `lerDados`).

- [ ] **Step 4: SQL no harness (a prova de convergência)**

Run: `supabase/tests/rodar-finalizacao-test.sh`
Expected: `finalizacao_test: ok` e `FINALIZACAO SQL OK`. Garanta que o teste cobra, e não só "roda": o bloco do caso 2 compara `digital()` (inclui `updated_at`) antes e depois, duas vezes.

- [ ] **Step 5: Os alertas continuam intactos**

Run: `supabase/tests/rodar-alertas-test.sh`
Expected: `ALERTAS SQL OK` (a 0145 não toca nada deles; isto confirma que a branch não regrediu o harness).

- [ ] **Step 6: Conferências estáticas**

Run:
```bash
grep -c '\$\$' supabase/migrations/0145_sf_finalizacao_automatica.sql        # esperado: 0
tail -n 1 supabase/migrations/0145_sf_finalizacao_automatica.sql             # esperado: notify pgrst, 'reload schema';
grep -n "tem_permissao" supabase/migrations/0145_sf_finalizacao_automatica.sql  # esperado: nada (a função não usa RBAC; é só service_role)
git status --short                                                           # esperado: só o que esta feature criou/alterou; nada de .superpowers/
```

- [ ] **Step 7: Nota de deploy (registrar, não executar)**

Nada é aplicado a Dev, Prod nem RDS por este plano. Ao promover (decisão do usuário): **(1)** aplicar a 0145 duas vezes no alvo para provar a idempotência, **(2)** só então subir o código — a tela de OP grava `finalizada_por` e falha sem a coluna; a rotina, ao contrário, é contida e apenas loga se a função faltar. **(3)** Na primeira rodada em Prod, as OPs a 100% e não finalizadas fecham sozinhas (esperado: nenhuma das seis a 97–99%, nenhuma das 7 de 08/10).
