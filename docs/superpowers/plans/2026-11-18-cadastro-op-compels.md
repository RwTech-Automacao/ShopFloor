# Cadastro de OP integrado ao Compels (PMO + PRTs num processo só) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cadastrar a OP do ShopFloor numa tela só a partir do espelho das OPs ativas do Compels: a OP da PMO e as OPs filhas (PRTs) viram uma OP com a rota dividida em trechos, cada trecho com os seus postos, as suas faixas e (nas PRTs) o modo de série; e o Fluxo ganha um seletor de trecho.

**Architecture:**
- **Banco (0184 reescrita no lugar).** Sai a receita por PMO (`sf_estruturas`, `sf_estrutura_trechos`, `sf_salvar_estrutura`). Fica `sf_ordem_trechos` (agora com `tipo` `prt`/`pmo`: a PMO é o último trecho e **não** é enfileirada pelos triggers das PRTs), a fila das PRTs, a chave e os triggers. Entram `trecho_seq` em `sf_ordem_postos` e `sf_ordem_faixas`, o espelho `sf_compels_ops` (+ `sf_compels_ops_sincronizar`, só `service_role`) e as funções security definer do cadastro e da edição (`sf_cadastrar_op`, `sf_ordem_regravar_postos`, `sf_ordem_regravar_faixas`) e a leitura `sf_ultima_op_da_pmo`.
- **Espelho.** Uma rota de cron (`POST /api/compels/espelho-ops`, segredo `ESTOQUE_CRON_SECRET`, liberada no `middleware.ts`) lê `ordemProducaoSimples/findAllFilter` paginado e grava pela função. A tela só lê o espelho (nunca o Compels).
- **Tela.** `Ordens → Nova OP` vira a página `/shopfloor/ordens/nova` (modo Compels ou manual). A edição continua no diálogo de hoje e passa a preservar os trechos. O Fluxo ganha o seletor "Trecho: Todos / …", que reaproveita o esmaecimento da busca de SN.

**Tech Stack:** Next.js 16 (App Router, server actions — ler `node_modules/next/dist/docs/` antes de mexer em página/rota), Supabase/Postgres (RLS `tem_permissao`, funções security definer), vitest + Testing Library, harness SQL em Docker (`supabase/tests/`), cliente Compels (`src/modules/compels/infra/cliente.ts`).

**Spec:** `docs/superpowers/specs/2026-11-18-cadastro-op-compels-design.md` (substitui D1, D2, D8, D9 e D10 de `2026-11-13-estrutura-op-receita-design.md`).

## Decisão: reescrever a 0184 no lugar (não criar a 0191)

A 0184 **nunca foi aplicada** em produção nem no Dev — só no harness local, que é descartável. Reescrever no lugar:
- produção recebe um arquivo só, sem criar a receita para em seguida apagá-la (uma 0191 em cima faria exatamente isso no RDS);
- o rollback continua sendo um arquivo só (`docs/operacao/estrutura-op/rollback-0184.sql`);
- a aplicação fora de ordem (o RDS está na 0188) acontece de qualquer jeito nas duas opções, e a 0184 só cria objetos novos, acrescenta colunas anuláveis (`sf_ordem_postos.trecho_seq`, `sf_ordem_faixas.trecho_seq`, `sf_estoque_envios.ordem_id`) e triggers em `sf_registros` — nada que a 0185–0188 redefina;
- uma 0191 ainda correria o risco de ficar fora de ordem de novo, porque a 0189 e a 0190 são de branches abertas.

Por segurança, a 0184 nova começa derrubando (`drop ... if exists`) os objetos da receita: se algum banco local tiver a versão antiga, ela some.

## Ambiguidades da spec resolvidas neste plano

1. **Faixa de PRT "mesma série da PMO":** o trecho não guarda faixa (usa as da PMO); a tela esconde o campo. Faixa própria (≥ 1) só com "Série própria". A soma das faixas = quantidade só é exigida no trecho da PMO (regra de hoje); nas PRTs com série própria vale formato + sem sobreposição com nenhuma outra faixa da OP.
2. **`sf_sn_nas_faixas` não muda:** como as faixas próprias entram em `sf_ordem_faixas`, um SN de PRT passa na checagem de faixa em qualquer posto. É aceito nesta fase (o bipe não muda); a Parte B (série própria no bipe) restringe por trecho.
3. **Cliente no modo Compels:** a `negociante.codigo` do Compels vai para `sf_compels_ops.cliente`, mas o campo da tela vem preenchido com o cliente da última OP da PMO no ShopFloor (nomes como "LINCE") e só cai no código do Compels quando não há OP anterior. O campo é editável.
4. **Número da OP no modo Compels:** vem preenchido com o número do Compels e é editável (para OPs com sufixo, ex.: `8682_F`; nunca normalizar o sufixo). O `compels_op` do trecho da PMO continua sendo o número do Compels.
5. **Quais códigos aparecem na busca de PMO:** só os do espelho que começam com `PMO` (as PRTs aparecem como trechos, não como PMO).
6. **Trechos:** todas as OPs que descendem da OP da PMO pela cadeia `mae_numero` (inclusive as já inativas no espelho, que mostram a última situação vista), da mais funda para cima; a PMO por último.
7. **Postos copiados de OP antiga (sem `trecho_seq`):** todos caem no trecho da PMO; a pessoa empurra os primeiros para as PRTs com as setas ← / → (mover entre trechos vizinhos preserva a ordem da rota). Componentes da Integração e tempos de Burn-in também são copiados da última OP (editáveis depois em "Editar OP").
8. **Seletor do Fluxo:** só aparece com 2 ou mais trechos (OP manual tem 1 trecho: sem seletor).
9. **Edição de OP com trechos:** recusa trocar a PMO **e** o número da OP (o `compels_op` veio do espelho); posto novo entra no trecho da PMO; tirar todos os postos de um trecho é recusado; o `posto_conclui` é recalculado. O diálogo mostra e regrava só as faixas da PMO (as das PRTs ficam).
10. **`criarOrdemAction` e o modo "criar" do `OrdemForm` ficam no código** (os testes de faixas/Almoxarifado/placas/finalização exercitam as regras por eles), mas saem da tela: o botão "Nova OP" leva à página nova.
11. **FKs `trecho_seq → sf_ordem_trechos`: não criar.** Uma FK composta de `sf_ordem_postos`/`sf_ordem_faixas` para `sf_ordem_trechos` faz o PostgREST ver essas tabelas como junção sf_ordens↔sf_ordem_trechos e o embed `sf_ordem_trechos(...)` a partir de `sf_ordens` passa a dar PGRST201 (relação ambígua). A integridade fica com as funções security definer, que são o único caminho de escrita.

## Global Constraints

- **Idioma:** textos de tela, mensagens de erro e comentários em **PT-BR**, linguagem simples.
- **Permissão:** cadastro e edição de OP exigem `shopfloor.administrar` na action **e** no banco (função security definer confere `(select tem_permissao('shopfloor', 'administrar'))` e levanta `'sem permissão'`). Leitura do espelho: `shopfloor.administrar`. Leitura dos trechos no Fluxo: `shopfloor.visualizar`.
- **RLS:** sempre na forma InitPlan `(select tem_permissao(...))`. `revoke all ... from public, anon`.
- **Escrita:** só por funções security definer (`set search_path = public`); corpo com `$func$` (o SQL Editor do Supabase não aceita dois cifrões).
- **Compels:** só leitura (`findAllFilter`). Nada é gravado no ERP por esta feature.
- **Idempotência:** a 0184 roda duas vezes seguidas e do zero numa transação (`psql -1 -v ON_ERROR_STOP=1`).
- **Escopo:** nenhuma UI além da spec; uma branch só (`feat/cadastro-op-compels`); só OP nova — OPs em andamento não mudam.
- **Cron:** horário UTC, `*/10 10-21 * * 1-5` (07:00–18:59 BRT, dentro da janela em que o RDS está ligado).
- **Comandos (sempre com `cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine"`):** `npx vitest run --maxWorkers=2 <arquivos>`, `npx tsc --noEmit -p .`, `npx eslint <arquivos>`, `bash supabase/tests/rodar-estrutura-op-test.sh`.
- **Commits:** mensagem em PT-BR no padrão do repo (`feat(ordens): …`, `fix(…)`), terminando com a linha em branco + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Mapa de arquivos

| Arquivo | O que é |
|---|---|
| `supabase/migrations/0184_estrutura_op.sql` | **Reescrito**: trechos com `tipo`, `trecho_seq`, espelho, funções do cadastro/edição; sem receita |
| `supabase/tests/estrutura_op_esquema.sql` | Esquema mínimo do harness (+ sf_ordens completa, postos, faixas c/ trigger 0181, componentes, burnin, OP antiga) |
| `supabase/tests/estrutura_op_prova.sql` | Prova dos triggers (sem os casos da receita) + PMO não enfileira + espelho + OP antiga |
| `supabase/tests/cadastro_op_prova.sql` | **Novo**: prova do cadastro/edição/última OP |
| `supabase/tests/rodar-estrutura-op-test.sh` | Runner (roda as duas provas, rollback, reaplica) |
| `docs/operacao/estrutura-op/rollback-0184.sql` | Rollback atualizado |
| `src/modules/compels/domain/espelho-ops.ts` (+ teste) | Linha da lista do Compels → `OpEspelhoLida`; filtro das OPs ativas |
| `src/modules/compels/infra/cliente.ts` (+ teste) | `listarOpsAtivas()` paginado |
| `src/modules/compels/domain/rotas-espelho-ops.ts` (+ teste) | Rota exata do cron (saída do middleware) |
| `src/modules/compels/application/sincronizar-espelho-ops.ts` (+ teste) | Orquestra listar → gravar |
| `src/modules/shopfloor/infra/espelho-ops-repository.ts` (+ teste) | Gravar (service role) e listar (sessão) o espelho |
| `src/app/api/compels/espelho-ops/route.ts` | Rota do cron |
| `middleware.ts` | Libera a rota do cron |
| `tools/estoque/README.md` | Linha do crontab do espelho |
| `src/modules/shopfloor/domain/cadastro-op.ts` (+ teste) | Regras puras do cadastro (trechos do espelho, postos, validação) |
| `src/modules/shopfloor/domain/estrutura.ts` (+ teste) | **Apagado** (receita) |
| `src/modules/shopfloor/application/aplicar-estrutura.ts` (+ teste) | **Apagado** |
| `src/modules/shopfloor/application/estrutura-actions.ts` (+ teste) | Só `lerTrechosCompelsAction` + `lerTrechosDaOpAction` |
| `src/modules/shopfloor/infra/estrutura-repository.ts` (+ teste) | Só `ordemTemTrechos`, `resumoTrechosDaOp`, `listarTrechosDaOp` |
| `src/app/(app)/shopfloor/estruturas/**` | **Apagado** (tela Estruturas) |
| `src/shared/ui/app-shell.tsx` | Sai o item `op-estruturas` |
| `src/modules/shopfloor/domain/faixas-sn.ts` (+ teste) | `faixasDaPmoDoBanco` |
| `src/modules/shopfloor/infra/ordem-repository.ts` | Edição pelas funções `sf_ordem_regravar_*`; faixas só da PMO |
| `src/modules/shopfloor/application/ordens-actions.ts` (+ testes) | Sem `aplicarEstruturaNaOp`; trava PMO/OP com trechos; erro de trecho vazio |
| `src/app/(app)/shopfloor/ordens/{page,ordens-lista,ordem-form}.tsx` | Sem aviso de receita; "Nova OP" vira link; `FaixasSn` exportado com `idBase` |
| `src/modules/shopfloor/infra/cadastro-op-repository.ts` (+ teste) | RPC `sf_cadastrar_op` e `sf_ultima_op_da_pmo` |
| `src/modules/shopfloor/application/cadastro-op-actions.ts` (+ teste) | `cadastrarOpAction`, `ultimaOpDaPmoAction` |
| `src/app/(app)/shopfloor/ordens/nova/{page,nova-op-cliente}.tsx` (+ teste) | Tela Nova OP |
| `src/modules/shopfloor/domain/trechos-op.ts` (+ teste) | `TrechoDaOp`, rótulo e realce do trecho |
| `src/app/(app)/shopfloor/fluxo/seletor-trecho.tsx` (+ teste) | Seletor "Trecho:" |
| `src/app/(app)/shopfloor/fluxo/{fonte-fluxo,fluxo-form}.tsx`, `src/app/(app)/vitrine/fluxo/fonte-vitrine.ts` | Liga o seletor ao desenho |

---

### Task 1: 0184 reescrita — trechos com tipo, `trecho_seq`, espelho; sai a receita

**Files:**
- Modify: `supabase/migrations/0184_estrutura_op.sql`
- Modify: `supabase/tests/estrutura_op_esquema.sql` (acrescentar no fim)
- Modify: `supabase/tests/estrutura_op_prova.sql`
- Modify: `supabase/tests/rodar-estrutura-op-test.sh`
- Modify: `docs/operacao/estrutura-op/rollback-0184.sql`

**Interfaces:**
- Produces (banco):
  - `sf_ordem_trechos.tipo text not null default 'prt' check (tipo in ('prt','pmo'))`
  - `sf_ordem_postos.trecho_seq int null`, `sf_ordem_faixas.trecho_seq int null` (null = OP antiga / OP inteira)
  - tabela `sf_compels_ops(numero int pk, id_compels int, codigo text, descricao text, situacao text, nivel int, quantidade numeric, quantidade_produzida numeric, mae_numero int, principal_numero int, cliente text, data_documento date, ativa boolean, lido_em timestamptz)`
  - `sf_compels_ops_sincronizar(p_ops jsonb) returns jsonb` → `{"novas": int, "atualizadas": int, "inativadas": int}`; chaves de cada item de `p_ops`: `numero, id_compels, codigo, descricao, situacao, nivel, quantidade, quantidade_produzida, mae_numero, principal_numero, cliente, data_documento` (`'YYYY-MM-DD'` ou null). Lista vazia → `raise exception 'LISTA_VAZIA'`. Grant só para `service_role`.
  - `sf_trecho_enfileirar`, `sf_trecho_desfazer`, `sf_resumo_trechos_op`: só trechos `tipo = 'prt'`.

- [ ] **Step 1: Acrescentar ao harness o resto da OP (fim de `supabase/tests/estrutura_op_esquema.sql`)**

```sql
-- ---------- cadastro de OP (18/11): o resto da OP que a 0184 agora toca ----------
alter table public.sf_ordens
  add column cliente text not null default '', add column qtd int, add column descricao text not null default '',
  add column acp text not null default '', add column status text not null default '',
  add column sn_ini text not null default '', add column sn_fim text not null default '',
  add column embalagem_individual boolean not null default false, add column finalizada_por text,
  add column integrar_compels boolean not null default true, add column created_at timestamptz not null default now();
create table public.sf_ordem_postos (
  ordem_id uuid not null references public.sf_ordens(id) on delete cascade,
  posto text not null references public.sf_postos(chave), ordem int not null default 0,
  primary key (ordem_id, posto));
create table public.sf_ordem_componentes (
  ordem_id uuid not null references public.sf_ordens(id) on delete cascade,
  posto text not null, pmo_componente text not null, primary key (ordem_id, posto, pmo_componente));
create table public.sf_ordem_burnin (
  ordem_id uuid not null references public.sf_ordens(id) on delete cascade,
  posto text not null, tempo_min int not null default 0, primary key (ordem_id, posto));
create table public.sf_ordem_faixas (
  ordem_id uuid not null references public.sf_ordens(id) on delete cascade,
  seq int not null check (seq >= 1), sn_ini text not null, sn_fim text not null, primary key (ordem_id, seq));
-- 0181 (cópia): sn_ini/sn_fim da OP -> faixa seq 1
create or replace function public.sf_ordens_faixa_principal() returns trigger language plpgsql security definer
set search_path = public as $f$
begin
  if btrim(coalesce(new.sn_ini, '')) = '' or btrim(coalesce(new.sn_fim, '')) = '' then
    delete from sf_ordem_faixas where ordem_id = new.id;
  else
    insert into sf_ordem_faixas (ordem_id, seq, sn_ini, sn_fim) values (new.id, 1, new.sn_ini, new.sn_fim)
    on conflict (ordem_id, seq) do update set sn_ini = excluded.sn_ini, sn_fim = excluded.sn_fim;
  end if;
  return null;
end $f$;
create trigger sf_ordens_faixa_principal_ins after insert on public.sf_ordens
  for each row execute function public.sf_ordens_faixa_principal();
create trigger sf_ordens_faixa_principal_upd after update of sn_ini, sn_fim on public.sf_ordens
  for each row when (old.sn_ini is distinct from new.sn_ini or old.sn_fim is distinct from new.sn_fim)
  execute function public.sf_ordens_faixa_principal();
insert into public.sf_postos (chave, ordem) values ('SPI', 0), ('Montagem PTH', 5), ('Embalagem', 6), ('NQA', 7);
-- OP ANTIGA (existe antes da 0184): tem que sair intacta
insert into public.sf_ordens (id, pmo, op, cliente, sn_ini, sn_fim)
  values ('00000000-0000-0000-0000-000000007100', 'PMOANT', '7100', 'C', '100', '199');
insert into public.sf_ordem_postos (ordem_id, posto, ordem) values
  ('00000000-0000-0000-0000-000000007100', 'Teste', 0), ('00000000-0000-0000-0000-000000007100', 'Almoxarifado', 1);
```

- [ ] **Step 2: Escrever os casos novos da prova (fim de `supabase/tests/estrutura_op_prova.sql`, antes do `\echo`)**

E apagar da prova: o bloco que começa em `-- 11) sf_salvar_estrutura` até a linha antes de `-- 13)` (casos 11 e 12: a receita e o SQL do `gravarFilhas`, que somem), e trocar o caso 16 por:

```sql
-- 16) sem permissão: ler o resumo é recusado (stub tem_permissao lê teste.perms)
do $$
begin
  perform set_config('teste.perms', 'nenhuma', false);
  begin
    perform * from sf_resumo_trechos_op('PMOF', '7000');
    raise exception 'caso 16 falhou (resumo sem visualizar passou)';
  exception when raise_exception then
    if sqlerrm <> 'sem permissão' then raise; end if;
  end;
  perform set_config('teste.perms', '', false);
end $$;
```

Casos novos (antes de `\echo 'PROVA ESTRUTURA OK'`):

```sql
-- 18) o trecho da PMO (tipo 'pmo') NÃO enfileira nem aparece no resumo: a PMO segue pelo Almoxarifado de sempre
do $$
declare o uuid := '00000000-0000-0000-0000-000000000d01'; n int;
begin
  insert into sf_ordens (id, pmo, op) values (o, 'PMOD', '8800');
  insert into sf_ordem_trechos (ordem_id, seq, codigo, tipo, posto_conclui, estoque, compels_op) values
    (o, 1, 'PRTD', 'prt', 'Inspeção PTH', 'EINTER', '8801'),
    (o, 2, 'PMOD', 'pmo', 'Almoxarifado', 'PA', '8800');
  insert into sf_registros (created_at, posto, pmo, op, status, numero_serie, numero_serie_norm)
    values (clock_timestamp(), 'Almoxarifado', 'PMOD', '8800', 'Aprovado', 'D1', 'd1');
  select count(*) into n from sf_estoque_envios where ordem_id = o;
  if n <> 0 then raise exception 'caso 18 falhou (PMO enfileirou: %)', n; end if;
  insert into sf_registros (created_at, posto, pmo, op, status, numero_serie, numero_serie_norm)
    values (clock_timestamp(), 'Inspeção PTH', 'PMOD', '8800', 'Aprovado', 'D1', 'd1');
  select count(*) into n from sf_estoque_envios where ordem_id = o and pmo = 'PRTD';
  if n <> 1 then raise exception 'caso 18 falhou (PRT não enfileirou: %)', n; end if;
  select count(*) into n from sf_resumo_trechos_op('PMOD', '8800');
  if n <> 1 then raise exception 'caso 18 falhou (resumo com % trechos)', n; end if;
  delete from sf_registros where pmo = 'PMOD' and posto = 'Almoxarifado';
  select count(*) into n from sf_estoque_envios where ordem_id = o and operacao = 'estorno';
  if n <> 0 then raise exception 'caso 18 falhou (desfazer mexeu na PMO)'; end if;
end $$;

-- 19) espelho do Compels: upsert, a que some vira inativa (não apaga), volta ativa quando reaparece, lista vazia recusa
do $$
declare r jsonb; v record;
begin
  r := sf_compels_ops_sincronizar($j$[
    {"numero":8498,"id_compels":1,"codigo":"PMOC14","descricao":"PLACA X","situacao":"Em Processo","nivel":1,"quantidade":10,"quantidade_produzida":0,"mae_numero":null,"principal_numero":null,"cliente":"C1","data_documento":"2026-11-10"},
    {"numero":8499,"id_compels":2,"codigo":"PRT420","descricao":"PARTES PTH","situacao":"Empenhada","nivel":2,"quantidade":10,"quantidade_produzida":0,"mae_numero":8498,"principal_numero":8498,"cliente":"C1","data_documento":"2026-11-10"},
    {"numero":8500,"id_compels":3,"codigo":"PRT410","descricao":"PARTES SMD","situacao":"Aberta","nivel":3,"quantidade":10,"quantidade_produzida":0,"mae_numero":8499,"principal_numero":8498,"cliente":"C1","data_documento":null}
  ]$j$::jsonb);
  if r <> '{"novas":3,"atualizadas":0,"inativadas":0}'::jsonb then raise exception 'caso 19 falhou (1ª: %)', r; end if;
  r := sf_compels_ops_sincronizar($j$[
    {"numero":8498,"id_compels":1,"codigo":"PMOC14","descricao":"PLACA X","situacao":"Em Processo","nivel":1,"quantidade":10,"quantidade_produzida":4,"mae_numero":null,"principal_numero":null,"cliente":"C1","data_documento":"2026-11-10"},
    {"numero":8499,"id_compels":2,"codigo":"PRT420","descricao":"PARTES PTH","situacao":"Em Processo","nivel":2,"quantidade":10,"quantidade_produzida":0,"mae_numero":8498,"principal_numero":8498,"cliente":"C1","data_documento":"2026-11-10"}
  ]$j$::jsonb);
  if r <> '{"novas":0,"atualizadas":2,"inativadas":1}'::jsonb then raise exception 'caso 19 falhou (2ª: %)', r; end if;
  select * into v from sf_compels_ops where numero = 8500;
  if v.ativa or v.situacao <> 'Aberta' then raise exception 'caso 19 falhou (8500: %)', row_to_json(v); end if;
  select * into v from sf_compels_ops where numero = 8498;
  if not v.ativa or v.quantidade_produzida <> 4 or v.data_documento <> date '2026-11-10' then raise exception 'caso 19 falhou (8498: %)', row_to_json(v); end if;
  r := sf_compels_ops_sincronizar($j$[{"numero":8500,"id_compels":3,"codigo":"PRT410","descricao":"PARTES SMD","situacao":"Em Processo","nivel":3,"quantidade":10,"quantidade_produzida":0,"mae_numero":8499,"principal_numero":8498,"cliente":"C1","data_documento":null}]$j$::jsonb);
  if not (select ativa from sf_compels_ops where numero = 8500) then raise exception 'caso 19 falhou (não reativou)'; end if;
  begin
    perform sf_compels_ops_sincronizar('[]'::jsonb);
    raise exception 'caso 19 falhou (lista vazia passou)';
  exception when raise_exception then
    if sqlerrm <> 'LISTA_VAZIA' then raise; end if;
  end;
end $$;

-- 20) OP antiga (criada antes da 0184) intacta: postos e faixa sem trecho, bipe não enfileira
do $$
declare o uuid := '00000000-0000-0000-0000-000000007100'; n int;
begin
  select count(*) into n from sf_ordem_postos where ordem_id = o and trecho_seq is null;
  if n <> 2 then raise exception 'caso 20 falhou (postos: %)', n; end if;
  select count(*) into n from sf_ordem_faixas where ordem_id = o and trecho_seq is null and seq = 1 and sn_ini = '100';
  if n <> 1 then raise exception 'caso 20 falhou (faixa)'; end if;
  insert into sf_registros (created_at, posto, pmo, op, status, numero_serie, numero_serie_norm)
    values (clock_timestamp(), 'Teste', 'PMOANT', '7100', 'Aprovado', '150', '150');
  select count(*) into n from sf_estoque_envios where serie_norm = '150';
  if n <> 0 then raise exception 'caso 20 falhou (enfileirou)'; end if;
end $$;
```

- [ ] **Step 3: Rodar o harness e ver falhar**

Run: `cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine" && bash supabase/tests/rodar-estrutura-op-test.sh`
Expected: FAIL — a 0184 antiga não tem `tipo` (`column "tipo" ... does not exist` no caso 18) nem `sf_compels_ops_sincronizar`.

- [ ] **Step 4: Reescrever a 0184**

Trocar o cabeçalho (linhas 1–20, até antes de `create table if not exists public.sf_estruturas`) por:

```sql
-- 0184: ESTRUTURA DA OP — a OP do ShopFloor é uma cadeia de OPs do Compels (PRTs + PMO) dividida em TRECHOS.
-- Spec: docs/superpowers/specs/2026-11-18-cadastro-op-compels-design.md (substitui a "receita por PMO" de 13/11,
-- que nunca foi para produção: esta migração foi REESCRITA no lugar antes do primeiro deploy).
--
-- 1. sf_ordem_trechos: um trecho por OP do Compels, na ordem da rota. tipo 'prt' (as filhas) ou 'pmo' (o ÚLTIMO
--    trecho, a própria OP). Só os trechos 'prt' são apontados pelos triggers abaixo; a PMO segue pelo Almoxarifado
--    de sempre (0175). posto_conclui = o último posto do trecho (derivado pelas funções de gravação).
-- 2. sf_ordem_postos.trecho_seq / sf_ordem_faixas.trecho_seq: a qual trecho o posto/a faixa pertence. null = OP
--    antiga (ou OP inteira). Sem FK de propósito: uma FK composta para sf_ordem_trechos faria o PostgREST ver essas
--    tabelas como junção sf_ordens↔sf_ordem_trechos e o embed sf_ordem_trechos(...) ficaria ambíguo (PGRST201).
--    Quem grava é só sf_cadastrar_op / sf_ordem_regravar_postos / sf_ordem_regravar_faixas.
-- 3. sf_estoque_envios.ordem_id: liga a linha da fila à OP do ShopFloor (linhas de PRT: pmo = código da PRT,
--    op = OP filha), para o adaptador do Compels resolver tudo sem mudança.
-- 4. Triggers em sf_registros (cobrem TODOS os caminhos de bipe):
--    - AFTER INSERT: registro não reprovado, com SN, no posto que conclui um trecho PRT → entrada da PRT, UMA vez por
--      peça e trecho (existe entrada viva = não cancelada e com saldo → não duplica). quantidade = pecas (painel).
--    - AFTER DELETE (cancelar lançamento): se não sobrou outro registro aprovado da peça no mesmo posto, desfaz com a
--      regra da sf_estoque_reverter (0132): pendente e INTOCADA → cancela; enviada OU tocada → estorno ligado à
--      entrada (entrada_id) e baixa do saldo. As duas funções travam por peça/trecho.
-- 5. sf_trecho_chave: PRT/<ordem_id>/<codigo>/<posto>/<alvo>/E<n> (S<n> no estorno).
-- 6. sf_resumo_trechos_op: o resumo por trecho PRT que o card do Fluxo mostra, numa consulta só.
-- 7. sf_compels_ops: ESPELHO (só leitura) das OPs ativas do Compels, gravado pelo cron de 10 em 10 minutos
--    (sf_compels_ops_sincronizar, só service_role). A que some da lista vira ativa = false (nunca é apagada).
-- 8. Cadastro e edição (security definer, shopfloor.administrar): sf_cadastrar_op (OP + trechos + postos +
--    faixas + componentes + burn-in numa transação), sf_ordem_regravar_postos e sf_ordem_regravar_faixas (a edição
--    preserva os trechos), sf_ultima_op_da_pmo (leitura: os postos da última OP da PMO, para copiar).
--
-- ORDEM DE DEPLOY: migração ANTES do app (o app novo chama as funções novas). Aplicada fora de ordem no RDS (que
-- está na 0188): só cria objetos novos, colunas anuláveis e triggers em sf_registros.
-- Rollback: docs/operacao/estrutura-op/rollback-0184.sql. Idempotente (psql -1 -v ON_ERROR_STOP=1 -f).

-- a versão de 13/11 (receita por PMO) nunca foi para produção; se algum banco local a tiver, ela sai aqui
drop function if exists public.sf_salvar_estrutura(text, jsonb, text, text);
drop table if exists public.sf_estrutura_trechos;
drop table if exists public.sf_estruturas;
```

Apagar os blocos da receita: o `create table ... sf_estruturas`, o `create table ... sf_estrutura_trechos`, as linhas `alter table public.sf_estruturas enable ...`/`sf_estrutura_trechos enable ...`, as 4 policies `sf_estruturas_*`/`sf_estrutura_trechos_*`, e o bloco inteiro `-- ---------- salvar a receita de uma PMO numa transação só ----------` (função `sf_salvar_estrutura` + revoke/grant). As linhas `revoke all on ...`/`grant select, insert, update, delete on ...` passam a citar só `public.sf_ordem_trechos`:

```sql
revoke all on public.sf_ordem_trechos from public, anon;
grant select, insert, update, delete on public.sf_ordem_trechos to authenticated, service_role;
```

No `create table if not exists public.sf_ordem_trechos`, acrescentar a coluna `tipo` depois de `codigo`:

```sql
  tipo          text not null default 'prt' check (tipo in ('prt', 'pmo')),
```

Nos dois loops dos triggers (`sf_trecho_enfileirar` e `sf_trecho_desfazer`) e no `sf_resumo_trechos_op`, acrescentar o filtro do tipo. Em `sf_trecho_enfileirar`:

```sql
     where o.pmo = new.pmo and o.op = new.op and ot.posto_conclui = new.posto and ot.tipo = 'prt'
```

Em `sf_trecho_desfazer`:

```sql
     where o.pmo = old.pmo and o.op = old.op and ot.posto_conclui = old.posto and ot.tipo = 'prt'
```

Em `sf_resumo_trechos_op`:

```sql
     where o.pmo = p_pmo and o.op = p_op and ot.tipo = 'prt'
```

Antes da última linha (`notify pgrst, 'reload schema';`), acrescentar:

```sql
-- ---------- trecho de cada posto e de cada faixa (null = OP antiga / OP inteira) ----------
alter table public.sf_ordem_postos add column if not exists trecho_seq int;
alter table public.sf_ordem_faixas add column if not exists trecho_seq int;
comment on column public.sf_ordem_postos.trecho_seq is 'Trecho (sf_ordem_trechos.seq) dono do posto. null = OP antiga. 0184.';
comment on column public.sf_ordem_faixas.trecho_seq is 'Trecho (sf_ordem_trechos.seq) dono da faixa. null = da OP inteira (OP antiga). 0184.';

-- ---------- espelho das OPs ativas do Compels (só leitura; quem grava é o cron) ----------
create table if not exists public.sf_compels_ops (
  numero               int primary key,
  id_compels           int not null,
  codigo               text not null,
  descricao            text not null default '',
  situacao             text not null default '',
  nivel                int not null default 1,
  quantidade           numeric not null default 0,
  quantidade_produzida numeric not null default 0,
  mae_numero           int,
  principal_numero     int,
  cliente              text not null default '',
  data_documento       date,
  ativa                boolean not null default true,
  lido_em              timestamptz not null default now()
);
create index if not exists sf_compels_ops_codigo on public.sf_compels_ops (codigo) where ativa;
create index if not exists sf_compels_ops_mae on public.sf_compels_ops (mae_numero);
alter table public.sf_compels_ops enable row level security;
drop policy if exists sf_compels_ops_select on public.sf_compels_ops;
create policy sf_compels_ops_select on public.sf_compels_ops
  for select using ((select tem_permissao('shopfloor', 'administrar')));
revoke all on public.sf_compels_ops from public, anon, authenticated;
grant select on public.sf_compels_ops to authenticated;
grant select, insert, update on public.sf_compels_ops to service_role;

-- O cron manda a lista INTEIRA de OPs ativas: upsert de todas e as que não vieram viram ativa = false.
-- Lista vazia é recusada (um Compels fora do ar nunca pode "inativar tudo").
create or replace function public.sf_compels_ops_sincronizar(p_ops jsonb)
returns jsonb language plpgsql security definer set search_path = public as $func$
declare
  v_novas int;
  v_atualizadas int;
  v_inativadas int;
begin
  if jsonb_typeof(p_ops) is distinct from 'array' or jsonb_array_length(p_ops) = 0 then
    raise exception 'LISTA_VAZIA';
  end if;
  with dados as (
    select distinct on ((x->>'numero')::int)
           (x->>'numero')::int as numero, (x->>'id_compels')::int as id_compels, btrim(x->>'codigo') as codigo,
           coalesce(x->>'descricao', '') as descricao, coalesce(x->>'situacao', '') as situacao,
           coalesce((x->>'nivel')::int, 1) as nivel, coalesce((x->>'quantidade')::numeric, 0) as quantidade,
           coalesce((x->>'quantidade_produzida')::numeric, 0) as quantidade_produzida,
           (x->>'mae_numero')::int as mae_numero, (x->>'principal_numero')::int as principal_numero,
           coalesce(x->>'cliente', '') as cliente, (x->>'data_documento')::date as data_documento
      from jsonb_array_elements(p_ops) x
     order by (x->>'numero')::int
  ), gravadas as (
    insert into sf_compels_ops (numero, id_compels, codigo, descricao, situacao, nivel, quantidade,
                                quantidade_produzida, mae_numero, principal_numero, cliente, data_documento,
                                ativa, lido_em)
    select numero, id_compels, codigo, descricao, situacao, nivel, quantidade, quantidade_produzida,
           mae_numero, principal_numero, cliente, data_documento, true, now()
      from dados
    on conflict (numero) do update
      set id_compels = excluded.id_compels, codigo = excluded.codigo, descricao = excluded.descricao,
          situacao = excluded.situacao, nivel = excluded.nivel, quantidade = excluded.quantidade,
          quantidade_produzida = excluded.quantidade_produzida, mae_numero = excluded.mae_numero,
          principal_numero = excluded.principal_numero, cliente = excluded.cliente,
          data_documento = excluded.data_documento, ativa = true, lido_em = now()
    returning (xmax = 0) as nova
  )
  select count(*) filter (where nova), count(*) filter (where not nova) into v_novas, v_atualizadas from gravadas;
  update sf_compels_ops set ativa = false
   where ativa and numero not in (select (x->>'numero')::int from jsonb_array_elements(p_ops) x);
  get diagnostics v_inativadas = row_count;
  return jsonb_build_object('novas', v_novas, 'atualizadas', v_atualizadas, 'inativadas', v_inativadas);
end
$func$;
revoke all on function public.sf_compels_ops_sincronizar(jsonb) from public, anon, authenticated;
grant execute on function public.sf_compels_ops_sincronizar(jsonb) to service_role;
```

- [ ] **Step 5: Atualizar o rollback e o runner**

Em `docs/operacao/estrutura-op/rollback-0184.sql`, antes de `drop table if exists public.sf_ordem_trechos;`, acrescentar (as funções `sf_cadastrar_op`, `sf_ordem_regravar_*` e `sf_ultima_op_da_pmo` entram aqui já, para o rollback não precisar mudar na Task 2):

```sql
drop function if exists public.sf_cadastrar_op(jsonb);
drop function if exists public.sf_ordem_regravar_postos(uuid, text[]);
drop function if exists public.sf_ordem_regravar_faixas(uuid, jsonb);
drop function if exists public.sf_ultima_op_da_pmo(text);
drop function if exists public.sf_compels_ops_sincronizar(jsonb);
drop table if exists public.sf_compels_ops;
alter table public.sf_ordem_postos drop column if exists trecho_seq;
alter table public.sf_ordem_faixas drop column if exists trecho_seq;
```

e trocar a primeira linha de comentário por `-- Rollback da 0184 (estrutura da OP + espelho do Compels + cadastro). Roda numa transação (psql -1).`.

Em `supabase/tests/rodar-estrutura-op-test.sh`, trocar as duas checagens de "rollback não removeu" por:

```bash
docker exec "$NOME" psql -U postgres -tAq -c "select count(*) from information_schema.tables where table_name in ('sf_estruturas','sf_estrutura_trechos','sf_ordem_trechos','sf_compels_ops')" | grep -qx 0 || { echo "rollback não removeu as tabelas"; exit 1; }
docker exec "$NOME" psql -U postgres -tAq -c "select count(*) from information_schema.columns where column_name = 'trecho_seq'" | grep -qx 0 || { echo "rollback não removeu trecho_seq"; exit 1; }
```

(a de `sf_estoque_envios ... PRT%` fica) e a de funções por:

```bash
docker exec "$NOME" psql -U postgres -tAq -c "select count(*) from pg_proc where proname in ('sf_trecho_chave','sf_resumo_trechos_op','sf_trecho_enfileirar','sf_trecho_desfazer','sf_salvar_estrutura','sf_compels_ops_sincronizar','sf_cadastrar_op','sf_ordem_regravar_postos','sf_ordem_regravar_faixas','sf_ultima_op_da_pmo')" | grep -qx 0 || { echo "rollback não removeu as funções"; exit 1; }
```

- [ ] **Step 6: Rodar o harness e ver passar**

Run: `cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine" && bash supabase/tests/rodar-estrutura-op-test.sh`
Expected: `PROVA ESTRUTURA OK` e `ESTRUTURA OP SQL OK` (0184 aplicada 2×, prova, rollback, 0184 de novo).

- [ ] **Step 7: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine"
git add supabase/migrations/0184_estrutura_op.sql supabase/tests/estrutura_op_esquema.sql supabase/tests/estrutura_op_prova.sql supabase/tests/rodar-estrutura-op-test.sh docs/operacao/estrutura-op/rollback-0184.sql
git commit -m "feat(ordens): 0184 reescrita — PMO como último trecho, trecho por posto/faixa e espelho das OPs do Compels; sai a receita

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: funções do cadastro e da edição (0184, parte 2)

**Files:**
- Modify: `supabase/migrations/0184_estrutura_op.sql` (acrescentar antes do `notify pgrst`)
- Create: `supabase/tests/cadastro_op_prova.sql`
- Modify: `supabase/tests/rodar-estrutura-op-test.sh`

**Interfaces:**
- Consumes: colunas/tabela da Task 1.
- Produces (banco):
  - `sf_cadastrar_op(p jsonb) returns uuid` — `p = {"ordem": {pmo, op, cliente, qtd, descricao, acp, embalagem_individual, placas_por_painel}, "trechos": [{seq, codigo, tipo, compels_op, sn_modo, postos: text[], faixas: [{sn_ini, sn_fim}]}], "componentes": [{posto, pmo}], "burnin": [{posto, tempo_min}]}`. Erros: `'sem permissão'`, `'SEM_TRECHO'`, `'PMO_NAO_E_ULTIMO'`, `'TRECHO_SEM_POSTO:<codigo>'`, `'POSTO_REPETIDO:<posto>'`, `'TRECHO_SEM_FAIXA:<codigo>'`, `unique_violation` (23505) para PMO/OP repetido. Status sempre `'ATIVA'`; `sn_ini/sn_fim` = 1ª faixa da PMO; faixas da PMO primeiro (seq 1..n), depois as próprias das PRTs; faixas de PRT `mesmo` são ignoradas; componentes/burn-in fora da rota são ignorados.
  - `sf_ordem_regravar_postos(p_ordem_id uuid, p_postos text[]) returns void` — mantém o `trecho_seq` de quem fica, posto novo vai para o trecho `pmo` (null em OP sem trechos), recalcula `posto_conclui`, recusa `'TRECHO_SEM_POSTO:<codigo>'`.
  - `sf_ordem_regravar_faixas(p_ordem_id uuid, p_faixas jsonb) returns void` — `p_faixas` = faixas da PMO (`[{sn_ini, sn_fim}]`); as das PRTs ficam, renumeradas depois.
  - `sf_ultima_op_da_pmo(p_pmo text) returns jsonb` — `null` ou `{op, cliente, descricao, placas_por_painel, embalagem_individual, postos: [{posto, trecho_codigo}], componentes: [{posto, pmo}], burnin: [{posto, tempo_min}]}`; procura `pmo = p_pmo` e, sem nenhuma, `pmo` com sufixo `p_pmo || '_…'`.

- [ ] **Step 1: Escrever a prova `supabase/tests/cadastro_op_prova.sql`**

```sql
\set ON_ERROR_STOP on
-- A) cadastro completo: 2 PRTs + PMO, numa transação
do $$
declare v_id uuid; v record; n int;
begin
  v_id := sf_cadastrar_op($j${
    "ordem": {"pmo":"PMOC14","op":"9498","cliente":"LINCE","qtd":10,"descricao":"PLACA X","acp":"","embalagem_individual":false,"placas_por_painel":1},
    "trechos": [
      {"seq":1,"codigo":"PRT410","tipo":"prt","compels_op":"9500","sn_modo":"proprio","postos":["SPI","Inspeção AOI TOP"],"faixas":[{"sn_ini":"A001","sn_fim":"A010"}]},
      {"seq":2,"codigo":"PRT420","tipo":"prt","compels_op":"9499","sn_modo":"mesmo","postos":["Montagem PTH","Inspeção PTH"],"faixas":[{"sn_ini":"X1","sn_fim":"X9"}]},
      {"seq":3,"codigo":"PMOC14","tipo":"pmo","compels_op":"9498","sn_modo":"mesmo","postos":["Teste","Embalagem","Almoxarifado"],"faixas":[{"sn_ini":"100","sn_fim":"104"},{"sn_ini":"200","sn_fim":"204"}]}
    ],
    "componentes": [{"posto":"Teste","pmo":"PMOZ"},{"posto":"Fora","pmo":"PMOW"}],
    "burnin": [{"posto":"Teste","tempo_min":360}]
  }$j$::jsonb);
  select * into v from sf_ordens o where o.id = v_id;
  if v.pmo <> 'PMOC14' or v.op <> '9498' or v.status <> 'ATIVA' or v.sn_ini <> '100' or v.sn_fim <> '104' or v.qtd <> 10 then
    raise exception 'caso A falhou (OP: %)', row_to_json(v);
  end if;
  select string_agg(posto || ':' || ordem || ':' || trecho_seq, ',' order by ordem) into v from sf_ordem_postos where ordem_id = v_id;
  if v.string_agg <> 'SPI:0:1,Inspeção AOI TOP:1:1,Montagem PTH:2:2,Inspeção PTH:3:2,Teste:4:3,Embalagem:5:3,Almoxarifado:6:3' then
    raise exception 'caso A falhou (postos: %)', v.string_agg;
  end if;
  select string_agg(codigo || ':' || tipo || ':' || posto_conclui || ':' || sn_modo || ':' || estoque || ':' || compels_op, ',' order by seq) into v
    from sf_ordem_trechos where ordem_id = v_id;
  if v.string_agg <> 'PRT410:prt:Inspeção AOI TOP:proprio:EINTER:9500,PRT420:prt:Inspeção PTH:mesmo:EINTER:9499,PMOC14:pmo:Almoxarifado:mesmo:PA:9498' then
    raise exception 'caso A falhou (trechos: %)', v.string_agg;
  end if;
  select string_agg(seq || ':' || sn_ini || '-' || sn_fim || ':' || trecho_seq, ',' order by seq) into v from sf_ordem_faixas where ordem_id = v_id;
  if v.string_agg <> '1:100-104:3,2:200-204:3,3:A001-A010:1' then raise exception 'caso A falhou (faixas: %)', v.string_agg; end if;
  select count(*) into n from sf_ordem_componentes where ordem_id = v_id;
  if n <> 1 then raise exception 'caso A falhou (componentes: %)', n; end if;
  select count(*) into n from sf_ordem_burnin where ordem_id = v_id and posto = 'Teste' and tempo_min = 360;
  if n <> 1 then raise exception 'caso A falhou (burnin)'; end if;
  -- bipe: a PRT410 é apontada no último posto dela; a PMO não entra na fila das PRTs
  insert into sf_registros (created_at, posto, pmo, op, status, numero_serie, numero_serie_norm)
    values (clock_timestamp(), 'Inspeção AOI TOP', 'PMOC14', '9498', 'Aprovado', '101', '101'),
           (clock_timestamp(), 'Almoxarifado', 'PMOC14', '9498', 'Aprovado', '101', '101');
  select count(*) into n from sf_estoque_envios where ordem_id = v_id and pmo = 'PRT410' and op = '9500';
  if n <> 1 then raise exception 'caso A falhou (fila PRT410: %)', n; end if;
  select count(*) into n from sf_estoque_envios where ordem_id = v_id and pmo = 'PMOC14';
  if n <> 0 then raise exception 'caso A falhou (PMO na fila das PRTs)'; end if;
end $$;

-- B) recusas: nada fica gravado
do $$
declare n0 int; n int;
  base text := '{"ordem":{"pmo":"PMOB","op":"9600","cliente":"C","qtd":5,"placas_por_painel":1},"trechos":%s}';
begin
  select count(*) into n0 from sf_ordens;
  begin
    perform sf_cadastrar_op(format(base, '[{"seq":1,"codigo":"PRTB","tipo":"prt","postos":["Teste"],"faixas":[]},{"seq":2,"codigo":"PMOB","tipo":"pmo","postos":["Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"5"}]}]')::jsonb);
    raise exception 'caso B falhou (posto repetido passou)';
  exception when raise_exception then
    if sqlerrm <> 'POSTO_REPETIDO:Teste' then raise; end if;
  end;
  begin
    perform sf_cadastrar_op(format(base, '[{"seq":1,"codigo":"PRTB","tipo":"prt","postos":[],"faixas":[]},{"seq":2,"codigo":"PMOB","tipo":"pmo","postos":["Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"5"}]}]')::jsonb);
    raise exception 'caso B falhou (trecho vazio passou)';
  exception when raise_exception then
    if sqlerrm <> 'TRECHO_SEM_POSTO:PRTB' then raise; end if;
  end;
  begin
    perform sf_cadastrar_op(format(base, '[{"seq":1,"codigo":"PMOB","tipo":"pmo","postos":["Teste"],"faixas":[{"sn_ini":"1","sn_fim":"5"}]},{"seq":2,"codigo":"PRTB","tipo":"prt","postos":["Almoxarifado"],"faixas":[]}]')::jsonb);
    raise exception 'caso B falhou (PMO no meio passou)';
  exception when raise_exception then
    if sqlerrm <> 'PMO_NAO_E_ULTIMO' then raise; end if;
  end;
  begin
    perform sf_cadastrar_op(format(base, '[{"seq":1,"codigo":"PRTB","tipo":"prt","sn_modo":"proprio","postos":["Teste"],"faixas":[]},{"seq":2,"codigo":"PMOB","tipo":"pmo","postos":["Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"5"}]}]')::jsonb);
    raise exception 'caso B falhou (própria sem faixa passou)';
  exception when raise_exception then
    if sqlerrm <> 'TRECHO_SEM_FAIXA:PRTB' then raise; end if;
  end;
  begin
    perform sf_cadastrar_op('{"ordem":{"pmo":"PMOC14","op":"9498","cliente":"C"},"trechos":[{"seq":1,"codigo":"PMOC14","tipo":"pmo","postos":["Teste"],"faixas":[{"sn_ini":"1","sn_fim":"5"}]}]}'::jsonb);
    raise exception 'caso B falhou (OP repetida passou)';
  exception when unique_violation then null;
  end;
  select count(*) into n from sf_ordens;
  if n <> n0 then raise exception 'caso B falhou (gravou: % -> %)', n0, n; end if;
end $$;

-- C) sem permissão
do $$
begin
  perform set_config('teste.perms', 'shopfloor.visualizar', false);
  begin
    perform sf_cadastrar_op('{"ordem":{"pmo":"PMONEG","op":"1"},"trechos":[]}'::jsonb);
    raise exception 'caso C falhou (cadastro)';
  exception when raise_exception then if sqlerrm <> 'sem permissão' then raise; end if;
  end;
  begin
    perform sf_ordem_regravar_postos('00000000-0000-0000-0000-000000007100', array['Teste']);
    raise exception 'caso C falhou (postos)';
  exception when raise_exception then if sqlerrm <> 'sem permissão' then raise; end if;
  end;
  begin
    perform sf_ordem_regravar_faixas('00000000-0000-0000-0000-000000007100', '[]'::jsonb);
    raise exception 'caso C falhou (faixas)';
  exception when raise_exception then if sqlerrm <> 'sem permissão' then raise; end if;
  end;
  perform set_config('teste.perms', '', false);
end $$;

-- D) edição: postos preservam o trecho, posto novo vai para a PMO, posto_conclui recalculado, trecho vazio recusado
do $$
declare v_id uuid := (select o.id from sf_ordens o where o.pmo = 'PMOC14' and o.op = '9498'); v text; n int;
begin
  perform sf_ordem_regravar_postos(v_id, array['SPI','Inspeção AOI TOP','Montagem PTH','Inspeção PTH','Teste','NQA','Almoxarifado']);
  select string_agg(posto || ':' || ordem || ':' || trecho_seq, ',' order by ordem) into v from sf_ordem_postos where ordem_id = v_id;
  if v <> 'SPI:0:1,Inspeção AOI TOP:1:1,Montagem PTH:2:2,Inspeção PTH:3:2,Teste:4:3,NQA:5:3,Almoxarifado:6:3' then
    raise exception 'caso D falhou (postos: %)', v;
  end if;
  perform sf_ordem_regravar_postos(v_id, array['SPI','Montagem PTH','Inspeção PTH','Teste','NQA','Almoxarifado']);
  select posto_conclui into v from sf_ordem_trechos where ordem_id = v_id and seq = 1;
  if v <> 'SPI' then raise exception 'caso D falhou (posto_conclui: %)', v; end if;
  begin
    perform sf_ordem_regravar_postos(v_id, array['Montagem PTH','Inspeção PTH','Teste','Almoxarifado']);
    raise exception 'caso D falhou (trecho vazio passou)';
  exception when raise_exception then
    if sqlerrm <> 'TRECHO_SEM_POSTO:PRT410' then raise; end if;
  end;
  select count(*) into n from sf_ordem_postos where ordem_id = v_id;
  if n <> 6 then raise exception 'caso D falhou (recusa deixou estrago: %)', n; end if;
  -- faixas: as da PMO trocadas, as próprias da PRT ficam (renumeradas depois)
  perform sf_ordem_regravar_faixas(v_id, '[{"sn_ini":"300","sn_fim":"309"}]'::jsonb);
  select string_agg(seq || ':' || sn_ini || '-' || sn_fim || ':' || trecho_seq, ',' order by seq) into v from sf_ordem_faixas where ordem_id = v_id;
  if v <> '1:300-309:3,2:A001-A010:1' then raise exception 'caso D falhou (faixas: %)', v; end if;
end $$;

-- E) OP antiga (sem trechos): a edição segue igual, tudo sem trecho
do $$
declare v_id uuid := '00000000-0000-0000-0000-000000007100'; n int;
begin
  perform sf_ordem_regravar_postos(v_id, array['Teste','Embalagem','Almoxarifado']);
  select count(*) into n from sf_ordem_postos where ordem_id = v_id and trecho_seq is null;
  if n <> 3 then raise exception 'caso E falhou (postos: %)', n; end if;
  perform sf_ordem_regravar_faixas(v_id, '[{"sn_ini":"100","sn_fim":"150"}]'::jsonb);
  select count(*) into n from sf_ordem_faixas where ordem_id = v_id and seq = 1 and sn_fim = '150' and trecho_seq is null;
  if n <> 1 then raise exception 'caso E falhou (faixas)'; end if;
end $$;

-- F) última OP da PMO: postos com o trecho, fallback de sufixo, null sem OP
do $$
declare j jsonb;
begin
  j := sf_ultima_op_da_pmo('PMOC14');
  if j->>'op' <> '9498' or j->'postos'->0->>'posto' <> 'SPI' or j->'postos'->0->>'trecho_codigo' <> 'PRT410'
     or j->'postos'->-1->>'trecho_codigo' <> 'PMOC14' or jsonb_array_length(j->'componentes') <> 1 then
    raise exception 'caso F falhou (PMOC14: %)', j;
  end if;
  j := sf_ultima_op_da_pmo('PMOANT');
  if j->>'op' <> '7100' or (j->'postos'->0->'trecho_codigo') <> 'null'::jsonb then raise exception 'caso F falhou (antiga: %)', j; end if;
  insert into sf_ordens (pmo, op, cliente) values ('PMOQ_F', '7200', 'Q');
  j := sf_ultima_op_da_pmo('PMOQ');
  if j->>'op' <> '7200' then raise exception 'caso F falhou (sufixo: %)', j; end if;
  if sf_ultima_op_da_pmo('NAOEXISTE') is not null then raise exception 'caso F falhou (inexistente)'; end if;
end $$;

-- G) excluir a OP leva tudo junto (sem FK de trecho, nada trava)
do $$
declare v_id uuid := (select o.id from sf_ordens o where o.pmo = 'PMOC14' and o.op = '9498'); n int;
begin
  delete from sf_estoque_envios where ordem_id = v_id;
  delete from sf_ordens o where o.id = v_id;
  select (select count(*) from sf_ordem_postos where ordem_id = v_id) + (select count(*) from sf_ordem_trechos where ordem_id = v_id)
       + (select count(*) from sf_ordem_faixas where ordem_id = v_id) into n;
  if n <> 0 then raise exception 'caso G falhou (%)', n; end if;
end $$;
\echo 'PROVA CADASTRO OK'
```

- [ ] **Step 2: Ligar a prova no runner**

Em `supabase/tests/rodar-estrutura-op-test.sh`, depois de `docker cp supabase/tests/estrutura_op_prova.sql ...` acrescentar `docker cp supabase/tests/cadastro_op_prova.sql "$NOME":/tmp/cadastro.sql`, e depois da linha que roda `/tmp/prova.sql`:

```bash
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/cadastro.sql
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine" && bash supabase/tests/rodar-estrutura-op-test.sh`
Expected: FAIL com `function sf_cadastrar_op(jsonb) does not exist`.

- [ ] **Step 4: Escrever as funções (0184, antes do `notify pgrst`)**

```sql
-- ---------- cadastro da OP nova numa transação: OP + trechos + postos + faixas + componentes + burn-in ----------
create or replace function public.sf_cadastrar_op(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $func$
declare
  v_id uuid;
  o jsonb := coalesce(p->'ordem', '{}'::jsonb);
  v_trechos jsonb := coalesce(p->'trechos', '[]'::jsonb);
  v_pmo_seq int;
  v_primeira jsonb;
  v_rep text;
begin
  if not (select tem_permissao('shopfloor', 'administrar')) then raise exception 'sem permissão'; end if;
  if jsonb_array_length(v_trechos) = 0 then raise exception 'SEM_TRECHO'; end if;
  select max((x->>'seq')::int) into v_pmo_seq from jsonb_array_elements(v_trechos) x;
  if (select count(*) from jsonb_array_elements(v_trechos) x where x->>'tipo' = 'pmo') <> 1
     or (select x->>'tipo' from jsonb_array_elements(v_trechos) x where (x->>'seq')::int = v_pmo_seq limit 1) <> 'pmo' then
    raise exception 'PMO_NAO_E_ULTIMO';
  end if;
  select btrim(x->>'codigo') into v_rep from jsonb_array_elements(v_trechos) x
   where jsonb_array_length(coalesce(x->'postos', '[]'::jsonb)) = 0 order by (x->>'seq')::int limit 1;
  if v_rep is not null then raise exception 'TRECHO_SEM_POSTO:%', v_rep; end if;
  select pp into v_rep from jsonb_array_elements(v_trechos) x, jsonb_array_elements_text(x->'postos') pp
   group by pp having count(*) > 1 order by pp limit 1;
  if v_rep is not null then raise exception 'POSTO_REPETIDO:%', v_rep; end if;
  select btrim(x->>'codigo') into v_rep from jsonb_array_elements(v_trechos) x
   where (x->>'tipo' = 'pmo' or x->>'sn_modo' = 'proprio') and jsonb_array_length(coalesce(x->'faixas', '[]'::jsonb)) = 0
   order by (x->>'seq')::int limit 1;
  if v_rep is not null then raise exception 'TRECHO_SEM_FAIXA:%', v_rep; end if;
  select x->'faixas'->0 into v_primeira from jsonb_array_elements(v_trechos) x where x->>'tipo' = 'pmo';

  insert into sf_ordens (pmo, op, cliente, qtd, descricao, acp, status, sn_ini, sn_fim, embalagem_individual, placas_por_painel)
  values (btrim(o->>'pmo'), btrim(o->>'op'), btrim(coalesce(o->>'cliente', '')), nullif(o->>'qtd', '')::int,
          coalesce(o->>'descricao', ''), coalesce(o->>'acp', ''), 'ATIVA',
          btrim(v_primeira->>'sn_ini'), btrim(v_primeira->>'sn_fim'),
          coalesce((o->>'embalagem_individual')::boolean, false), coalesce((o->>'placas_por_painel')::int, 1))
  returning id into v_id;

  insert into sf_ordem_trechos (ordem_id, seq, codigo, tipo, posto_conclui, sn_modo, estoque, compels_op)
  select v_id, (x->>'seq')::int, btrim(x->>'codigo'), x->>'tipo',
         x->'postos'->>(jsonb_array_length(x->'postos') - 1),
         case when x->>'tipo' = 'pmo' then 'mesmo' else coalesce(x->>'sn_modo', 'mesmo') end,
         case when x->>'tipo' = 'pmo' then 'PA' else 'EINTER' end,
         nullif(btrim(coalesce(x->>'compels_op', '')), '')
    from jsonb_array_elements(v_trechos) x;

  insert into sf_ordem_postos (ordem_id, posto, ordem, trecho_seq)
  select v_id, pp.posto, (row_number() over (order by (x->>'seq')::int, pp.ord) - 1)::int, (x->>'seq')::int
    from jsonb_array_elements(v_trechos) x
   cross join lateral jsonb_array_elements_text(x->'postos') with ordinality pp(posto, ord);

  -- o trigger da 0181 já pôs a faixa 1 pelo sn_ini/sn_fim: a lista inteira a substitui (PMO primeiro)
  delete from sf_ordem_faixas where ordem_id = v_id;
  insert into sf_ordem_faixas (ordem_id, seq, sn_ini, sn_fim, trecho_seq)
  select v_id, row_number() over (order by (x->>'tipo' <> 'pmo'), (x->>'seq')::int, ff.ord),
         btrim(ff.f->>'sn_ini'), btrim(ff.f->>'sn_fim'), (x->>'seq')::int
    from jsonb_array_elements(v_trechos) x
   cross join lateral jsonb_array_elements(
           case when x->>'tipo' = 'pmo' or x->>'sn_modo' = 'proprio' then coalesce(x->'faixas', '[]'::jsonb)
                else '[]'::jsonb end) with ordinality ff(f, ord);

  insert into sf_ordem_componentes (ordem_id, posto, pmo_componente)
  select distinct v_id, c->>'posto', btrim(c->>'pmo')
    from jsonb_array_elements(coalesce(p->'componentes', '[]'::jsonb)) c
   where exists (select 1 from sf_ordem_postos op where op.ordem_id = v_id and op.posto = c->>'posto');
  insert into sf_ordem_burnin (ordem_id, posto, tempo_min)
  select distinct on (b->>'posto') v_id, b->>'posto', (b->>'tempo_min')::int
    from jsonb_array_elements(coalesce(p->'burnin', '[]'::jsonb)) b
   where exists (select 1 from sf_ordem_postos op where op.ordem_id = v_id and op.posto = b->>'posto');
  return v_id;
end
$func$;
revoke all on function public.sf_cadastrar_op(jsonb) from public, anon;
grant execute on function public.sf_cadastrar_op(jsonb) to authenticated, service_role;

-- ---------- edição: regrava a rota preservando o trecho de cada posto ----------
create or replace function public.sf_ordem_regravar_postos(p_ordem_id uuid, p_postos text[])
returns void language plpgsql security definer set search_path = public as $func$
declare
  v_pmo_seq int;
  v_antigos jsonb;
  v_vazio text;
begin
  if not (select tem_permissao('shopfloor', 'administrar')) then raise exception 'sem permissão'; end if;
  select seq into v_pmo_seq from sf_ordem_trechos where ordem_id = p_ordem_id and tipo = 'pmo';
  select coalesce(jsonb_object_agg(posto, trecho_seq), '{}'::jsonb) into v_antigos
    from sf_ordem_postos where ordem_id = p_ordem_id;
  delete from sf_ordem_postos where ordem_id = p_ordem_id;
  insert into sf_ordem_postos (ordem_id, posto, ordem, trecho_seq)
  select p_ordem_id, x.posto, (x.ord - 1)::int, coalesce((v_antigos->>x.posto)::int, v_pmo_seq)
    from unnest(coalesce(p_postos, '{}'::text[])) with ordinality x(posto, ord);
  select ot.codigo into v_vazio from sf_ordem_trechos ot
   where ot.ordem_id = p_ordem_id
     and not exists (select 1 from sf_ordem_postos p where p.ordem_id = ot.ordem_id and p.trecho_seq = ot.seq)
   order by ot.seq limit 1;
  if v_vazio is not null then raise exception 'TRECHO_SEM_POSTO:%', v_vazio; end if;
  update sf_ordem_trechos ot
     set posto_conclui = (select p.posto from sf_ordem_postos p
                           where p.ordem_id = ot.ordem_id and p.trecho_seq = ot.seq order by p.ordem desc limit 1)
   where ot.ordem_id = p_ordem_id;
end
$func$;
revoke all on function public.sf_ordem_regravar_postos(uuid, text[]) from public, anon;
grant execute on function public.sf_ordem_regravar_postos(uuid, text[]) to authenticated, service_role;

-- ---------- edição: regrava as faixas da PMO; as próprias das PRTs ficam (depois) ----------
create or replace function public.sf_ordem_regravar_faixas(p_ordem_id uuid, p_faixas jsonb)
returns void language plpgsql security definer set search_path = public as $func$
declare
  v_pmo_seq int;
  v_prt jsonb;
begin
  if not (select tem_permissao('shopfloor', 'administrar')) then raise exception 'sem permissão'; end if;
  select seq into v_pmo_seq from sf_ordem_trechos where ordem_id = p_ordem_id and tipo = 'pmo';
  select coalesce(jsonb_agg(jsonb_build_object('sn_ini', f.sn_ini, 'sn_fim', f.sn_fim, 'trecho_seq', f.trecho_seq) order by f.seq), '[]'::jsonb)
    into v_prt
    from sf_ordem_faixas f
   where f.ordem_id = p_ordem_id and f.trecho_seq is not null and f.trecho_seq is distinct from v_pmo_seq;
  delete from sf_ordem_faixas where ordem_id = p_ordem_id;
  insert into sf_ordem_faixas (ordem_id, seq, sn_ini, sn_fim, trecho_seq)
  select p_ordem_id, row_number() over (order by z.grupo, z.ord), z.sn_ini, z.sn_fim, z.trecho_seq
    from (
      select 1 as grupo, a.ord, btrim(a.f->>'sn_ini') as sn_ini, btrim(a.f->>'sn_fim') as sn_fim, v_pmo_seq as trecho_seq
        from jsonb_array_elements(case when jsonb_typeof(p_faixas) = 'array' then p_faixas else '[]'::jsonb end)
             with ordinality a(f, ord)
      union all
      select 2, b.ord, b.f->>'sn_ini', b.f->>'sn_fim', (b.f->>'trecho_seq')::int
        from jsonb_array_elements(v_prt) with ordinality b(f, ord)
    ) z;
end
$func$;
revoke all on function public.sf_ordem_regravar_faixas(uuid, jsonb) from public, anon;
grant execute on function public.sf_ordem_regravar_faixas(uuid, jsonb) to authenticated, service_role;

-- ---------- a última OP da PMO (para a OP nova copiar os postos) — leitura com a RLS de quem chama ----------
create or replace function public.sf_ultima_op_da_pmo(p_pmo text)
returns jsonb language sql stable security invoker set search_path = public as $func$
  with alvo as (
    select o.* from sf_ordens o
     where o.pmo = p_pmo or left(o.pmo, length(p_pmo) + 1) = p_pmo || '_'
     order by (o.pmo = p_pmo) desc, o.created_at desc, o.id
     limit 1
  )
  select jsonb_build_object(
    'op', a.op, 'cliente', a.cliente, 'descricao', a.descricao,
    'placas_por_painel', a.placas_por_painel, 'embalagem_individual', a.embalagem_individual,
    'postos', coalesce((select jsonb_agg(jsonb_build_object('posto', p.posto, 'trecho_codigo', t.codigo) order by p.ordem)
                          from sf_ordem_postos p
                          left join sf_ordem_trechos t on t.ordem_id = p.ordem_id and t.seq = p.trecho_seq
                         where p.ordem_id = a.id), '[]'::jsonb),
    'componentes', coalesce((select jsonb_agg(jsonb_build_object('posto', c.posto, 'pmo', c.pmo_componente) order by c.posto, c.pmo_componente)
                               from sf_ordem_componentes c where c.ordem_id = a.id), '[]'::jsonb),
    'burnin', coalesce((select jsonb_agg(jsonb_build_object('posto', b.posto, 'tempo_min', b.tempo_min) order by b.posto)
                          from sf_ordem_burnin b where b.ordem_id = a.id), '[]'::jsonb))
    from alvo a
$func$;
revoke all on function public.sf_ultima_op_da_pmo(text) from public, anon;
grant execute on function public.sf_ultima_op_da_pmo(text) to authenticated, service_role;
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine" && bash supabase/tests/rodar-estrutura-op-test.sh`
Expected: `PROVA ESTRUTURA OK`, `PROVA CADASTRO OK`, `ESTRUTURA OP SQL OK`.

- [ ] **Step 6: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine"
git add supabase/migrations/0184_estrutura_op.sql supabase/tests/cadastro_op_prova.sql supabase/tests/rodar-estrutura-op-test.sh
git commit -m "feat(ordens): funções do cadastro de OP por trechos e da edição que preserva os trechos (0184)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: espelho das OPs ativas do Compels (cliente, sincronização, cron)

**Files:**
- Create: `src/modules/compels/domain/espelho-ops.ts`, `src/modules/compels/domain/__tests__/espelho-ops.test.ts`
- Modify: `src/modules/compels/infra/cliente.ts`, `src/modules/compels/infra/__tests__/cliente.test.ts`
- Create: `src/modules/compels/application/sincronizar-espelho-ops.ts`, `src/modules/compels/application/__tests__/sincronizar-espelho-ops.test.ts`
- Create: `src/modules/shopfloor/infra/espelho-ops-repository.ts`, `src/modules/shopfloor/infra/__tests__/espelho-ops-repository.test.ts`
- Create: `src/modules/compels/domain/rotas-espelho-ops.ts`, `src/modules/compels/domain/__tests__/rotas-espelho-ops.test.ts`
- Create: `src/app/api/compels/espelho-ops/route.ts`
- Modify: `middleware.ts`, `tools/estoque/README.md`

**Interfaces:**
- Consumes: `sf_compels_ops_sincronizar(p_ops jsonb)` e a tabela `sf_compels_ops` (Task 1).
- Produces:
  - `interface OpEspelhoLida { numero: number; idCompels: number; codigo: string; descricao: string; situacao: string; nivel: number; quantidade: number; quantidadeProduzida: number; maeNumero: number | null; principalNumero: number | null; cliente: string; dataDocumento: string | null }` (em `@/modules/compels/domain/espelho-ops`)
  - `SITUACOES_ATIVAS`, `filtroOpsAtivas(agoraMs: number): Record<string, unknown>`, `opDaLinhaLista(linha: unknown): OpEspelhoLida | null`
  - `ClienteCompels.listarOpsAtivas(): Promise<OpEspelhoLida[]>`
  - `interface ContagemEspelho { novas: number; atualizadas: number; inativadas: number }`, `sincronizarEspelhoOps(p: { listar: () => Promise<OpEspelhoLida[]>; gravar: (ops: OpEspelhoLida[]) => Promise<ContagemEspelho> }): Promise<ContagemEspelho & { lidas: number }>`
  - `type OpEspelho = OpEspelhoLida & { ativa: boolean; lidoEm: string }` (também em `@/modules/compels/domain/espelho-ops`: é o que a tela lê do espelho)
  - `gravarEspelhoDoServico(sb?: SupabaseClient): (ops: OpEspelhoLida[]) => Promise<ContagemEspelho>`, `listarEspelho(): Promise<OpEspelho[]>`
  - `ehRotaDoEspelhoDeOps(pathname: string): boolean`

- [ ] **Step 1: Testes do domínio (`src/modules/compels/domain/__tests__/espelho-ops.test.ts`)**

```ts
import { describe, expect, it } from 'vitest'
import { filtroOpsAtivas, opDaLinhaLista, SITUACOES_ATIVAS } from '../espelho-ops'

const LINHA = {
  id: 13100, numero: 8498, status: 'Em Processo', nivel: 1, ordemProducaoMaeNumero: null, ordemProducaoPrincipalNumero: null,
  quantidade: 10, quantidadeProduzida: 4, dataDocumento: '2026-11-10T00:00:00',
  composicaoProduto: { item: { codigo: ' PMOC14 ', descricao: 'PLACA X ' } }, negociante: { codigo: 'C0123' },
}

describe('opDaLinhaLista', () => {
  it('converte a linha da lista do Compels', () => {
    expect(opDaLinhaLista(LINHA)).toEqual({
      numero: 8498, idCompels: 13100, codigo: 'PMOC14', descricao: 'PLACA X', situacao: 'Em Processo', nivel: 1,
      quantidade: 10, quantidadeProduzida: 4, maeNumero: null, principalNumero: null, cliente: 'C0123', dataDocumento: '2026-11-10',
    })
  })
  it('data em milissegundos vira AAAA-MM-DD; sem data = null', () => {
    expect(opDaLinhaLista({ ...LINHA, dataDocumento: Date.UTC(2026, 10, 9) })?.dataDocumento).toBe('2026-11-09')
    expect(opDaLinhaLista({ ...LINHA, dataDocumento: undefined })?.dataDocumento).toBeNull()
  })
  it('sem número, sem id ou sem código = null (nunca inventa)', () => {
    expect(opDaLinhaLista({ ...LINHA, numero: undefined })).toBeNull()
    expect(opDaLinhaLista({ ...LINHA, id: 'x' })).toBeNull()
    expect(opDaLinhaLista({ ...LINHA, composicaoProduto: { item: { codigo: '' } } })).toBeNull()
  })
})

describe('filtroOpsAtivas', () => {
  it('mesmo filtro da busca de OP, sem número, com as 4 situações ativas e o último ano', () => {
    const f = filtroOpsAtivas(Date.UTC(2026, 10, 18))
    expect(f.numero).toBe('')
    expect(f.statusList).toEqual(['Aberta', 'Planejada', 'Empenhada', 'Em Processo'])
    expect(SITUACOES_ATIVAS).toEqual(['Aberta', 'Planejada', 'Empenhada', 'Em Processo'])
    expect(f.dataInicial).toBe('2025-11-18T00:00:00')
    expect(f.dataFinal).toBe('2026-11-18T00:00:00')
    expect(f.selecionarOPPor).toBe('op')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine" && npx vitest run --maxWorkers=2 src/modules/compels/domain/__tests__/espelho-ops.test.ts`
Expected: FAIL (`Cannot find module '../espelho-ops'`).

- [ ] **Step 3: Implementar `src/modules/compels/domain/espelho-ops.ts`**

```ts
/**
 * ESPELHO DAS OPs ATIVAS DO COMPELS (spec 2026-11-18-cadastro-op-compels-design.md). A lista da tela de OPs
 * (`ordemProducaoSimples/findAllFilter`, HAR 18/11) já traz o código/descrição do produto e a árvore (mãe,
 * principal, nível): o cron grava cada linha em `sf_compels_ops` e o cadastro de OP só lê o espelho.
 */
export const SITUACOES_ATIVAS = ['Aberta', 'Planejada', 'Empenhada', 'Em Processo'] as const

export interface OpEspelhoLida {
  numero: number
  idCompels: number
  codigo: string
  descricao: string
  situacao: string
  nivel: number
  quantidade: number
  quantidadeProduzida: number
  maeNumero: number | null
  principalNumero: number | null
  /** `negociante.codigo` do Compels. */
  cliente: string
  /** AAAA-MM-DD, ou null. */
  dataDocumento: string | null
}

/** Uma OP do espelho como a tela lê de `sf_compels_ops`: + se ainda está na lista de ativas e a hora da leitura. */
export type OpEspelho = OpEspelhoLida & { ativa: boolean; lidoEm: string }

const UM_ANO_MS = 365 * 24 * 60 * 60 * 1000
const dataIso = (ms: number) => new Date(ms).toISOString().slice(0, 10) + 'T00:00:00'
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** O filtro da busca de OP (o mesmo de `ClienteCompels.buscarOp`) sem número, só as situações ativas, último ano. */
export function filtroOpsAtivas(agoraMs: number): Record<string, unknown> {
  return {
    numero: '', codigoNegociante: null, nomeNegociante: null, cpfCnpjNegociante: null,
    clientePedido: '', item: '', linha: '', tipoPropriedade: null, statusList: [...SITUACOES_ATIVAS],
    selecionarPor: 'Data Documento', dataInicial: dataIso(agoraMs - UM_ANO_MS), dataFinal: dataIso(agoraMs),
    numeroPedido: '', centroCusto: '', listarPendentes: false, prototipo: false, etapa: '',
    selecionarOPPor: 'op', observacao: '', nivel: '', responsavelCriacao: '', responsavelAlteracao: '',
    situacaoId: null, semVinculoComSolicitacaoInternaCompra: false,
  }
}

function data(v: unknown): string | null {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString().slice(0, 10)
  return null
}

/** Uma linha da lista → OP do espelho. Sem número, id ou código do produto = null (nunca inventa). */
export function opDaLinhaLista(linha: unknown): OpEspelhoLida | null {
  const l = (linha ?? {}) as Record<string, unknown>
  const item = ((l.composicaoProduto as { item?: Record<string, unknown> } | undefined)?.item ?? {}) as Record<string, unknown>
  const numero = num(l.numero)
  const id = num(l.id)
  const codigo = texto(item.codigo)
  if (numero === null || id === null || codigo === '') return null
  return {
    numero,
    idCompels: id,
    codigo,
    descricao: texto(item.descricao),
    situacao: texto(l.status),
    nivel: num(l.nivel) ?? 1,
    quantidade: num(l.quantidade) ?? 0,
    quantidadeProduzida: num(l.quantidadeProduzida) ?? 0,
    maeNumero: num(l.ordemProducaoMaeNumero),
    principalNumero: num(l.ordemProducaoPrincipalNumero),
    cliente: texto((l.negociante as { codigo?: unknown } | undefined)?.codigo),
    dataDocumento: data(l.dataDocumento),
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine" && npx vitest run --maxWorkers=2 src/modules/compels/domain/__tests__/espelho-ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Teste do cliente (acrescentar dentro do `describe('ClienteCompels', ...)` em `src/modules/compels/infra/__tests__/cliente.test.ts`)**

```ts
  it('listarOpsAtivas: pagina de 100 em 100 até o totalCount, com o filtro das situações ativas', async () => {
    const linha = (n: number) => ({ id: n, numero: n, status: 'Aberta', nivel: 1, composicaoProduto: { item: { codigo: `PMO${n}`, descricao: '' } } })
    const paginas: Record<string, unknown> = {
      '1': { success: true, totalCount: 150, data: Array.from({ length: 100 }, (_, i) => linha(i + 1)) },
      '2': { success: true, totalCount: 150, data: [...Array.from({ length: 49 }, (_, i) => linha(i + 101)), { numero: 999 }] },
    }
    const corpos: URLSearchParams[] = []
    const buscar = (async (_url: string | URL | Request, init: RequestInit = {}) => {
      const corpo = new URLSearchParams(String(init.body))
      corpos.push(corpo)
      return json(paginas[corpo.get('page') ?? ''] ?? { data: [] })
    }) as unknown as typeof fetch
    const c = new ClienteCompels(config, tokenFixo(), buscar, () => Date.UTC(2026, 10, 18))
    const ops = await c.listarOpsAtivas()
    expect(ops).toHaveLength(149) // a linha sem código é descartada
    expect(corpos.map((x) => [x.get('page'), x.get('start'), x.get('limit'), x.get('sortFilter')])).toEqual([['1', '0', '100', 'null'], ['2', '100', '100', 'null']])
    expect(JSON.parse(corpos[0]!.get('filtro')!).statusList).toEqual(['Aberta', 'Planejada', 'Empenhada', 'Em Processo'])
  })

  it('listarOpsAtivas: lista que para antes do totalCount é erro (não pode inativar o resto)', async () => {
    const buscar = (async () => json({ success: true, totalCount: 500, data: [] })) as unknown as typeof fetch
    const c = new ClienteCompels(config, tokenFixo(), buscar)
    await expect(c.listarOpsAtivas()).rejects.toThrow()
  })
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine" && npx vitest run --maxWorkers=2 src/modules/compels/infra/__tests__/cliente.test.ts`
Expected: FAIL (`c.listarOpsAtivas is not a function`).

- [ ] **Step 7: Implementar `listarOpsAtivas` em `src/modules/compels/infra/cliente.ts`**

Import no topo: `import { filtroOpsAtivas, opDaLinhaLista, type OpEspelhoLida } from '../domain/espelho-ops'`. Método novo, logo depois de `lerDescendentes`:

```ts
  /**
   * As OPs ATIVAS (Aberta/Planejada/Empenhada/Em Processo) do último ano, pela lista da tela de OPs (HAR 18/11):
   * `POST ordemProducaoSimples/findAllFilter` paginado até o `totalCount`. Só leitura — é o espelho do cadastro de OP.
   * Lista que acaba antes do total é erro: o espelho inativa quem não veio, então lista incompleta nunca é gravada.
   */
  async listarOpsAtivas(): Promise<OpEspelhoLida[]> {
    const filtro = JSON.stringify(filtroOpsAtivas(this.agora()))
    const limite = 100
    const brutas: unknown[] = []
    let total: number | null = null
    for (let pagina = 1; pagina <= 50; pagina++) {
      const resposta = await this.json('/ordemProducaoSimples/findAllFilter', this.formulario({
        sortFilter: 'null', filtro, page: String(pagina), start: String((pagina - 1) * limite), limit: String(limite),
      }))
      const linhas = listaDe(resposta, 'lista de OPs ativas')
      brutas.push(...linhas)
      const t = (resposta as { totalCount?: unknown } | null)?.totalCount
      if (typeof t === 'number') total = t
      if (linhas.length < limite || (total !== null && brutas.length >= total)) break
    }
    if (total !== null && brutas.length < total) throw new RespostaInesperada(`lista de OPs ativas incompleta (${brutas.length} de ${total})`)
    return brutas.map(opDaLinhaLista).filter((o): o is OpEspelhoLida => o !== null)
  }
```

- [ ] **Step 8: Rodar e ver passar**

Run: `cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine" && npx vitest run --maxWorkers=2 src/modules/compels/infra/__tests__/cliente.test.ts`
Expected: PASS.

- [ ] **Step 9: Testes da sincronização, do repositório e da rota**

`src/modules/compels/application/__tests__/sincronizar-espelho-ops.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { sincronizarEspelhoOps } from '../sincronizar-espelho-ops'
import type { OpEspelhoLida } from '../../domain/espelho-ops'

const op = (numero: number): OpEspelhoLida => ({
  numero, idCompels: numero, codigo: 'PMOC14', descricao: '', situacao: 'Aberta', nivel: 1, quantidade: 1,
  quantidadeProduzida: 0, maeNumero: null, principalNumero: null, cliente: '', dataDocumento: null,
})

describe('sincronizarEspelhoOps', () => {
  it('lista e grava tudo de uma vez', async () => {
    const gravar = vi.fn(async () => ({ novas: 1, atualizadas: 1, inativadas: 0 }))
    expect(await sincronizarEspelhoOps({ listar: async () => [op(1), op(2)], gravar })).toEqual({ lidas: 2, novas: 1, atualizadas: 1, inativadas: 0 })
    expect(gravar).toHaveBeenCalledWith([op(1), op(2)])
  })
  it('lista vazia não grava (não pode inativar o espelho inteiro)', async () => {
    const gravar = vi.fn()
    await expect(sincronizarEspelhoOps({ listar: async () => [], gravar })).rejects.toThrow('O Compels devolveu a lista de OPs vazia')
    expect(gravar).not.toHaveBeenCalled()
  })
})
```

`src/modules/shopfloor/infra/__tests__/espelho-ops-repository.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const consulta = vi.hoisted(() => ({ select: vi.fn(), order: vi.fn() }))
vi.mock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => ({ from: () => consulta }) }))
vi.mock('@/shared/lib/supabase/service', () => ({ createServiceSupabase: () => null }))

import { gravarEspelhoDoServico, listarEspelho } from '../espelho-ops-repository'

describe('espelho-ops-repository', () => {
  it('grava pela sf_compels_ops_sincronizar com as chaves do banco', async () => {
    const rpc = vi.fn(async () => ({ data: { novas: 1, atualizadas: 0, inativadas: 0 }, error: null }))
    const gravar = gravarEspelhoDoServico({ rpc } as never)
    const r = await gravar([{ numero: 8498, idCompels: 1, codigo: 'PMOC14', descricao: 'X', situacao: 'Aberta', nivel: 1, quantidade: 10, quantidadeProduzida: 0, maeNumero: null, principalNumero: null, cliente: 'C', dataDocumento: '2026-11-10' }])
    expect(r).toEqual({ novas: 1, atualizadas: 0, inativadas: 0 })
    expect(rpc).toHaveBeenCalledWith('sf_compels_ops_sincronizar', { p_ops: [{
      numero: 8498, id_compels: 1, codigo: 'PMOC14', descricao: 'X', situacao: 'Aberta', nivel: 1, quantidade: 10,
      quantidade_produzida: 0, mae_numero: null, principal_numero: null, cliente: 'C', data_documento: '2026-11-10',
    }] })
  })
  it('lista o espelho convertido', async () => {
    consulta.select.mockReturnValue(consulta)
    consulta.order.mockResolvedValue({ data: [{ numero: 8498, id_compels: 1, codigo: 'PMOC14', descricao: 'X', situacao: 'Aberta', nivel: 1, quantidade: '10', quantidade_produzida: '0', mae_numero: null, principal_numero: null, cliente: 'C', data_documento: '2026-11-10', ativa: true, lido_em: '2026-11-18T13:00:00Z' }], error: null })
    expect(await listarEspelho()).toEqual([{ numero: 8498, idCompels: 1, codigo: 'PMOC14', descricao: 'X', situacao: 'Aberta', nivel: 1, quantidade: 10, quantidadeProduzida: 0, maeNumero: null, principalNumero: null, cliente: 'C', dataDocumento: '2026-11-10', ativa: true, lidoEm: '2026-11-18T13:00:00Z' }])
  })
})
```

`src/modules/compels/domain/__tests__/rotas-espelho-ops.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ehRotaDoEspelhoDeOps } from '../rotas-espelho-ops'

describe('ehRotaDoEspelhoDeOps', () => {
  it('só a rota exata (com ou sem barra final) sai da sessão', () => {
    expect(ehRotaDoEspelhoDeOps('/api/compels/espelho-ops')).toBe(true)
    expect(ehRotaDoEspelhoDeOps('/api/compels/espelho-ops/')).toBe(true)
    expect(ehRotaDoEspelhoDeOps('/api/compels/espelho-ops/x')).toBe(false)
    expect(ehRotaDoEspelhoDeOps('/api/compels/espelho-opsx')).toBe(false)
  })
})
```

- [ ] **Step 10: Rodar e ver falhar**

Run: `cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine" && npx vitest run --maxWorkers=2 src/modules/compels/application/__tests__/sincronizar-espelho-ops.test.ts src/modules/shopfloor/infra/__tests__/espelho-ops-repository.test.ts src/modules/compels/domain/__tests__/rotas-espelho-ops.test.ts`
Expected: FAIL (módulos não existem).

- [ ] **Step 11: Implementar sincronização, repositório e rotas**

`src/modules/compels/application/sincronizar-espelho-ops.ts`:

```ts
import type { OpEspelhoLida } from '../domain/espelho-ops'

export interface ContagemEspelho { novas: number; atualizadas: number; inativadas: number }

/** Uma rodada do espelho: lê a lista inteira de OPs ativas e grava de uma vez. Lista vazia nunca é gravada. */
export async function sincronizarEspelhoOps(p: {
  listar: () => Promise<OpEspelhoLida[]>
  gravar: (ops: OpEspelhoLida[]) => Promise<ContagemEspelho>
}): Promise<ContagemEspelho & { lidas: number }> {
  const ops = await p.listar()
  if (ops.length === 0) throw new Error('O Compels devolveu a lista de OPs vazia: nada foi gravado.')
  return { lidas: ops.length, ...(await p.gravar(ops)) }
}
```

`src/modules/shopfloor/infra/espelho-ops-repository.ts`:

```ts
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { createServiceSupabase } from '@/shared/lib/supabase/service'
import type { OpEspelho, OpEspelhoLida } from '@/modules/compels/domain/espelho-ops'
import type { ContagemEspelho } from '@/modules/compels/application/sincronizar-espelho-ops'

/** Grava a rodada pela sf_compels_ops_sincronizar (0184). Só o cron chama, com a service role. */
export function gravarEspelhoDoServico(sb: SupabaseClient = createServiceSupabase()) {
  return async (ops: OpEspelhoLida[]): Promise<ContagemEspelho> => {
    const { data, error } = await sb.rpc('sf_compels_ops_sincronizar', {
      p_ops: ops.map((o) => ({
        numero: o.numero, id_compels: o.idCompels, codigo: o.codigo, descricao: o.descricao, situacao: o.situacao,
        nivel: o.nivel, quantidade: o.quantidade, quantidade_produzida: o.quantidadeProduzida, mae_numero: o.maeNumero,
        principal_numero: o.principalNumero, cliente: o.cliente, data_documento: o.dataDocumento,
      })),
    })
    if (error) throw new Error(`gravar o espelho do Compels: ${error.message}`)
    return data as ContagemEspelho
  }
}

interface Linha {
  numero: number; id_compels: number; codigo: string; descricao: string; situacao: string; nivel: number
  quantidade: number | string; quantidade_produzida: number | string; mae_numero: number | null
  principal_numero: number | null; cliente: string; data_documento: string | null; ativa: boolean; lido_em: string
}

/** O espelho inteiro (ativas e as que já saíram da lista), pela sessão (RLS: shopfloor.administrar). */
export async function listarEspelho(): Promise<OpEspelho[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.from('sf_compels_ops').select('*').order('numero')
  if (error) throw new Error(`sf_compels_ops: ${error.message}`)
  return ((data ?? []) as Linha[]).map((l) => ({
    numero: l.numero, idCompels: l.id_compels, codigo: l.codigo, descricao: l.descricao, situacao: l.situacao,
    nivel: l.nivel, quantidade: Number(l.quantidade), quantidadeProduzida: Number(l.quantidade_produzida),
    maeNumero: l.mae_numero, principalNumero: l.principal_numero, cliente: l.cliente, dataDocumento: l.data_documento,
    ativa: l.ativa, lidoEm: l.lido_em,
  }))
}
```

`src/modules/compels/domain/rotas-espelho-ops.ts`:

```ts
/**
 * O espelho das OPs do Compels (`POST /api/compels/espelho-ops`) NÃO passa pela sessão do app: quem autoriza é o
 * segredo `ESTOQUE_CRON_SECRET`, conferido dentro da própria rota (crontab da instância). Mesma regra da baixa de
 * NF e da planilha do SAT: sem esta saída no `middleware.ts` o pedido levaria redirect pro /login e o `curl -f` do
 * cron trataria isso como sucesso. Rota EXATA (tolera uma barra final).
 */
const ROTA_ESPELHO = '/api/compels/espelho-ops'

export function ehRotaDoEspelhoDeOps(pathname: string): boolean {
  return pathname === ROTA_ESPELHO || pathname === `${ROTA_ESPELHO}/`
}
```

- [ ] **Step 12: Rota do cron `src/app/api/compels/espelho-ops/route.ts`** (conferir em `node_modules/next/dist/docs/` a convenção de Route Handler antes)

```ts
import { ClienteCompels } from '@/modules/compels/infra/cliente'
import { configDoAmbiente } from '@/modules/compels/infra/config'
import { sincronizarEspelhoOps } from '@/modules/compels/application/sincronizar-espelho-ops'
import { gravarEspelhoDoServico } from '@/modules/shopfloor/infra/espelho-ops-repository'
import { segredoConfere } from '@/modules/alertas/infra/assinatura'

/** Depende do cabeçalho e lê o Compels: nunca pode ser servida de cache. */
export const dynamic = 'force-dynamic'

/** Prefixo de toda linha de log desta rodada — é por ele que se filtra o log do pm2. */
const TAG = '[espelho-ops]'

/** Uma rodada por vez neste processo. */
let rodando = false

/**
 * ESPELHO DAS OPs ATIVAS DO COMPELS (spec 2026-11-18-cadastro-op-compels-design.md): de 10 em 10 minutos o crontab
 * da instância chama esta rota com o MESMO segredo e o mesmo arquivo de cabeçalho do cron de estoque:
 *   curl -fsS -m 120 -X POST -H @$HOME/.estoque-cron-header http://127.0.0.1:3000/api/compels/espelho-ops
 * Só lê o Compels; grava em sf_compels_ops com a service role. Compels fora = 503 e o espelho fica como estava.
 */
export async function POST(request: Request): Promise<Response> {
  const esperado = process.env.ESTOQUE_CRON_SECRET ?? ''
  if (esperado === '') return Response.json({ erro: 'Cron não configurado neste ambiente.' }, { status: 503 })
  const recebido = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? null
  if (!segredoConfere(recebido, esperado)) return Response.json({ erro: 'Não autorizado.' }, { status: 401 })

  if (rodando) return Response.json({ ocupado: true })
  rodando = true
  try {
    const cliente = new ClienteCompels(configDoAmbiente())
    const r = await sincronizarEspelhoOps({ listar: () => cliente.listarOpsAtivas(), gravar: gravarEspelhoDoServico() })
    console.log(`${TAG} ${new Date().toISOString()} ${r.lidas} OPs ativas lidas; novas ${r.novas}, atualizadas ${r.atualizadas}, saíram ${r.inativadas}`)
    return Response.json(r)
  } catch (e) {
    console.error(`${TAG} ${new Date().toISOString()} rodada não aconteceu:`, e instanceof Error ? e.message : e)
    return Response.json({ erro: 'Compels ou banco indisponível.' }, { status: 503 })
  } finally {
    rodando = false
  }
}
```

- [ ] **Step 13: Liberar a rota no `middleware.ts`**

Import: `import { ehRotaDoEspelhoDeOps } from '@/modules/compels/domain/rotas-espelho-ops'`. No comentário, depois da linha da planilha do SAT, acrescentar `// O espelho das OPs do Compels (/api/compels/espelho-ops) também é cron: autoriza o ESTOQUE_CRON_SECRET na rota.`. Na condição, depois de `ehRotaDaSincronizacaoSat(request.nextUrl.pathname)`:

```ts
    ehRotaDaSincronizacaoSat(request.nextUrl.pathname) ||
    ehRotaDoEspelhoDeOps(request.nextUrl.pathname)
```

- [ ] **Step 14: Crontab no `tools/estoque/README.md`** — acrescentar uma seção no fim:

````markdown
## Espelho das OPs do Compels (cadastro de OP)

O cadastro de OP (Ordens → Nova OP) lê a cópia das OPs ativas do Compels em `sf_compels_ops`. Quem atualiza é
este cron, de 10 em 10 minutos, com o mesmo `~/.estoque-cron-header`. Horário em UTC: 10:00–21:59 = 07:00–18:59 BRT,
seg–sex (dentro da janela do RDS ligado).

```
*/10 10-21 * * 1-5 flock -n $HOME/.espelho-ops.lock curl -fsS -m 120 -X POST -H @$HOME/.estoque-cron-header http://127.0.0.1:3000/api/compels/espelho-ops >> $HOME/espelho-ops.log 2>&1
```

Confira com `tail ~/espelho-ops.log`: uma linha JSON por rodada (`lidas`, `novas`, `atualizadas`, `inativadas`).
Um `302`/HTML no log quer dizer que a rota não está liberada no `middleware.ts`.
````

- [ ] **Step 15: Rodar testes, tipos e lint**

Run: `cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine" && npx vitest run --maxWorkers=2 src/modules/compels src/modules/shopfloor/infra/__tests__/espelho-ops-repository.test.ts && npx tsc --noEmit -p . && npx eslint middleware.ts src/app/api/compels/espelho-ops src/modules/compels src/modules/shopfloor/infra/espelho-ops-repository.ts`
Expected: PASS, sem erro de tipo, sem erro de lint.

- [ ] **Step 16: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine"
git add src/modules/compels src/modules/shopfloor/infra/espelho-ops-repository.ts src/modules/shopfloor/infra/__tests__/espelho-ops-repository.test.ts src/app/api/compels/espelho-ops middleware.ts tools/estoque/README.md
git commit -m "feat(compels): espelho das OPs ativas do Compels de 10 em 10 minutos (cron liberado no middleware)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: regras puras do cadastro (`domain/cadastro-op.ts`)

**Files:**
- Create: `src/modules/shopfloor/domain/cadastro-op.ts`, `src/modules/shopfloor/domain/__tests__/cadastro-op.test.ts`

**Interfaces:**
- Consumes: `OpEspelho` (Task 3, `@/modules/compels/domain/espelho-ops`, `import type`), `FaixaSN`, `faixasSobrepoem` (`domain/faixas-sn`), `faixaCoerente` (`domain/serie`), `validarOrdem` (`domain/validar-ordem`), `rotaPadraoOpNova` (`domain/rota-op-nova`).
- Produces (todos exportados de `@/modules/shopfloor/domain/cadastro-op`):
  - `type SnModo = 'mesmo' | 'proprio'`, `type TipoTrecho = 'prt' | 'pmo'`
  - `type { OpEspelho }` (reexport)
  - `interface TrechoCadastro { seq: number; codigo: string; tipo: TipoTrecho; compelsOp: string | null; descricao: string; quantidade: number | null; situacao: string; snModo: SnModo; postos: string[]; faixas: FaixaSN[] }`
  - `interface PostoAnterior { posto: string; trechoCodigo: string | null }`
  - `interface UltimaOp { op: string; cliente: string; descricao: string; placasPorPainel: number; embalagemIndividual: boolean; postos: PostoAnterior[]; componentes: { posto: string; pmo: string }[]; burnin: { posto: string; tempo_min: number }[] }`
  - `interface CadastroOp { modo: 'compels' | 'manual'; pmo: string; op: string; cliente: string; descricao: string; qtd: number | null; acp: string; embalagemIndividual: boolean; placasPorPainel: number; trechos: TrechoCadastro[]; componentes: { posto: string; pmo: string }[]; burnin: { posto: string; tempo_min: number }[] }`
  - `interface PmoDoEspelho { pmo: string; descricao: string; abertas: number }`
  - `pmosDoEspelho(espelho: OpEspelho[]): PmoDoEspelho[]`, `rotuloPmo(p: PmoDoEspelho): string`, `opsDaPmo(espelho: OpEspelho[], pmo: string): OpEspelho[]`, `ultimaLeitura(espelho: OpEspelho[]): string | null`
  - `trechosDoEspelho(opPmo: OpEspelho, espelho: OpEspelho[]): TrechoCadastro[]`, `trechoManual(pmo: string): TrechoCadastro`
  - `rotuloTrecho(t: { codigo: string; compelsOp: string | null }): string`
  - `fixarAlmoxarifado(trechos: TrechoCadastro[], almoxarifado: string | null): TrechoCadastro[]`
  - `distribuirPostos(trechos: TrechoCadastro[], anteriores: PostoAnterior[], almoxarifado: string | null): TrechoCadastro[]`
  - `moverPostoEntreTrechos(trechos: TrechoCadastro[], seq: number, posto: string, delta: -1 | 1, almoxarifado: string | null): TrechoCadastro[]`
  - `validarCadastro(c: CadastroOp): { ok: true } | { ok: false; erro: string }`

- [ ] **Step 1: Escrever os testes `src/modules/shopfloor/domain/__tests__/cadastro-op.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import {
  distribuirPostos, fixarAlmoxarifado, moverPostoEntreTrechos, opsDaPmo, pmosDoEspelho, rotuloPmo, rotuloTrecho,
  trechoManual, trechosDoEspelho, ultimaLeitura, validarCadastro, type CadastroOp, type OpEspelho, type TrechoCadastro,
} from '../cadastro-op'

const op = (numero: number, codigo: string, nivel: number, mae: number | null, extra: Partial<OpEspelho> = {}): OpEspelho => ({
  numero, idCompels: numero, codigo, descricao: `${codigo} desc`, situacao: 'Em Processo', nivel, quantidade: 10,
  quantidadeProduzida: 0, maeNumero: mae, principalNumero: mae === null ? null : 8498, cliente: 'C01',
  dataDocumento: '2026-11-10', ativa: true, lidoEm: '2026-11-18T13:00:00Z', ...extra,
})
const ESPELHO = [
  op(8498, 'PMOC14', 1, null), op(8499, 'PRT420', 2, 8498), op(8500, 'PRT410', 3, 8499),
  op(8510, 'PMOC14', 1, null, { lidoEm: '2026-11-18T13:10:00Z' }), op(8600, 'PMOF52', 2, 8599), op(8601, 'PRT706', 3, 8600),
  op(8700, 'PMOX', 1, null, { ativa: false }),
]

describe('espelho → PMOs e OPs', () => {
  it('só PMOs ativas, com quantas OPs abertas', () => {
    expect(pmosDoEspelho(ESPELHO)).toEqual([
      { pmo: 'PMOC14', descricao: 'PMOC14 desc', abertas: 2 }, { pmo: 'PMOF52', descricao: 'PMOF52 desc', abertas: 1 },
    ])
    expect(rotuloPmo({ pmo: 'PMOC14', descricao: 'PLACA X', abertas: 2 })).toBe('PMOC14 — PLACA X · 2 OPs abertas')
    expect(rotuloPmo({ pmo: 'PMOF52', descricao: 'FONTE', abertas: 1 })).toBe('PMOF52 — FONTE · 1 OP aberta')
  })
  it('OPs abertas da PMO, da mais nova para a mais velha; hora da última leitura', () => {
    expect(opsDaPmo(ESPELHO, 'PMOC14').map((o) => o.numero)).toEqual([8510, 8498])
    expect(ultimaLeitura(ESPELHO)).toBe('2026-11-18T13:10:00Z')
    expect(ultimaLeitura([])).toBeNull()
  })
})

describe('trechos', () => {
  it('as filhas pela cadeia de mães, da mais funda para cima, e a PMO por último', () => {
    const t = trechosDoEspelho(ESPELHO[0]!, ESPELHO)
    expect(t.map((x) => [x.seq, x.codigo, x.tipo, x.compelsOp])).toEqual([[1, 'PRT410', 'prt', '8500'], [2, 'PRT420', 'prt', '8499'], [3, 'PMOC14', 'pmo', '8498']])
    expect(t[2]!.faixas).toEqual([{ sn_ini: '', sn_fim: '' }])
    expect(t[0]!.faixas).toEqual([])
    expect(t.map(rotuloTrecho)).toEqual(['PRT410 (8500)', 'PRT420 (8499)', 'PMOC14 (8498)'])
  })
  it('PMO sem filhas = um trecho só; manual = um trecho sem OP do Compels', () => {
    expect(trechosDoEspelho(ESPELHO[3]!, ESPELHO).map((x) => x.codigo)).toEqual(['PMOC14'])
    expect(trechoManual('PMOZ')).toMatchObject({ seq: 1, codigo: 'PMOZ', tipo: 'pmo', compelsOp: null, faixas: [{ sn_ini: '', sn_fim: '' }] })
    expect(rotuloTrecho({ codigo: 'PMOZ', compelsOp: null })).toBe('PMOZ')
  })
})

describe('postos', () => {
  const T = trechosDoEspelho(ESPELHO[0]!, ESPELHO)
  it('copia pelo código do trecho; o que não casa (OP antiga) vai para a PMO; Almoxarifado fecha a PMO', () => {
    const r = distribuirPostos(T, [
      { posto: 'SPI', trechoCodigo: 'PRT410' }, { posto: 'Inspeção PTH', trechoCodigo: 'prt420' },
      { posto: 'Almoxarifado', trechoCodigo: null }, { posto: 'Teste', trechoCodigo: null },
    ], 'Almoxarifado')
    expect(r.map((x) => x.postos)).toEqual([['SPI'], ['Inspeção PTH'], ['Teste', 'Almoxarifado']])
  })
  it('Almoxarifado nunca fica numa PRT', () => {
    const t = T.map((x) => (x.seq === 1 ? { ...x, postos: ['SPI', 'Almoxarifado'] } : x))
    expect(fixarAlmoxarifado(t, 'Almoxarifado').map((x) => x.postos)).toEqual([['SPI'], [], ['Almoxarifado']])
  })
  it('mover entre trechos vizinhos preserva a ordem da rota', () => {
    const base = distribuirPostos(T, [{ posto: 'SPI', trechoCodigo: null }, { posto: 'AOI', trechoCodigo: null }, { posto: 'Teste', trechoCodigo: null }], 'Almoxarifado')
    const a = moverPostoEntreTrechos(base, 3, 'SPI', -1, 'Almoxarifado')
    expect(a.map((x) => x.postos)).toEqual([[], ['SPI'], ['AOI', 'Teste', 'Almoxarifado']])
    const b = moverPostoEntreTrechos(a, 2, 'SPI', -1, 'Almoxarifado')
    expect(b.map((x) => x.postos)).toEqual([['SPI'], [], ['AOI', 'Teste', 'Almoxarifado']])
    expect(moverPostoEntreTrechos(b, 1, 'SPI', 1, 'Almoxarifado').map((x) => x.postos)).toEqual([[], ['SPI'], ['AOI', 'Teste', 'Almoxarifado']])
    expect(moverPostoEntreTrechos(b, 1, 'SPI', -1, 'Almoxarifado')).toBe(b) // não há trecho antes do primeiro
    expect(moverPostoEntreTrechos(b, 3, 'Almoxarifado', -1, 'Almoxarifado')).toBe(b) // o Almoxarifado não sai da PMO
  })
})

describe('validarCadastro', () => {
  const trechos = (over: (t: TrechoCadastro) => Partial<TrechoCadastro> = () => ({})): TrechoCadastro[] =>
    distribuirPostos(trechosDoEspelho(ESPELHO[0]!, ESPELHO), [
      { posto: 'SPI', trechoCodigo: 'PRT410' }, { posto: 'Inspeção PTH', trechoCodigo: 'PRT420' }, { posto: 'Teste', trechoCodigo: null },
    ], 'Almoxarifado').map((t) => ({ ...t, ...(t.tipo === 'pmo' ? { faixas: [{ sn_ini: '1001', sn_fim: '1010' }] } : {}), ...over(t) }))
  const cad = (t: TrechoCadastro[], extra: Partial<CadastroOp> = {}): CadastroOp => ({
    modo: 'compels', pmo: 'PMOC14', op: '8498', cliente: 'LINCE', descricao: '', qtd: 10, acp: '', embalagemIndividual: false,
    placasPorPainel: 1, trechos: t, componentes: [], burnin: [], ...extra,
  })
  it('cadastro certo passa', () => { expect(validarCadastro(cad(trechos()))).toEqual({ ok: true }) })
  it('regras de sempre do cabeçalho e das faixas da PMO (validarOrdem)', () => {
    expect(validarCadastro(cad(trechos(), { cliente: '' }))).toEqual({ ok: false, erro: 'Informe o cliente.' })
    expect(validarCadastro(cad(trechos(), { qtd: 9 }))).toMatchObject({ ok: false, erro: expect.stringContaining('A quantidade (9) não bate') })
  })
  it('trecho sem posto', () => {
    expect(validarCadastro(cad(trechos((t) => (t.seq === 2 ? { postos: [] } : {}))))).toEqual({ ok: false, erro: 'O trecho PRT420 (8499) está sem posto.' })
  })
  it('posto repetido entre trechos', () => {
    expect(validarCadastro(cad(trechos((t) => (t.seq === 2 ? { postos: ['SPI'] } : {}))))).toEqual({ ok: false, erro: 'O posto "SPI" está em dois trechos: PRT410 (8500) e PRT420 (8499).' })
  })
  it('série própria: faixa obrigatória, coerente e sem sobrepor outra da OP', () => {
    expect(validarCadastro(cad(trechos((t) => (t.seq === 1 ? { snModo: 'proprio', faixas: [] } : {}))))).toEqual({ ok: false, erro: 'PRT410 (8500): preencha a faixa da série própria.' })
    expect(validarCadastro(cad(trechos((t) => (t.seq === 1 ? { snModo: 'proprio', faixas: [{ sn_ini: 'A10', sn_fim: 'A1' }] } : {}))))).toMatchObject({ ok: false, erro: expect.stringContaining('PRT410 (8500): faixa 1 inválida') })
    expect(validarCadastro(cad(trechos((t) => (t.seq === 1 ? { snModo: 'proprio', faixas: [{ sn_ini: '1005', sn_fim: '1020' }] } : {}))))).toEqual({ ok: false, erro: 'A faixa 1 de PRT410 (8500) se sobrepõe à faixa 1 de PMOC14 (8498).' })
    expect(validarCadastro(cad(trechos((t) => (t.seq === 1 ? { snModo: 'proprio', faixas: [{ sn_ini: 'A001', sn_fim: 'A010' }] } : {}))))).toEqual({ ok: true })
  })
  it('PRT com "mesma série" ignora faixa digitada', () => {
    expect(validarCadastro(cad(trechos((t) => (t.seq === 1 ? { faixas: [{ sn_ini: 'x', sn_fim: '' }] } : {}))))).toEqual({ ok: true })
  })
  it('a PMO tem que ser o último trecho', () => {
    const t = trechos()
    expect(validarCadastro(cad([t[2]!, t[0]!, t[1]!]))).toEqual({ ok: false, erro: 'A OP da PMO tem que ser o último trecho.' })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine" && npx vitest run --maxWorkers=2 src/modules/shopfloor/domain/__tests__/cadastro-op.test.ts`
Expected: FAIL (`Cannot find module '../cadastro-op'`).

- [ ] **Step 3: Implementar `src/modules/shopfloor/domain/cadastro-op.ts`**

```ts
/**
 * CADASTRO DE OP INTEGRADO AO COMPELS (spec 2026-11-18). A OP do ShopFloor é a cadeia de OPs do Compels: as PRTs
 * (filhas) e a PMO, cada uma um TRECHO dono de um pedaço dos postos da rota; a PMO é sempre o último. Regras puras
 * (sem banco nem Compels) usadas pela tela Nova OP e conferidas de novo pela action.
 */
import type { OpEspelho } from '@/modules/compels/domain/espelho-ops'
import { faixasSobrepoem, type FaixaSN } from './faixas-sn'
import { faixaCoerente } from './serie'
import { validarOrdem } from './validar-ordem'
import { rotaPadraoOpNova } from './rota-op-nova'

export type { OpEspelho }
export type SnModo = 'mesmo' | 'proprio'
export type TipoTrecho = 'prt' | 'pmo'

export interface TrechoCadastro {
  seq: number
  codigo: string
  tipo: TipoTrecho
  /** Número da OP no Compels; null = cadastro manual. */
  compelsOp: string | null
  descricao: string
  quantidade: number | null
  situacao: string
  /** Só vale nas PRTs; a PMO é sempre 'mesmo'. */
  snModo: SnModo
  postos: string[]
  /** PMO: as faixas da OP. PRT: só com série própria (com 'mesmo' é ignorada). */
  faixas: FaixaSN[]
}

export interface PostoAnterior { posto: string; trechoCodigo: string | null }

export interface UltimaOp {
  op: string
  cliente: string
  descricao: string
  placasPorPainel: number
  embalagemIndividual: boolean
  postos: PostoAnterior[]
  componentes: { posto: string; pmo: string }[]
  burnin: { posto: string; tempo_min: number }[]
}

export interface CadastroOp {
  modo: 'compels' | 'manual'
  pmo: string
  op: string
  cliente: string
  descricao: string
  qtd: number | null
  acp: string
  embalagemIndividual: boolean
  placasPorPainel: number
  trechos: TrechoCadastro[]
  componentes: { posto: string; pmo: string }[]
  burnin: { posto: string; tempo_min: number }[]
}

export interface PmoDoEspelho { pmo: string; descricao: string; abertas: number }

const norm = (s: string) => s.trim().toUpperCase()
const FAIXA_VAZIA: FaixaSN = { sn_ini: '', sn_fim: '' }

/** As PMOs com OP ativa no espelho (só códigos PMO…; as PRTs entram como trechos). */
export function pmosDoEspelho(espelho: OpEspelho[]): PmoDoEspelho[] {
  const m = new Map<string, PmoDoEspelho>()
  for (const o of espelho) {
    if (!o.ativa || !/^PMO/i.test(o.codigo)) continue
    const atual = m.get(o.codigo) ?? { pmo: o.codigo, descricao: o.descricao, abertas: 0 }
    atual.abertas++
    m.set(o.codigo, atual)
  }
  return [...m.values()].sort((a, b) => a.pmo.localeCompare(b.pmo))
}

export function rotuloPmo(p: PmoDoEspelho): string {
  return `${p.pmo} — ${p.descricao} · ${p.abertas} ${p.abertas === 1 ? 'OP aberta' : 'OPs abertas'}`
}

/** As OPs ativas da PMO, da mais nova para a mais velha. */
export function opsDaPmo(espelho: OpEspelho[], pmo: string): OpEspelho[] {
  return espelho.filter((o) => o.ativa && o.codigo === pmo).sort((a, b) => b.numero - a.numero)
}

/** Hora da última leitura do Compels (a mais recente do espelho). */
export function ultimaLeitura(espelho: OpEspelho[]): string | null {
  return espelho.reduce<string | null>((max, o) => (max === null || o.lidoEm > max ? o.lidoEm : max), null)
}

function trechoDe(o: OpEspelho, seq: number, tipo: TipoTrecho): TrechoCadastro {
  return {
    seq, codigo: o.codigo, tipo, compelsOp: String(o.numero), descricao: o.descricao, quantidade: o.quantidade,
    situacao: o.situacao, snModo: 'mesmo', postos: [], faixas: tipo === 'pmo' ? [{ ...FAIXA_VAZIA }] : [],
  }
}

/** Os trechos da OP: as descendentes pela cadeia de mães (a mais funda primeiro) e a PMO por último. */
export function trechosDoEspelho(opPmo: OpEspelho, espelho: OpEspelho[]): TrechoCadastro[] {
  const porNumero = new Map(espelho.map((o) => [o.numero, o]))
  const desce = (o: OpEspelho): boolean => {
    let atual: OpEspelho | undefined = o
    for (let i = 0; i < 20 && atual; i++) {
      if (atual.maeNumero === opPmo.numero) return true
      atual = atual.maeNumero === null ? undefined : porNumero.get(atual.maeNumero)
    }
    return false
  }
  const filhas = espelho
    .filter((o) => o.numero !== opPmo.numero && desce(o))
    .sort((a, b) => b.nivel - a.nivel || a.numero - b.numero)
  return [...filhas.map((o, i) => trechoDe(o, i + 1, 'prt')), trechoDe(opPmo, filhas.length + 1, 'pmo')]
}

/** PMO fora do Compels: um trecho só (a PMO). */
export function trechoManual(pmo: string): TrechoCadastro {
  return {
    seq: 1, codigo: pmo.trim(), tipo: 'pmo', compelsOp: null, descricao: '', quantidade: null, situacao: '',
    snModo: 'mesmo', postos: [], faixas: [{ ...FAIXA_VAZIA }],
  }
}

export function rotuloTrecho(t: { codigo: string; compelsOp: string | null }): string {
  return t.compelsOp ? `${t.codigo} (${t.compelsOp})` : t.codigo
}

/** O Almoxarifado fecha a rota: fica por último no trecho da PMO e nunca numa PRT. */
export function fixarAlmoxarifado(trechos: TrechoCadastro[], almoxarifado: string | null): TrechoCadastro[] {
  if (!almoxarifado) return trechos
  return trechos.map((t) => (t.tipo === 'pmo'
    ? { ...t, postos: rotaPadraoOpNova(t.postos, almoxarifado) }
    : { ...t, postos: t.postos.filter((p) => p !== almoxarifado) }))
}

/** Postos da última OP da PMO: cada um no trecho de mesmo código; o resto (ou OP antiga) no trecho da PMO. */
export function distribuirPostos(trechos: TrechoCadastro[], anteriores: PostoAnterior[], almoxarifado: string | null): TrechoCadastro[] {
  const pmo = trechos.find((t) => t.tipo === 'pmo')
  if (!pmo) return trechos
  const destino = (p: PostoAnterior): number => {
    if (p.trechoCodigo === null) return pmo.seq
    const codigo = norm(p.trechoCodigo)
    return trechos.find((t) => t.tipo === 'prt' && norm(t.codigo) === codigo)?.seq ?? pmo.seq
  }
  const por = new Map(trechos.map((t) => [t.seq, [] as string[]]))
  const vistos = new Set<string>()
  for (const p of anteriores) {
    if (vistos.has(p.posto)) continue
    vistos.add(p.posto)
    por.get(destino(p))!.push(p.posto)
  }
  return fixarAlmoxarifado(trechos.map((t) => ({ ...t, postos: por.get(t.seq)! })), almoxarifado)
}

/**
 * Empurra um posto da ponta de um trecho para o vizinho: para trás (-1) vai para o FIM do anterior; para a
 * frente (+1) vai para o COMEÇO do seguinte. A ordem da rota não muda. Sem vizinho, ou o Almoxarifado: igual.
 */
export function moverPostoEntreTrechos(
  trechos: TrechoCadastro[], seq: number, posto: string, delta: -1 | 1, almoxarifado: string | null,
): TrechoCadastro[] {
  const i = trechos.findIndex((t) => t.seq === seq)
  const j = i + delta
  if (i < 0 || j < 0 || j >= trechos.length || posto === almoxarifado || !trechos[i]!.postos.includes(posto)) return trechos
  return trechos.map((t, k) => {
    if (k === i) return { ...t, postos: t.postos.filter((p) => p !== posto) }
    if (k === j) return { ...t, postos: delta === -1 ? [...t.postos, posto] : [posto, ...t.postos] }
    return t
  })
}

/** Todas as regras da tela (a action confere de novo). Mensagens em PT-BR, a primeira que falhar. */
export function validarCadastro(c: CadastroOp): { ok: true } | { ok: false; erro: string } {
  const ultimo = c.trechos.at(-1)
  if (!ultimo || ultimo.tipo !== 'pmo' || c.trechos.filter((t) => t.tipo === 'pmo').length !== 1) {
    return { ok: false, erro: 'A OP da PMO tem que ser o último trecho.' }
  }
  const v = validarOrdem({
    pmo: c.pmo, op: c.op, cliente: c.cliente, snIni: '', snFim: '', qtd: c.qtd,
    placasPorPainel: c.placasPorPainel, faixas: ultimo.faixas,
  })
  if (!v.ok) return v
  const dono = new Map<string, TrechoCadastro>()
  for (const t of c.trechos) {
    if (t.postos.length === 0) return { ok: false, erro: `O trecho ${rotuloTrecho(t)} está sem posto.` }
    for (const p of t.postos) {
      const outro = dono.get(p)
      if (outro) return { ok: false, erro: `O posto "${p}" está em dois trechos: ${rotuloTrecho(outro)} e ${rotuloTrecho(t)}.` }
      dono.set(p, t)
    }
  }
  const todas: { trecho: TrechoCadastro; i: number; f: FaixaSN }[] = ultimo.faixas.map((f, i) => ({ trecho: ultimo, i, f }))
  for (const t of c.trechos) {
    if (t.tipo !== 'prt' || t.snModo !== 'proprio') continue
    if (t.faixas.length === 0) return { ok: false, erro: `${rotuloTrecho(t)}: preencha a faixa da série própria.` }
    for (let i = 0; i < t.faixas.length; i++) {
      const f = t.faixas[i]!
      if (f.sn_ini.trim() === '' || f.sn_fim.trim() === '' || !faixaCoerente(f.sn_ini, f.sn_fim)) {
        return { ok: false, erro: `${rotuloTrecho(t)}: faixa ${i + 1} inválida — início e fim devem ter o mesmo formato, e o início não pode ser maior que o fim.` }
      }
      const choque = todas.find((x) => faixasSobrepoem(x.f, f))
      if (choque) {
        return { ok: false, erro: `A faixa ${i + 1} de ${rotuloTrecho(t)} se sobrepõe à faixa ${choque.i + 1} de ${rotuloTrecho(choque.trecho)}.` }
      }
      todas.push({ trecho: t, i, f })
    }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine" && npx vitest run --maxWorkers=2 src/modules/shopfloor/domain/__tests__/cadastro-op.test.ts && npx tsc --noEmit -p .`
Expected: PASS; sem erro de tipo.

- [ ] **Step 5: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine"
git add src/modules/shopfloor/domain/cadastro-op.ts src/modules/shopfloor/domain/__tests__/cadastro-op.test.ts
git commit -m "feat(ordens): regras do cadastro de OP por trechos (espelho do Compels, postos, faixas por trecho)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: sai a receita por PMO; a edição de OP preserva os trechos

**Files:**
- Delete: `src/modules/shopfloor/domain/estrutura.ts`, `src/modules/shopfloor/domain/__tests__/estrutura.test.ts`, `src/modules/shopfloor/application/aplicar-estrutura.ts`, `src/modules/shopfloor/application/__tests__/aplicar-estrutura.test.ts`, `src/modules/shopfloor/application/__tests__/estrutura-actions.test.ts`, `src/app/(app)/shopfloor/estruturas/` (pasta inteira), `src/app/(app)/shopfloor/ordens/__tests__/estrutura-aviso-form.test.tsx`, `src/modules/shopfloor/application/__tests__/ordens-actions-estrutura.test.ts`
- Modify: `src/modules/shopfloor/application/estrutura-actions.ts`, `src/modules/shopfloor/infra/estrutura-repository.ts`, `src/shared/ui/app-shell.tsx`, `src/app/(app)/shopfloor/ordens/page.tsx`, `src/app/(app)/shopfloor/ordens/ordens-lista.tsx`, `src/app/(app)/shopfloor/ordens/ordem-form.tsx`, `src/modules/shopfloor/application/ordens-actions.ts`, `src/modules/shopfloor/infra/ordem-repository.ts`, `src/modules/shopfloor/domain/faixas-sn.ts`, `src/modules/shopfloor/domain/__tests__/faixas-sn.test.ts`
- Create: `src/modules/shopfloor/application/__tests__/ordens-actions-trechos.test.ts`, `src/modules/shopfloor/application/__tests__/estrutura-actions.test.ts` (novo conteúdo)

**Interfaces:**
- Consumes: `sf_ordem_regravar_postos`, `sf_ordem_regravar_faixas`, `sf_ordem_trechos.tipo`, `trecho_seq` (Tasks 1–2).
- Produces:
  - `faixasDaPmoDoBanco(rows: { seq: number; sn_ini: string; sn_fim: string; trecho_seq?: number | null }[] | null | undefined, trechos: { seq: number; tipo: string }[] | null | undefined): FaixaSN[]` (em `domain/faixas-sn`)
  - `estrutura-repository.ts` passa a exportar só: `ordemTemTrechos(ordemId: string): Promise<boolean>`, `interface ResumoTrecho`, `resumoTrechosDaOp(pmo: string, op: string): Promise<ResumoTrecho[]>` (os três sem mudança) — `listarTrechosDaOp` entra na Task 8.
  - `estrutura-actions.ts` passa a exportar só `lerTrechosCompelsAction` (sem mudança).
  - Edição: `editarOrdemAction` recusa com `'Esta OP tem trechos do Compels: não é possível trocar a PMO nem o número da OP.'` e traduz `TRECHO_SEM_POSTO:<codigo>` para `'O trecho <codigo> ficaria sem posto.'`.
  - O botão "Nova OP" da lista vira link para `/shopfloor/ordens/nova` (a página é da Task 7).

- [ ] **Step 1: Testes novos**

`src/modules/shopfloor/application/__tests__/ordens-actions-trechos.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

type Base = { pmo: string; op: string; status: string; placas_por_painel: number; sn_ini: string; sn_fim: string; faixas: { sn_ini: string; sn_fim: string }[] }
const m = vi.hoisted(() => ({
  atualizarOrdem: vi.fn<(...a: unknown[]) => Promise<undefined>>(async () => undefined),
  buscarOrdemBase: vi.fn<(id: string) => Promise<Base | null>>(async () => null),
  ordemTemTrechos: vi.fn<(id: string) => Promise<boolean>>(async () => true),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao: vi.fn(async () => ({ perfil: {} })) }))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: vi.fn(() => true) }))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog: vi.fn(async () => undefined) }))
vi.mock('../../infra/postos-repository', () => ({ mapaPostoPerfil: vi.fn(async () => ({})) }))
vi.mock('../../infra/ordem-repository', () => ({
  criarOrdem: vi.fn(async () => 'id-novo'),
  atualizarOrdem: m.atualizarOrdem,
  excluirOrdem: vi.fn(),
  contarRegistros: vi.fn(async () => 0),
  buscarOrdemBase: m.buscarOrdemBase,
  buscarOpEmUso: vi.fn(async () => null),
  listarPostos: vi.fn(async () => []),
  listarRotaGravada: vi.fn(async () => []),
  contarSnsForaDasFaixas: vi.fn(async () => 0),
}))
vi.mock('../../infra/estrutura-repository', () => ({ ordemTemTrechos: m.ordemTemTrechos }))

import { editarOrdemAction } from '../ordens-actions'

function formulario(pmo: string, op: string): FormData {
  const fd = new FormData()
  fd.set('id', 'id-1'); fd.set('pmo', pmo); fd.set('op', op); fd.set('cliente', 'Cliente'); fd.set('qtd', '10')
  fd.set('status', 'ATIVA'); fd.set('sn_ini', 'SN0001'); fd.set('sn_fim', 'SN0010'); fd.set('placas_por_painel', '1')
  return fd
}
const BASE: Base = { pmo: 'PMOC14', op: '8498', status: 'ATIVA', placas_por_painel: 1, sn_ini: 'SN0001', sn_fim: 'SN0010', faixas: [{ sn_ini: 'SN0001', sn_fim: 'SN0010' }] }
const RECUSA = 'Esta OP tem trechos do Compels: não é possível trocar a PMO nem o número da OP.'

beforeEach(() => { vi.clearAllMocks(); m.buscarOrdemBase.mockResolvedValue(BASE); m.ordemTemTrechos.mockResolvedValue(true) })

describe('edição de OP com trechos', () => {
  it('recusa trocar a PMO', async () => {
    expect(await editarOrdemAction(undefined, formulario('PMOX', '8498'))).toEqual({ ok: false, erro: RECUSA })
    expect(m.atualizarOrdem).not.toHaveBeenCalled()
  })
  it('recusa trocar o número da OP', async () => {
    expect(await editarOrdemAction(undefined, formulario('PMOC14', '8498_F'))).toEqual({ ok: false, erro: RECUSA })
  })
  it('sem trocar PMO/OP salva', async () => {
    expect(await editarOrdemAction(undefined, formulario('PMOC14', '8498'))).toMatchObject({ ok: true })
    expect(m.atualizarOrdem).toHaveBeenCalledTimes(1)
  })
  it('OP sem trechos pode trocar o número', async () => {
    m.ordemTemTrechos.mockResolvedValue(false)
    expect(await editarOrdemAction(undefined, formulario('PMOC14', '8499'))).toMatchObject({ ok: true })
  })
  it('trecho que ficaria sem posto vira mensagem', async () => {
    m.atualizarOrdem.mockRejectedValueOnce({ message: 'TRECHO_SEM_POSTO:PRT410' })
    expect(await editarOrdemAction(undefined, formulario('PMOC14', '8498'))).toEqual({ ok: false, erro: 'O trecho PRT410 ficaria sem posto.' })
  })
})
```

`src/modules/shopfloor/application/__tests__/estrutura-actions.test.ts` (substitui o antigo):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const repo = vi.hoisted(() => ({ resumoTrechosDaOp: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao: vi.fn(async () => ({ perfil: 'admin' })) }))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: vi.fn(() => true) }))
vi.mock('../../infra/estrutura-repository', () => repo)

import { lerTrechosCompelsAction } from '../estrutura-actions'
import { podeNoModulo } from '@/modules/auth/domain/perfil'

beforeEach(() => vi.clearAllMocks())

describe('lerTrechosCompelsAction', () => {
  it('devolve o resumo dos trechos', async () => {
    repo.resumoTrechosDaOp.mockResolvedValue([{ posto: 'Inspeção PTH', codigo: 'PRT420', compelsOp: '8499', apontadas: 1, naFila: 0, motivo: null }])
    expect(await lerTrechosCompelsAction('PMOC14', '8498')).toHaveLength(1)
  })
  it('sem permissão ou erro = vazio', async () => {
    vi.mocked(podeNoModulo).mockReturnValueOnce(false)
    expect(await lerTrechosCompelsAction('PMOC14', '8498')).toEqual([])
    repo.resumoTrechosDaOp.mockRejectedValueOnce(new Error('x'))
    expect(await lerTrechosCompelsAction('PMOC14', '8498')).toEqual([])
  })
})
```

Acrescentar em `src/modules/shopfloor/domain/__tests__/faixas-sn.test.ts` (import `faixasDaPmoDoBanco` junto dos outros):

```ts
describe('faixasDaPmoDoBanco', () => {
  const rows = [
    { seq: 2, sn_ini: 'A1', sn_fim: 'A9', trecho_seq: 1 },
    { seq: 1, sn_ini: '100', sn_fim: '199', trecho_seq: 3 },
  ]
  it('só as faixas do trecho da PMO (as próprias das PRTs ficam de fora)', () => {
    expect(faixasDaPmoDoBanco(rows, [{ seq: 1, tipo: 'prt' }, { seq: 3, tipo: 'pmo' }])).toEqual([{ sn_ini: '100', sn_fim: '199' }])
  })
  it('OP antiga (sem trecho): todas', () => {
    expect(faixasDaPmoDoBanco([{ seq: 1, sn_ini: '1', sn_fim: '5', trecho_seq: null }], [])).toEqual([{ sn_ini: '1', sn_fim: '5' }])
  })
})
```

- [ ] **Step 2: Apagar o que sai e rodar os testes para ver falhar**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine"
git rm -r -q "src/app/(app)/shopfloor/estruturas" src/modules/shopfloor/domain/estrutura.ts src/modules/shopfloor/domain/__tests__/estrutura.test.ts src/modules/shopfloor/application/aplicar-estrutura.ts src/modules/shopfloor/application/__tests__/aplicar-estrutura.test.ts "src/app/(app)/shopfloor/ordens/__tests__/estrutura-aviso-form.test.tsx" src/modules/shopfloor/application/__tests__/ordens-actions-estrutura.test.ts
npx vitest run --maxWorkers=2 src/modules/shopfloor/application/__tests__/ordens-actions-trechos.test.ts src/modules/shopfloor/domain/__tests__/faixas-sn.test.ts
```

Expected: FAIL (`ordens-actions.ts` ainda importa `./aplicar-estrutura`; `faixasDaPmoDoBanco` não existe).

- [ ] **Step 3: Enxugar `estrutura-actions.ts` e `estrutura-repository.ts`**

`src/modules/shopfloor/application/estrutura-actions.ts` passa a ser:

```ts
'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { resumoTrechosDaOp, type ResumoTrecho } from '../infra/estrutura-repository'

/** Resumo por trecho (PRT) da OP para o card do Fluxo. Sem sessão ou sem permissão de ver, devolve vazio. */
export async function lerTrechosCompelsAction(pmo: string, op: string): Promise<ResumoTrecho[]> {
  const s = await getSessao()
  if (!s || !podeNoModulo(s.perfil, 'shopfloor', 'visualizar')) return []
  try { return await resumoTrechosDaOp(String(pmo ?? ''), String(op ?? '')) } catch { return [] }
}
```

Em `src/modules/shopfloor/infra/estrutura-repository.ts`: apagar `EstruturaView`, `LinhaTrecho`, `paraTrecho`, `listarEstruturas`, `estruturaDaPmo`, `salvarEstrutura`, `marcarAtiva`, `rotaDeReferencia`, `ultimaOpNumericaPorPmo`, `trechosDaOp`, `copiarParaOp`, `limparFilhas`, `gravarFilhas`, o import de `createServiceSupabase` e o de `../domain/estrutura`. Ficam `ordemTemTrechos`, `ResumoTrecho`, `resumoTrechosDaOp`. Trocar o comentário de topo (se houver) por `/** Trechos da OP (0184): leitura para a edição de OP e para o Fluxo. */`.

- [ ] **Step 4: Tirar o menu e o aviso da receita**

`src/shared/ui/app-shell.tsx`: apagar a linha `{ chave: 'op-estruturas', rotulo: 'Estruturas', href: '/shopfloor/estruturas', icone: Network, modulo: 'shopfloor', perm: 'administrar' },` e o `Network,` do import do `lucide-react` (só era usado ali).

`src/app/(app)/shopfloor/ordens/page.tsx`: tirar o import de `listarEstruturas`, tirar `estruturas` do `Promise.all` (fica `const [ordens, postos, padroes, postosPerfil] = await Promise.all([listarOrdens(), listarPostos(), listarPadroes(), mapaPostoPerfil()])`), apagar `situacaoEstruturaPorPmo` e a prop `situacaoEstruturaPorPmo={situacaoEstruturaPorPmo}` do `<OrdensLista>`. As faixas da view passam a ser só as da PMO:

```ts
import { faixasDaPmoDoBanco } from '@/modules/shopfloor/domain/faixas-sn'
// …
    faixas: faixasDaPmoDoBanco(o.sf_ordem_faixas, o.sf_ordem_trechos),
```

(e o import de `faixasDoBanco` sai).

`src/app/(app)/shopfloor/ordens/ordens-lista.tsx`: tirar a prop `situacaoEstruturaPorPmo` (tipo e desestruturação) e trocar o `<OrdemForm …/>` do topo (o de criar) por um link:

```tsx
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
// …
      <div className="flex justify-end">
        <Link href="/shopfloor/ordens/nova" className={buttonVariants({ className: 'bg-enterplak hover:bg-enterplak-700' })}>
          <Plus className="size-4" /> Nova OP
        </Link>
      </div>
```

(Conferir em `src/components/ui/button.tsx` que `buttonVariants` é exportado; se não for, usar `<Button render={<Link href="/shopfloor/ordens/nova" />} className="bg-enterplak hover:bg-enterplak-700"><Plus className="size-4" /> Nova OP</Button>`, o mesmo padrão `render` do `DialogTrigger` do `ordem-form.tsx`.) As props `pmosExistentes`, `clientesExistentes` e `dadosPorPmo` continuam indo para o `OrdemForm` de editar.

`src/app/(app)/shopfloor/ordens/ordem-form.tsx`: apagar a prop `situacaoEstruturaPorPmo` (tipo, default e uso) e o bloco do aviso logo abaixo do campo PMO (o IIFE com `const s = situacaoEstruturaPorPmo[base]` e os três textos "Esta PMO tem estrutura ativa…", "A estrutura desta PMO está em rascunho…", "Esta PMO não tem estrutura…").

- [ ] **Step 5: `faixasDaPmoDoBanco` em `src/modules/shopfloor/domain/faixas-sn.ts`** (logo depois de `faixasDoBanco`)

```ts
/**
 * As faixas da PMO (0184): numa OP com trechos, só as do trecho 'pmo' (as próprias das PRTs ficam de fora — a
 * edição da OP não as mostra nem as regrava); em OP antiga (trecho_seq null), todas.
 */
export function faixasDaPmoDoBanco(
  rows: { seq: number; sn_ini: string; sn_fim: string; trecho_seq?: number | null }[] | null | undefined,
  trechos: { seq: number; tipo: string }[] | null | undefined,
): FaixaSN[] {
  const pmoSeq = (trechos ?? []).find((t) => t.tipo === 'pmo')?.seq ?? null
  return faixasDoBanco((rows ?? []).filter((r) => r.trecho_seq == null || r.trecho_seq === pmoSeq))
}
```

- [ ] **Step 6: `ordem-repository.ts` — leitura com trechos e edição pelas funções**

Em `OrdemRow`: `sf_ordem_faixas?: { seq: number; sn_ini: string; sn_fim: string; trecho_seq?: number | null }[] | null` e acrescentar `sf_ordem_trechos?: { seq: number; tipo: string }[] | null`. No `select` de `listarOrdens`, trocar `sf_ordem_faixas(seq,sn_ini,sn_fim)` por `sf_ordem_faixas(seq,sn_ini,sn_fim,trecho_seq),sf_ordem_trechos(seq,tipo)`.

Em `buscarOrdemBase`: `select('pmo,op,status,placas_por_painel,sn_ini,sn_fim,sf_ordem_faixas(seq,sn_ini,sn_fim,trecho_seq),sf_ordem_trechos(seq,tipo)')`, o tipo do `r` ganha `sf_ordem_trechos?: { seq: number; tipo: string }[] | null`, e `faixas: faixasDaPmoDoBanco(r.sf_ordem_faixas, r.sf_ordem_trechos)` (import de `faixasDaPmoDoBanco`).

Em `atualizarOrdem`, trocar o trecho que apaga e reinsere `sf_ordem_postos` por:

```ts
  // A rota pela sf_ordem_regravar_postos (0184): mantém o trecho de cada posto e recalcula o posto que conclui.
  const { error: ePostos } = await supabase.rpc('sf_ordem_regravar_postos', { p_ordem_id: id, p_postos: postos })
  if (ePostos) throw ePostos
```

e a última linha (`await gravarFaixas(supabase, id, faixas)`) por:

```ts
  // Só as faixas da PMO: as próprias das PRTs ficam (sf_ordem_regravar_faixas, 0184).
  const { error: eFaixas } = await supabase.rpc('sf_ordem_regravar_faixas', { p_ordem_id: id, p_faixas: faixas })
  if (eFaixas) throw eFaixas
```

(`gravarFaixas` continua sendo usado por `criarOrdem`.)

- [ ] **Step 7: `ordens-actions.ts`**

- Apagar `import { aplicarEstruturaNaOp } from './aplicar-estrutura'`.
- Em `criarOrdemAction`: apagar `const avisoEstrutura = …` e voltar o retorno para `return { ok: true, id, pmo: dados.pmo, op: dados.op }`.
- Em `editarOrdemAction`, trocar o bloco da trava da estrutura por:

```ts
  // Trava dos trechos (0184): o compels_op de cada trecho veio do espelho do Compels para ESTA PMO/OP. Trocar a PMO
  // ou o número deixaria a OP apontando PRTs de outra produção, então a troca é recusada enquanto houver trechos.
  if (dados.pmo !== base.pmo || dados.op !== base.op) {
    try {
      if (await ordemTemTrechos(id)) return { ok: false, erro: 'Esta OP tem trechos do Compels: não é possível trocar a PMO nem o número da OP.' }
    } catch {
      return { ok: false, erro: 'Não foi possível salvar a OP.' }
    }
  }
```

- No `catch` do `atualizarOrdem`, antes de `return { ok: false, erro: 'Não foi possível salvar a OP.' }`:

```ts
    const trecho = /^TRECHO_SEM_POSTO:(.+)$/.exec(String((e as { message?: unknown } | null)?.message ?? ''))
    if (trecho) return { ok: false, erro: `O trecho ${trecho[1]} ficaria sem posto.` }
```

- Apagar `const avisoEstrutura = …` do fim de `editarOrdemAction` e voltar o retorno para `return { ok: true, id, pmo: dados.pmo, op: dados.op }`.

- [ ] **Step 8: Rodar a suíte de ordens/estrutura, tipos e lint**

Run: `cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine" && npx vitest run --maxWorkers=2 src/modules/shopfloor "src/app/(app)/shopfloor/ordens" "src/app/(app)/shopfloor/fluxo" && npx tsc --noEmit -p . && npx eslint src/modules/shopfloor "src/app/(app)/shopfloor/ordens" src/shared/ui/app-shell.tsx`
Expected: PASS (os testes antigos de faixas/placas/almoxarifado/finalização seguem verdes; se algum espiar `supabase.from('sf_ordem_postos')` no `atualizarOrdem`, trocar a expectativa para a chamada `rpc('sf_ordem_regravar_postos', …)`); sem erro de tipo; sem erro de lint. `grep -rn "estruturas\|aplicar-estrutura\|situacaoEstrutura" src` não acha nada.

- [ ] **Step 9: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine"
git add -A src/modules/shopfloor "src/app/(app)/shopfloor/ordens" src/shared/ui/app-shell.tsx   # a pasta estruturas já saiu no git rm do Step 2
git commit -m "refactor(ordens): sai a receita por PMO (tela Estruturas, importação, aviso); a edição de OP preserva os trechos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: actions e repositório do cadastro

**Files:**
- Create: `src/modules/shopfloor/infra/cadastro-op-repository.ts`, `src/modules/shopfloor/infra/__tests__/cadastro-op-repository.test.ts`
- Create: `src/modules/shopfloor/application/cadastro-op-actions.ts`, `src/modules/shopfloor/application/__tests__/cadastro-op-actions.test.ts`

**Interfaces:**
- Consumes: `CadastroOp`, `UltimaOp`, `PostoAnterior`, `trechosDoEspelho`, `fixarAlmoxarifado`, `validarCadastro` (Task 4); `listarEspelho` (Task 3); `listarPostos`, `buscarOpEmUso` (`infra/ordem-repository`); `mapaPostoPerfil`; `postoAlmoxarifadoPadrao`; `mensagemOpDuplicada`; `sf_cadastrar_op`, `sf_ultima_op_da_pmo` (Task 2).
- Produces:
  - `cadastrarOp(c: CadastroOp): Promise<string>` (lança o erro do PostgREST como veio: `{ code, message }`)
  - `ultimaOpDaPmo(pmo: string): Promise<UltimaOp | null>`
  - `type ResultadoCadastro = { ok: true; id: string; pmo: string; op: string } | { ok: false; erro: string }`
  - `cadastrarOpAction(c: CadastroOp): Promise<ResultadoCadastro>`
  - `ultimaOpDaPmoAction(pmo: string): Promise<UltimaOp | null>`

- [ ] **Step 1: Testes**

`src/modules/shopfloor/infra/__tests__/cadastro-op-repository.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => ({ rpc }) }))

import { cadastrarOp, ultimaOpDaPmo } from '../cadastro-op-repository'
import type { CadastroOp } from '../../domain/cadastro-op'

const C: CadastroOp = {
  modo: 'compels', pmo: 'PMOC14', op: '8498', cliente: 'LINCE', descricao: 'PLACA', qtd: 10, acp: '', embalagemIndividual: true, placasPorPainel: 2,
  trechos: [
    { seq: 1, codigo: 'PRT410', tipo: 'prt', compelsOp: '8500', descricao: '', quantidade: 10, situacao: '', snModo: 'proprio', postos: ['SPI'], faixas: [{ sn_ini: 'A1', sn_fim: 'A5' }] },
    { seq: 2, codigo: 'PMOC14', tipo: 'pmo', compelsOp: '8498', descricao: '', quantidade: 10, situacao: '', snModo: 'mesmo', postos: ['Teste', 'Almoxarifado'], faixas: [{ sn_ini: '1', sn_fim: '5' }] },
  ],
  componentes: [{ posto: 'Teste', pmo: 'PMOZ' }], burnin: [{ posto: 'Teste', tempo_min: 360 }],
}

describe('cadastro-op-repository', () => {
  it('cadastrarOp manda o payload da sf_cadastrar_op e devolve o id', async () => {
    rpc.mockResolvedValueOnce({ data: 'uuid-1', error: null })
    expect(await cadastrarOp(C)).toBe('uuid-1')
    expect(rpc).toHaveBeenCalledWith('sf_cadastrar_op', { p: {
      ordem: { pmo: 'PMOC14', op: '8498', cliente: 'LINCE', qtd: 10, descricao: 'PLACA', acp: '', embalagem_individual: true, placas_por_painel: 2 },
      trechos: [
        { seq: 1, codigo: 'PRT410', tipo: 'prt', compels_op: '8500', sn_modo: 'proprio', postos: ['SPI'], faixas: [{ sn_ini: 'A1', sn_fim: 'A5' }] },
        { seq: 2, codigo: 'PMOC14', tipo: 'pmo', compels_op: '8498', sn_modo: 'mesmo', postos: ['Teste', 'Almoxarifado'], faixas: [{ sn_ini: '1', sn_fim: '5' }] },
      ],
      componentes: [{ posto: 'Teste', pmo: 'PMOZ' }], burnin: [{ posto: 'Teste', tempo_min: 360 }],
    } })
  })
  it('erro do banco sobe com code/message', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate' } })
    await expect(cadastrarOp(C)).rejects.toMatchObject({ code: '23505' })
  })
  it('ultimaOpDaPmo converte; sem OP = null', async () => {
    rpc.mockResolvedValueOnce({ data: { op: '8476', cliente: 'LINCE', descricao: 'X', placas_por_painel: 1, embalagem_individual: false,
      postos: [{ posto: 'SPI', trecho_codigo: 'PRT410' }, { posto: 'Teste', trecho_codigo: null }], componentes: [], burnin: [] }, error: null })
    expect(await ultimaOpDaPmo('PMOC14')).toEqual({ op: '8476', cliente: 'LINCE', descricao: 'X', placasPorPainel: 1, embalagemIndividual: false,
      postos: [{ posto: 'SPI', trechoCodigo: 'PRT410' }, { posto: 'Teste', trechoCodigo: null }], componentes: [], burnin: [] })
    expect(rpc).toHaveBeenLastCalledWith('sf_ultima_op_da_pmo', { p_pmo: 'PMOC14' })
    rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await ultimaOpDaPmo('NAO')).toBeNull()
  })
})
```

`src/modules/shopfloor/application/__tests__/cadastro-op-actions.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CadastroOp, OpEspelho } from '../../domain/cadastro-op'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({
  cadastrarOp: vi.fn(async () => 'uuid-1'), ultimaOpDaPmo: vi.fn(), listarEspelho: vi.fn(), buscarOpEmUso: vi.fn(async () => null),
  registrarLog: vi.fn(), podeNoModulo: vi.fn(() => true),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao: vi.fn(async () => ({ perfil: {}, nome: 'Ana', email: 'a@x' })) }))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: m.podeNoModulo }))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog: m.registrarLog }))
vi.mock('../../infra/cadastro-op-repository', () => ({ cadastrarOp: m.cadastrarOp, ultimaOpDaPmo: m.ultimaOpDaPmo }))
vi.mock('../../infra/espelho-ops-repository', () => ({ listarEspelho: m.listarEspelho }))
vi.mock('../../infra/ordem-repository', () => ({
  buscarOpEmUso: m.buscarOpEmUso,
  listarPostos: vi.fn(async () => ['SPI', 'Inspeção AOI TOP', 'Inspeção PTH', 'Teste', 'Burn-in', 'Integração', 'Almoxarifado'].map((chave) => ({ chave }))),
}))
vi.mock('../../infra/postos-repository', () => ({ mapaPostoPerfil: vi.fn(async () => ({
  Almoxarifado: { recurso: 'almoxarifado' }, 'Burn-in': { recurso: 'burnin' }, 'Integração': { recurso: 'integracao' },
})) }))

import { cadastrarOpAction, ultimaOpDaPmoAction } from '../cadastro-op-actions'

const op = (numero: number, codigo: string, nivel: number, mae: number | null): OpEspelho => ({
  numero, idCompels: numero, codigo, descricao: '', situacao: 'Em Processo', nivel, quantidade: 10, quantidadeProduzida: 0,
  maeNumero: mae, principalNumero: null, cliente: '', dataDocumento: null, ativa: true, lidoEm: '2026-11-18T13:00:00Z',
})
const ESPELHO = [op(8498, 'PMOC14', 1, null), op(8500, 'PRT410', 2, 8498)]
const cad = (over: Partial<CadastroOp> = {}): CadastroOp => ({
  modo: 'compels', pmo: 'PMOC14', op: '8498', cliente: 'LINCE', descricao: '', qtd: 10, acp: '', embalagemIndividual: false, placasPorPainel: 1,
  trechos: [
    { seq: 1, codigo: 'PRT410', tipo: 'prt', compelsOp: '8500', descricao: '', quantidade: 10, situacao: '', snModo: 'mesmo', postos: ['SPI', 'Inspeção AOI TOP', 'Almoxarifado', 'Inexistente'], faixas: [] },
    { seq: 2, codigo: 'PMOC14', tipo: 'pmo', compelsOp: '8498', descricao: '', quantidade: 10, situacao: '', snModo: 'mesmo', postos: ['Teste', 'Burn-in'], faixas: [{ sn_ini: '1001', sn_fim: '1010' }] },
  ],
  componentes: [{ posto: 'Teste', pmo: 'PMOZ' }, { posto: 'Integração', pmo: 'PMOW' }],
  burnin: [{ posto: 'Burn-in', tempo_min: 360 }, { posto: 'Teste', tempo_min: 10 }],
  ...over,
})

beforeEach(() => { vi.clearAllMocks(); m.listarEspelho.mockResolvedValue(ESPELHO); m.podeNoModulo.mockReturnValue(true) })

describe('cadastrarOpAction', () => {
  it('limpa os postos (catálogo, Almoxarifado no fim da PMO), filtra componentes/burn-in e grava', async () => {
    expect(await cadastrarOpAction(cad())).toEqual({ ok: true, id: 'uuid-1', pmo: 'PMOC14', op: '8498' })
    const enviado = m.cadastrarOp.mock.calls[0]![0] as CadastroOp
    expect(enviado.trechos.map((t) => t.postos)).toEqual([['SPI', 'Inspeção AOI TOP'], ['Teste', 'Burn-in', 'Almoxarifado']])
    expect(enviado.componentes).toEqual([])
    expect(enviado.burnin).toEqual([{ posto: 'Burn-in', tempo_min: 360 }])
    expect(m.registrarLog).toHaveBeenCalledWith(expect.objectContaining({ entidade: 'sf_ordem', entidadeId: 'uuid-1', acao: 'criar' }))
  })
  it('sem permissão', async () => {
    m.podeNoModulo.mockReturnValue(false)
    expect(await cadastrarOpAction(cad())).toEqual({ ok: false, erro: 'Você não tem permissão para gerenciar ordens de produção.' })
  })
  it('trechos que não batem com o espelho são recusados', async () => {
    m.listarEspelho.mockResolvedValue([op(8498, 'PMOC14', 1, null)])
    expect(await cadastrarOpAction(cad())).toEqual({ ok: false, erro: 'Os trechos não batem com o Compels. Recarregue a página e escolha a OP de novo.' })
    expect(m.cadastrarOp).not.toHaveBeenCalled()
  })
  it('validação do domínio', async () => {
    expect(await cadastrarOpAction(cad({ cliente: '' }))).toEqual({ ok: false, erro: 'Informe o cliente.' })
  })
  it('OP já cadastrada', async () => {
    m.buscarOpEmUso.mockResolvedValueOnce({ id: 'x', pmo: 'PMOC14', op: '8498' } as never)
    expect(await cadastrarOpAction(cad())).toMatchObject({ ok: false, erro: expect.stringContaining('Já existe a OP 8498') })
  })
  it('erros do banco em PT-BR', async () => {
    m.cadastrarOp.mockRejectedValueOnce({ code: '23505', message: 'dup' })
    expect(await cadastrarOpAction(cad())).toEqual({ ok: false, erro: 'Já existe uma OP com esse PMO e número.' })
    m.cadastrarOp.mockRejectedValueOnce({ message: 'POSTO_REPETIDO:Teste' })
    expect(await cadastrarOpAction(cad())).toEqual({ ok: false, erro: 'O posto "Teste" está em mais de um trecho.' })
    m.cadastrarOp.mockRejectedValueOnce(new Error('rede'))
    expect(await cadastrarOpAction(cad())).toEqual({ ok: false, erro: 'Não foi possível criar a OP.' })
  })
  it('modo manual: um trecho só, sem OP do Compels, não consulta o espelho', async () => {
    const manual = cad({ modo: 'manual', pmo: 'PMOZ', op: '9001', trechos: [
      { seq: 1, codigo: 'PMOZ', tipo: 'pmo', compelsOp: null, descricao: '', quantidade: null, situacao: '', snModo: 'mesmo', postos: ['Teste'], faixas: [{ sn_ini: '1001', sn_fim: '1010' }] },
    ] })
    expect(await cadastrarOpAction(manual)).toMatchObject({ ok: true })
    expect(m.listarEspelho).not.toHaveBeenCalled()
    expect(await cadastrarOpAction({ ...manual, trechos: [{ ...manual.trechos[0]!, compelsOp: '9001' }] })).toEqual({ ok: false, erro: 'Cadastro manual tem um trecho só, sem OP do Compels.' })
  })
})

describe('ultimaOpDaPmoAction', () => {
  it('lê a última OP; sem permissão ou erro = null', async () => {
    m.ultimaOpDaPmo.mockResolvedValueOnce({ op: '8476' })
    expect(await ultimaOpDaPmoAction(' PMOC14 ')).toEqual({ op: '8476' })
    expect(m.ultimaOpDaPmo).toHaveBeenCalledWith('PMOC14')
    m.podeNoModulo.mockReturnValue(false)
    expect(await ultimaOpDaPmoAction('PMOC14')).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine" && npx vitest run --maxWorkers=2 src/modules/shopfloor/infra/__tests__/cadastro-op-repository.test.ts src/modules/shopfloor/application/__tests__/cadastro-op-actions.test.ts`
Expected: FAIL (módulos não existem).

- [ ] **Step 3: Implementar `src/modules/shopfloor/infra/cadastro-op-repository.ts`**

```ts
import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { CadastroOp, UltimaOp } from '../domain/cadastro-op'

/** Cria a OP nova numa transação (sf_cadastrar_op, 0184). Erro do banco sobe como veio ({ code, message }). */
export async function cadastrarOp(c: CadastroOp): Promise<string> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('sf_cadastrar_op', { p: {
    ordem: {
      pmo: c.pmo.trim(), op: c.op.trim(), cliente: c.cliente.trim(), qtd: c.qtd, descricao: c.descricao.trim(),
      acp: c.acp.trim(), embalagem_individual: c.embalagemIndividual, placas_por_painel: c.placasPorPainel,
    },
    trechos: c.trechos.map((t) => ({
      seq: t.seq, codigo: t.codigo, tipo: t.tipo, compels_op: t.compelsOp, sn_modo: t.snModo, postos: t.postos,
      faixas: t.faixas.map((f) => ({ sn_ini: f.sn_ini.trim(), sn_fim: f.sn_fim.trim() })),
    })),
    componentes: c.componentes,
    burnin: c.burnin,
  } })
  if (error) throw error
  return data as string
}

interface UltimaOpBanco {
  op: string; cliente: string; descricao: string; placas_por_painel: number; embalagem_individual: boolean
  postos: { posto: string; trecho_codigo: string | null }[]
  componentes: { posto: string; pmo: string }[]
  burnin: { posto: string; tempo_min: number }[]
}

/** A última OP da PMO no ShopFloor (sf_ultima_op_da_pmo, 0184), para a OP nova copiar os postos. */
export async function ultimaOpDaPmo(pmo: string): Promise<UltimaOp | null> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('sf_ultima_op_da_pmo', { p_pmo: pmo })
  if (error) throw new Error(`sf_ultima_op_da_pmo: ${error.message}`)
  if (!data) return null
  const d = data as UltimaOpBanco
  return {
    op: d.op, cliente: d.cliente, descricao: d.descricao, placasPorPainel: d.placas_por_painel,
    embalagemIndividual: d.embalagem_individual,
    postos: d.postos.map((p) => ({ posto: p.posto, trechoCodigo: p.trecho_codigo })),
    componentes: d.componentes, burnin: d.burnin,
  }
}
```

- [ ] **Step 4: Implementar `src/modules/shopfloor/application/cadastro-op-actions.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { fixarAlmoxarifado, trechosDoEspelho, validarCadastro, type CadastroOp, type UltimaOp } from '../domain/cadastro-op'
import { mensagemOpDuplicada } from '../domain/op-unica'
import { postoAlmoxarifadoPadrao } from '../domain/rota-op-nova'
import { cadastrarOp, ultimaOpDaPmo } from '../infra/cadastro-op-repository'
import { listarEspelho } from '../infra/espelho-ops-repository'
import { buscarOpEmUso, listarPostos } from '../infra/ordem-repository'
import { mapaPostoPerfil } from '../infra/postos-repository'

export type ResultadoCadastro = { ok: true; id: string; pmo: string; op: string } | { ok: false; erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para gerenciar ordens de produção.'

async function sessaoAdmin() {
  const s = await getSessao()
  return s && podeNoModulo(s.perfil, 'shopfloor', 'administrar') ? s : null
}

function mensagemDoBanco(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code
  if (code === '23505') return 'Já existe uma OP com esse PMO e número.'
  const msg = String((e as { message?: unknown } | null)?.message ?? '')
  const m = /^(TRECHO_SEM_POSTO|POSTO_REPETIDO|TRECHO_SEM_FAIXA):(.+)$/.exec(msg)
  if (m?.[1] === 'TRECHO_SEM_POSTO') return `O trecho ${m[2]} está sem posto.`
  if (m?.[1] === 'POSTO_REPETIDO') return `O posto "${m[2]}" está em mais de um trecho.`
  if (m?.[1] === 'TRECHO_SEM_FAIXA') return `O trecho ${m[2]} está sem faixa de série.`
  return 'Não foi possível criar a OP.'
}

/**
 * Cria a OP nova (Ordens → Nova OP). Nada do cliente é confiado: postos conferidos no catálogo, Almoxarifado no fim
 * da PMO, componentes/burn-in só nos postos certos e, no modo Compels, os trechos conferidos contra o espelho.
 */
export async function cadastrarOpAction(c: CadastroOp): Promise<ResultadoCadastro> {
  const s = await sessaoAdmin()
  if (!s) return { ok: false, erro: SEM_PERMISSAO }

  const [catalogo, perfis] = await Promise.all([listarPostos(), mapaPostoPerfil()])
  const chaves = new Set(catalogo.map((p) => p.chave))
  const recurso = (p: string): string => perfis[p]?.recurso ?? 'nenhum'
  // o mesmo critério do criarOrdemAction (ordens-actions → postoAlmoxarifado): o perfil decide, não o nome
  const almox = postoAlmoxarifadoPadrao(catalogo.map((p) => p.chave), (p) => perfis[p] ?? { recurso: 'nenhum' })
  const trechos = fixarAlmoxarifado(c.trechos.map((t) => ({
    ...t,
    postos: [...new Set(t.postos.filter((p) => chaves.has(p)))],
    faixas: t.tipo === 'prt' && t.snModo === 'mesmo' ? [] : t.faixas,
  })), almox)

  if (c.modo === 'compels') {
    const pmo = trechos.at(-1)
    let esperado: { codigo: string; compelsOp: string | null }[] = []
    try {
      const espelho = await listarEspelho()
      const opPmo = espelho.find((o) => String(o.numero) === pmo?.compelsOp && o.codigo === c.pmo.trim())
      if (opPmo) esperado = trechosDoEspelho(opPmo, espelho)
    } catch {
      return { ok: false, erro: 'Não foi possível ler o espelho do Compels agora.' }
    }
    const bate = esperado.length === trechos.length &&
      esperado.every((t, i) => t.codigo === trechos[i]!.codigo && t.compelsOp === trechos[i]!.compelsOp)
    if (!bate) return { ok: false, erro: 'Os trechos não batem com o Compels. Recarregue a página e escolha a OP de novo.' }
  } else if (trechos.length !== 1 || trechos[0]!.tipo !== 'pmo' || trechos[0]!.compelsOp !== null) {
    return { ok: false, erro: 'Cadastro manual tem um trecho só, sem OP do Compels.' }
  }

  const rota = new Set(trechos.flatMap((t) => t.postos))
  const limpo: CadastroOp = {
    ...c,
    pmo: c.pmo.trim(),
    op: c.op.trim(),
    trechos,
    componentes: c.componentes.filter((x) => rota.has(x.posto) && recurso(x.posto) === 'integracao'),
    burnin: c.burnin.filter((x) => rota.has(x.posto) && recurso(x.posto) === 'burnin'),
  }
  const v = validarCadastro(limpo)
  if (!v.ok) return v

  const emUso = await buscarOpEmUso(limpo.op)
  if (emUso) return { ok: false, erro: mensagemOpDuplicada(emUso) }

  let id: string
  try {
    id = await cadastrarOp(limpo)
  } catch (e) {
    return { ok: false, erro: mensagemDoBanco(e) }
  }
  await registrarLog({
    entidade: 'sf_ordem', entidadeId: id, acao: 'criar', descricao: `OP ${limpo.pmo}/${limpo.op} criada (${limpo.modo})`,
    dados: { modo: limpo.modo, trechos: limpo.trechos.map((t) => ({ codigo: t.codigo, compelsOp: t.compelsOp, snModo: t.snModo, postos: t.postos, faixas: t.faixas })) },
  })
  revalidatePath('/shopfloor/ordens')
  return { ok: true, id, pmo: limpo.pmo, op: limpo.op }
}

/** Os postos (com o trecho), componentes e burn-in da última OP da PMO. Sem permissão ou erro: null. */
export async function ultimaOpDaPmoAction(pmo: string): Promise<UltimaOp | null> {
  if (!(await sessaoAdmin())) return null
  try { return await ultimaOpDaPmo(String(pmo ?? '').trim()) } catch { return null }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine" && npx vitest run --maxWorkers=2 src/modules/shopfloor/infra/__tests__/cadastro-op-repository.test.ts src/modules/shopfloor/application/__tests__/cadastro-op-actions.test.ts && npx tsc --noEmit -p . && npx eslint src/modules/shopfloor/application/cadastro-op-actions.ts src/modules/shopfloor/infra/cadastro-op-repository.ts`
Expected: PASS; sem erro de tipo/lint.

- [ ] **Step 6: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine"
git add src/modules/shopfloor/application/cadastro-op-actions.ts src/modules/shopfloor/application/__tests__/cadastro-op-actions.test.ts src/modules/shopfloor/infra/cadastro-op-repository.ts src/modules/shopfloor/infra/__tests__/cadastro-op-repository.test.ts
git commit -m "feat(ordens): action do cadastro de OP por trechos (confere o espelho do Compels) e leitura da última OP da PMO

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: tela Ordens → Nova OP

**Files:**
- Create: `src/app/(app)/shopfloor/ordens/nova/page.tsx`, `src/app/(app)/shopfloor/ordens/nova/nova-op-cliente.tsx`, `src/app/(app)/shopfloor/ordens/nova/__tests__/nova-op-cliente.test.tsx`
- Modify: `src/app/(app)/shopfloor/ordens/ordem-form.tsx` (exportar `FaixasSn` com `idBase`)

**Interfaces:**
- Consumes: Task 4 (domínio), Task 6 (`cadastrarOpAction`, `ultimaOpDaPmoAction`), Task 3 (`listarEspelho`), `listarPostos`/`listarOrdens` (`infra/ordem-repository`), `mapaPostoPerfil`, `postoAlmoxarifadoPadrao`, `moverPostoNaRota` (`domain/rota-op-nova`), `PERFIL_PADRAO`.
- Produces:
  - `export function FaixasSn(props: { faixas: FaixaSN[]; setFaixas: (f: FaixaSN[]) => void; qtd: string; nPainel: number; idBase?: string })` em `ordem-form.tsx` (ids viram `${idBase}sn_ini${sufixo}`/`${idBase}sn_fim${sufixo}`; `idBase` padrão `''` — os testes do formulário seguem iguais)
  - `NovaOpCliente(props: { espelho: OpEspelho[]; postos: string[]; postosPerfil: Record<string, PerfilPosto>; clientesExistentes: string[] })`

- [ ] **Step 1: Exportar `FaixasSn` com `idBase` (`ordem-form.tsx`)**

Trocar `function FaixasSn({` por `export function FaixasSn({`, acrescentar `idBase = '',` na desestruturação e `idBase?: string` no tipo, e nos `id`/`htmlFor` dos dois inputs de faixa trocar `` `sn_ini${sufixo}` `` por `` `${idBase}sn_ini${sufixo}` `` e `` `sn_fim${sufixo}` `` por `` `${idBase}sn_fim${sufixo}` `` (os `name` não mudam).

- [ ] **Step 2: Escrever o teste `src/app/(app)/shopfloor/ordens/nova/__tests__/nova-op-cliente.test.tsx`**

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { OpEspelho } from '@/modules/shopfloor/domain/cadastro-op'

vi.mock('server-only', () => ({}))
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const acoes = vi.hoisted(() => ({ cadastrarOpAction: vi.fn(), ultimaOpDaPmoAction: vi.fn() }))
vi.mock('@/modules/shopfloor/application/cadastro-op-actions', () => acoes)
vi.mock('@/modules/shopfloor/application/ordens-actions', () => ({ criarOrdemAction: vi.fn(), editarOrdemAction: vi.fn(), opTemRegistrosAction: vi.fn() }))
vi.mock('@/modules/shopfloor/application/padroes-fluxo-actions', () => ({ salvarPadraoAction: vi.fn(), excluirPadraoAction: vi.fn() }))

const { NovaOpCliente } = await import('../nova-op-cliente')

const op = (numero: number, codigo: string, nivel: number, mae: number | null): OpEspelho => ({
  numero, idCompels: numero, codigo, descricao: codigo === 'PMOC14' ? 'PLACA X' : 'PARTES', situacao: 'Em Processo', nivel,
  quantidade: 10, quantidadeProduzida: 0, maeNumero: mae, principalNumero: null, cliente: 'C01', dataDocumento: '2026-11-10',
  ativa: true, lidoEm: '2026-11-18T13:00:00Z',
})
const ESPELHO = [op(8498, 'PMOC14', 1, null), op(8499, 'PRT420', 2, 8498), op(8500, 'PRT410', 3, 8499)]
const POSTOS = ['SPI', 'Inspeção AOI TOP', 'Inspeção PTH', 'Teste', 'Almoxarifado']
const PERFIS = { Almoxarifado: { recurso: 'almoxarifado' } } as never

const montar = () => render(<NovaOpCliente espelho={ESPELHO} postos={POSTOS} postosPerfil={PERFIS} clientesExistentes={['LINCE']} />)

beforeEach(() => {
  vi.clearAllMocks()
  acoes.ultimaOpDaPmoAction.mockResolvedValue({
    op: '8476', cliente: 'LINCE', descricao: 'PLACA X', placasPorPainel: 1, embalagemIndividual: false,
    postos: [{ posto: 'SPI', trechoCodigo: 'PRT410' }, { posto: 'Inspeção PTH', trechoCodigo: 'PRT420' }, { posto: 'Teste', trechoCodigo: null }, { posto: 'Almoxarifado', trechoCodigo: null }],
    componentes: [], burnin: [],
  })
  acoes.cadastrarOpAction.mockResolvedValue({ ok: true, id: 'u1', pmo: 'PMOC14', op: '8498' })
})

describe('Nova OP', () => {
  it('PMO do espelho → OP → trechos na ordem da rota, com os postos copiados da última OP', async () => {
    montar()
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'pmoc' } })
    fireEvent.click(screen.getByRole('button', { name: 'PMOC14 — PLACA X · 1 OP aberta' }))
    fireEvent.click(await screen.findByRole('button', { name: /^OP 8498/ }))
    await waitFor(() => expect(screen.getByText('Postos copiados da OP 8476 — confira.')).toBeTruthy())
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['PRT410 (8500)', 'PRT420 (8499)', 'PMOC14 (8498)'])
    expect(screen.getByText(/Última leitura do Compels/)).toBeTruthy()
  })

  it('PMO fora do espelho → cadastro manual na mesma tela', () => {
    montar()
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'PMOZZ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Usar PMOZZ (cadastro manual)' }))
    expect(screen.getByText('Não está no Compels — cadastro manual')).toBeTruthy()
    expect(screen.getByLabelText('Nº OP *')).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['PMOZZ'])
  })

  it('salvar manda o cadastro e volta para a lista', async () => {
    montar()
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'PMOC14' } })
    fireEvent.click(screen.getByRole('button', { name: 'PMOC14 — PLACA X · 1 OP aberta' }))
    fireEvent.click(await screen.findByRole('button', { name: /^OP 8498/ }))
    await screen.findByText('Postos copiados da OP 8476 — confira.')
    fireEvent.change(screen.getByLabelText('SN inicial *'), { target: { value: '1001' } })
    fireEvent.change(screen.getByLabelText('SN final *'), { target: { value: '1010' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar OP' }))
    await waitFor(() => expect(acoes.cadastrarOpAction).toHaveBeenCalledTimes(1))
    const enviado = acoes.cadastrarOpAction.mock.calls[0]![0]
    expect(enviado).toMatchObject({ modo: 'compels', pmo: 'PMOC14', op: '8498', cliente: 'LINCE', qtd: 10 })
    expect(enviado.trechos.map((t: { postos: string[] }) => t.postos)).toEqual([['SPI'], ['Inspeção PTH'], ['Teste', 'Almoxarifado']])
    await waitFor(() => expect(push).toHaveBeenCalledWith('/shopfloor/ordens'))
  })

  it('erro de validação aparece sem chamar o servidor', async () => {
    montar()
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'PMOC14' } })
    fireEvent.click(screen.getByRole('button', { name: 'PMOC14 — PLACA X · 1 OP aberta' }))
    fireEvent.click(await screen.findByRole('button', { name: /^OP 8498/ }))
    await screen.findByText('Postos copiados da OP 8476 — confira.')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar OP' }))
    const { toast } = await import('sonner')
    expect(toast.error).toHaveBeenCalledWith('Preencha o início e o fim da faixa de SN.', expect.anything())
    expect(acoes.cadastrarOpAction).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine" && npx vitest run --maxWorkers=2 "src/app/(app)/shopfloor/ordens/nova"`
Expected: FAIL (`Cannot find module '../nova-op-cliente'`).

- [ ] **Step 4: Implementar `src/app/(app)/shopfloor/ordens/nova/nova-op-cliente.tsx`**

```tsx
'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cadastrarOpAction, ultimaOpDaPmoAction } from '@/modules/shopfloor/application/cadastro-op-actions'
import {
  distribuirPostos, fixarAlmoxarifado, moverPostoEntreTrechos, opsDaPmo, pmosDoEspelho, rotuloPmo, rotuloTrecho,
  trechoManual, trechosDoEspelho, ultimaLeitura, validarCadastro,
  type CadastroOp, type OpEspelho, type SnModo, type TrechoCadastro, type UltimaOp,
} from '@/modules/shopfloor/domain/cadastro-op'
import { moverPostoNaRota, postoAlmoxarifadoPadrao } from '@/modules/shopfloor/domain/rota-op-nova'
import { PERFIL_PADRAO, type PerfilPosto } from '@/modules/shopfloor/domain/perfil-posto'
import type { FaixaSN } from '@/modules/shopfloor/domain/faixas-sn'
import { FaixasSn } from '../ordem-form'

const TOAST = { position: 'bottom-center' as const }
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export function NovaOpCliente({ espelho, postos, postosPerfil, clientesExistentes }: {
  espelho: OpEspelho[]
  postos: string[]
  postosPerfil: Record<string, PerfilPosto>
  clientesExistentes: string[]
}) {
  const router = useRouter()
  const [salvando, startSalvar] = useTransition()
  const almox = postoAlmoxarifadoPadrao(postos, (p) => postosPerfil[p] ?? PERFIL_PADRAO)
  const pmos = useMemo(() => pmosDoEspelho(espelho), [espelho])
  const leitura = ultimaLeitura(espelho)

  const [busca, setBusca] = useState('')
  const [pmo, setPmo] = useState<string | null>(null)
  const [modo, setModo] = useState<'compels' | 'manual' | null>(null)
  const [anterior, setAnterior] = useState<UltimaOp | null>(null)
  // A lista de OPs só aparece depois da última OP da PMO chegar: escolher a OP antes copiaria postos vazios.
  const [carregando, setCarregando] = useState(false)
  const [opEscolhida, setOpEscolhida] = useState<number | null>(null)
  const [trechos, setTrechos] = useState<TrechoCadastro[]>([])
  const [op, setOp] = useState('')
  const [cliente, setCliente] = useState('')
  const [descricao, setDescricao] = useState('')
  const [qtd, setQtd] = useState('')
  const [acp, setAcp] = useState('')
  const [placasPorPainel, setPlacasPorPainel] = useState('1')
  const [embalagemIndividual, setEmbalagemIndividual] = useState(false)

  const termo = busca.trim().toUpperCase()
  const achadas = termo === '' ? [] : pmos.filter((p) => p.pmo.toUpperCase().includes(termo)).slice(0, 8)
  const exata = pmos.some((p) => p.pmo.toUpperCase() === termo)
  const nPainel = Number.isInteger(Number(placasPorPainel)) && Number(placasPorPainel) >= 1 ? Number(placasPorPainel) : 1
  const usados = new Set(trechos.flatMap((t) => t.postos))
  const disponiveis = postos.filter((p) => !usados.has(p))

  async function escolherPmo(codigo: string, m: 'compels' | 'manual') {
    setPmo(codigo); setModo(m); setOpEscolhida(null); setTrechos([]); setCarregando(true)
    const ultima = await ultimaOpDaPmoAction(codigo)
    setAnterior(ultima)
    setCarregando(false)
    setCliente(ultima?.cliente ?? ''); setDescricao(ultima?.descricao ?? '')
    setPlacasPorPainel(String(ultima?.placasPorPainel ?? 1)); setEmbalagemIndividual(ultima?.embalagemIndividual ?? false)
    setOp(''); setQtd(''); setAcp('')
    if (m === 'manual') setTrechos(distribuirPostos([trechoManual(codigo)], ultima?.postos ?? [], almox))
  }

  function escolherOp(o: OpEspelho) {
    setOpEscolhida(o.numero)
    setOp(String(o.numero)); setQtd(String(o.quantidade))
    if (!anterior?.cliente) setCliente(o.cliente)
    if (!anterior?.descricao) setDescricao(o.descricao)
    setTrechos(distribuirPostos(trechosDoEspelho(o, espelho), anterior?.postos ?? [], almox))
  }

  const mudarTrecho = (seq: number, f: (t: TrechoCadastro) => TrechoCadastro) =>
    setTrechos((ts) => fixarAlmoxarifado(ts.map((t) => (t.seq === seq ? f(t) : t)), almox))

  function salvar() {
    if (!pmo || !modo) return
    const c: CadastroOp = {
      modo, pmo, op: op.trim(), cliente: cliente.trim(), descricao: descricao.trim(),
      qtd: qtd.trim() === '' || Number.isNaN(Number(qtd)) ? null : Number(qtd), acp: acp.trim(),
      embalagemIndividual, placasPorPainel: Number(placasPorPainel), trechos,
      componentes: anterior?.componentes ?? [], burnin: anterior?.burnin ?? [],
    }
    const v = validarCadastro(c)
    if (!v.ok) { toast.error(v.erro, TOAST); return }
    startSalvar(async () => {
      const r = await cadastrarOpAction(c)
      if (!r.ok) { toast.error(r.erro, TOAST); return }
      toast.success('OP criada', { ...TOAST, description: `${r.pmo}/${r.op}` })
      router.push('/shopfloor/ordens')
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <Label htmlFor="busca-pmo">PMO *</Label>
        <Input id="busca-pmo" value={busca} autoComplete="off" onChange={(e) => setBusca(e.target.value)} placeholder="Digite a PMO" />
        <p className="text-xs text-muted-foreground">
          {leitura ? `Última leitura do Compels: ${dataHora(leitura)}` : 'O espelho do Compels ainda não foi lido.'}
        </p>
        <div className="flex flex-col gap-1">
          {achadas.map((p) => (
            <Button key={p.pmo} type="button" variant="outline" className="justify-start" onClick={() => { setBusca(p.pmo); void escolherPmo(p.pmo, 'compels') }}>
              {rotuloPmo(p)}
            </Button>
          ))}
          {termo !== '' && !exata && (
            <Button type="button" variant="ghost" className="justify-start" onClick={() => void escolherPmo(termo, 'manual')}>
              {`Usar ${termo} (cadastro manual)`}
            </Button>
          )}
        </div>
        {modo === 'manual' && <p className="text-sm text-amber-700 dark:text-amber-500">Não está no Compels — cadastro manual</p>}
      </section>

      {modo === 'compels' && pmo && !carregando && (
        <section className="flex flex-col gap-2">
          <p className="text-sm font-medium">OP aberta de {pmo}</p>
          <div className="flex flex-col gap-1">
            {opsDaPmo(espelho, pmo).map((o) => (
              <Button key={o.numero} type="button" variant={opEscolhida === o.numero ? 'default' : 'outline'} className="justify-start"
                onClick={() => escolherOp(o)}>
                {`OP ${o.numero} · ${o.quantidade} un · ${o.cliente || '—'} · ${o.dataDocumento ?? '—'} · ${o.situacao}`}
              </Button>
            ))}
          </div>
        </section>
      )}

      {trechos.length > 0 && (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op">Nº OP *</Label>
              <Input id="op" value={op} onChange={(e) => setOp(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cliente">Cliente *</Label>
              <Input id="cliente" list="clientes-existentes" value={cliente} onChange={(e) => setCliente(e.target.value)} />
              <datalist id="clientes-existentes">{clientesExistentes.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qtd">Quantidade</Label>
              <Input id="qtd" inputMode="numeric" value={qtd} onChange={(e) => setQtd(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="placas_por_painel">Placas por painel</Label>
              <Input id="placas_por_painel" inputMode="numeric" value={placasPorPainel} onChange={(e) => setPlacasPorPainel(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="descricao">Descrição</Label>
              <Input id="descricao" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="acp">ACP</Label>
              <Input id="acp" value={acp} onChange={(e) => setAcp(e.target.value)} />
            </div>
            <label className="flex items-start gap-2 text-sm sm:col-span-2 lg:col-span-3">
              <input type="checkbox" checked={embalagemIndividual} onChange={(e) => setEmbalagemIndividual(e.target.checked)} className="mt-0.5 size-4" />
              <span>Embalagem <b>individual</b> — 1 produto por caixa (deixe desmarcado para caixa coletiva).</span>
            </label>
          </section>

          <p className="text-xs text-muted-foreground">
            {anterior ? `Postos copiados da OP ${anterior.op} — confira.` : 'Primeira OP desta PMO: monte os postos de cada trecho.'}
          </p>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {trechos.map((t, ti) => {
              const fixo = t.tipo === 'pmo' ? almox : null
              return (
                <div key={t.seq} className="flex flex-col gap-3 rounded-lg border border-border p-3">
                  <div>
                    <h3 className="text-sm font-semibold">{rotuloTrecho(t)}</h3>
                    {t.compelsOp && <p className="text-xs text-muted-foreground">{`${t.quantidade ?? '—'} un · ${t.situacao || '—'}`}</p>}
                  </div>
                  <ol className="flex flex-col gap-1">
                    {t.postos.map((p, i) => (
                      <li key={p} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm">
                        <span className="flex-1">{p}</span>
                        {p !== fixo && (
                          <>
                            {ti > 0 && i === 0 && (
                              <button type="button" aria-label={`Mover ${p} para o trecho anterior`} className="text-muted-foreground hover:text-foreground"
                                onClick={() => setTrechos((ts) => moverPostoEntreTrechos(ts, t.seq, p, -1, almox))}><ArrowLeft className="size-4" /></button>
                            )}
                            {ti < trechos.length - 1 && i === t.postos.length - 1 && (
                              <button type="button" aria-label={`Mover ${p} para o trecho seguinte`} className="text-muted-foreground hover:text-foreground"
                                onClick={() => setTrechos((ts) => moverPostoEntreTrechos(ts, t.seq, p, 1, almox))}><ArrowRight className="size-4" /></button>
                            )}
                            <button type="button" aria-label={`Subir ${p}`} className="text-muted-foreground hover:text-foreground" disabled={i === 0}
                              onClick={() => mudarTrecho(t.seq, (x) => ({ ...x, postos: moverPostoNaRota(x.postos, i, -1, fixo) }))}><ArrowUp className="size-4" /></button>
                            <button type="button" aria-label={`Descer ${p}`} className="text-muted-foreground hover:text-foreground"
                              onClick={() => mudarTrecho(t.seq, (x) => ({ ...x, postos: moverPostoNaRota(x.postos, i, 1, fixo) }))}><ArrowDown className="size-4" /></button>
                            <button type="button" aria-label={`Remover ${p}`} className="text-muted-foreground hover:text-red-600"
                              onClick={() => mudarTrecho(t.seq, (x) => ({ ...x, postos: x.postos.filter((y) => y !== p) }))}><X className="size-4" /></button>
                          </>
                        )}
                      </li>
                    ))}
                    {t.postos.length === 0 && (
                      <li className="rounded-md border border-dashed border-border px-2 py-2 text-center text-xs text-muted-foreground">Nenhum posto neste trecho.</li>
                    )}
                  </ol>
                  {disponiveis.length > 0 && (
                    <Select value="" onValueChange={(p) => p && mudarTrecho(t.seq, (x) => ({ ...x, postos: [...x.postos, p] }))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="+ Adicionar posto" /></SelectTrigger>
                      <SelectContent>{disponiveis.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                  {t.tipo === 'prt' && (
                    <div className="flex flex-col gap-1 text-sm">
                      {(['mesmo', 'proprio'] as SnModo[]).map((modoSn) => (
                        <label key={modoSn} className="flex items-center gap-2">
                          <input type="radio" name={`sn_modo_${t.seq}`} checked={t.snModo === modoSn}
                            onChange={() => mudarTrecho(t.seq, (x) => ({ ...x, snModo: modoSn, faixas: modoSn === 'proprio' ? [{ sn_ini: '', sn_fim: '' }] : [] }))} />
                          {modoSn === 'mesmo' ? 'Mesma série da PMO' : 'Série própria'}
                        </label>
                      ))}
                    </div>
                  )}
                  {(t.tipo === 'pmo' || t.snModo === 'proprio') && (
                    <FaixasSn faixas={t.faixas} idBase={t.tipo === 'pmo' ? '' : `t${t.seq}_`}
                      setFaixas={(f: FaixaSN[]) => mudarTrecho(t.seq, (x) => ({ ...x, faixas: f }))}
                      qtd={t.tipo === 'pmo' ? qtd : String(t.quantidade ?? '')} nPainel={t.tipo === 'pmo' ? nPainel : 1} />
                  )}
                </div>
              )
            })}
          </section>

          <div className="flex justify-end">
            <Button type="button" onClick={salvar} disabled={salvando} className="bg-enterplak hover:bg-enterplak-700">
              {salvando ? 'Salvando…' : 'Salvar OP'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
```

Nota: o campo de busca tem `id="busca-pmo"` e o rótulo "PMO *"; o teste acha por `getByLabelText('PMO *')`.

- [ ] **Step 5: Página `src/app/(app)/shopfloor/ordens/nova/page.tsx`** (conferir a convenção de página em `node_modules/next/dist/docs/` antes)

```tsx
import Link from 'next/link'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarOrdens, listarPostos } from '@/modules/shopfloor/infra/ordem-repository'
import { mapaPostoPerfil } from '@/modules/shopfloor/infra/postos-repository'
import { listarEspelho } from '@/modules/shopfloor/infra/espelho-ops-repository'
import { NovaOpCliente } from './nova-op-cliente'

export default async function NovaOpPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return <SemPermissao descricao="Você não tem permissão para gerenciar ordens de produção." />
  }
  const [espelho, postos, postosPerfil, ordens] = await Promise.all([listarEspelho(), listarPostos(), mapaPostoPerfil(), listarOrdens()])
  const chaves = postos.map((p) => p.chave).filter((c) => c !== 'Manutenção')
  const clientes = [...new Set(ordens.map((o) => o.cliente))].filter((c) => c.trim() !== '').sort()
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Nova OP</h2>
        <p className="text-sm text-muted-foreground">
          Escolha a PMO e a OP do Compels: as OPs filhas (PRTs) entram como trechos da mesma OP.{' '}
          <Link href="/shopfloor/ordens" className="underline">Voltar às ordens</Link>
        </p>
      </div>
      <NovaOpCliente espelho={espelho} postos={chaves} postosPerfil={postosPerfil} clientesExistentes={clientes} />
    </div>
  )
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine" && npx vitest run --maxWorkers=2 "src/app/(app)/shopfloor/ordens" && npx tsc --noEmit -p . && npx eslint "src/app/(app)/shopfloor/ordens"`
Expected: PASS (inclui os testes antigos do formulário: `faixas-sn-form` continua achando `SN inicial *` porque `idBase` padrão é `''`); sem erro de tipo/lint.

- [ ] **Step 7: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine"
git add "src/app/(app)/shopfloor/ordens"
git commit -m "feat(ordens): tela Nova OP — PMO e OP do espelho do Compels, trechos com postos, faixas e modo de série; modo manual

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Fluxo — seletor de trecho

**Files:**
- Create: `src/modules/shopfloor/domain/trechos-op.ts`, `src/modules/shopfloor/domain/__tests__/trechos-op.test.ts`
- Create: `src/app/(app)/shopfloor/fluxo/seletor-trecho.tsx`, `src/app/(app)/shopfloor/fluxo/__tests__/seletor-trecho.test.tsx`
- Modify: `src/modules/shopfloor/infra/estrutura-repository.ts` (+ teste), `src/modules/shopfloor/application/estrutura-actions.ts` (+ teste), `src/app/(app)/shopfloor/fluxo/fonte-fluxo.tsx`, `src/app/(app)/vitrine/fluxo/fonte-vitrine.ts`, `src/app/(app)/shopfloor/fluxo/fluxo-form.tsx`

**Interfaces:**
- Consumes: `sf_ordem_trechos(seq, codigo, tipo, compels_op)`, `sf_ordem_postos.trecho_seq` (Task 1).
- Produces:
  - `interface TrechoDaOp { seq: number; codigo: string; tipo: 'prt' | 'pmo'; compelsOp: string | null; postos: string[] }`, `rotuloTrechoDaOp(t: TrechoDaOp): string` (`"PRT410 (8500)"`), `realceDoTrecho(trechos: TrechoDaOp[], seq: number | null): Set<string> | null` (null = Todos/sem realce)
  - `listarTrechosDaOp(pmo: string, op: string): Promise<TrechoDaOp[]>` (estrutura-repository)
  - `lerTrechosDaOpAction(pmo: string, op: string): Promise<TrechoDaOp[]>` (estrutura-actions; `shopfloor.visualizar`; erro = `[]`)
  - `FonteFluxo.lerTrechosDaOp: typeof lerTrechosDaOpAction`
  - `SeletorTrecho(props: { trechos: TrechoDaOp[]; valor: number | null; onChange: (seq: number | null) => void })` — nada com menos de 2 trechos

- [ ] **Step 1: Testes**

`src/modules/shopfloor/domain/__tests__/trechos-op.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { realceDoTrecho, rotuloTrechoDaOp, type TrechoDaOp } from '../trechos-op'

const T: TrechoDaOp[] = [
  { seq: 1, codigo: 'PRT410', tipo: 'prt', compelsOp: '8500', postos: ['SPI', 'Inspeção AOI TOP'] },
  { seq: 2, codigo: 'PMOC14', tipo: 'pmo', compelsOp: null, postos: ['Teste', 'Almoxarifado'] },
]

describe('trechos da OP no Fluxo', () => {
  it('rótulo com a OP do Compels quando há', () => {
    expect(T.map(rotuloTrechoDaOp)).toEqual(['PRT410 (8500)', 'PMOC14'])
  })
  it('realce: os postos do trecho; Todos (null) ou trecho inexistente = sem realce', () => {
    expect(realceDoTrecho(T, 1)).toEqual(new Set(['SPI', 'Inspeção AOI TOP']))
    expect(realceDoTrecho(T, null)).toBeNull()
    expect(realceDoTrecho(T, 9)).toBeNull()
  })
})
```

`src/app/(app)/shopfloor/fluxo/__tests__/seletor-trecho.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SeletorTrecho } from '../seletor-trecho'

const T = [
  { seq: 1, codigo: 'PRT410', tipo: 'prt' as const, compelsOp: '8500', postos: ['SPI'] },
  { seq: 2, codigo: 'PRT420', tipo: 'prt' as const, compelsOp: '8499', postos: ['Inspeção PTH'] },
  { seq: 3, codigo: 'PMOC14', tipo: 'pmo' as const, compelsOp: '8498', postos: ['Teste'] },
]

describe('SeletorTrecho', () => {
  it('Todos + um botão por trecho na ordem da rota; escolher avisa o seq', () => {
    const onChange = vi.fn()
    render(<SeletorTrecho trechos={T} valor={null} onChange={onChange} />)
    expect(screen.getByText('Trecho:')).toBeTruthy()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Todos', 'PRT410 (8500)', 'PRT420 (8499)', 'PMOC14 (8498)'])
    expect(screen.getByRole('button', { name: 'Todos' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'PRT420 (8499)' }))
    expect(onChange).toHaveBeenCalledWith(2)
  })
  it('OP sem trechos (ou com um só) não mostra o seletor', () => {
    const { container } = render(<SeletorTrecho trechos={T.slice(2)} valor={null} onChange={() => {}} />)
    expect(container.textContent).toBe('')
  })
})
```

Acrescentar em `src/modules/shopfloor/infra/__tests__/estrutura-repository.test.ts` (o mock do server passa a devolver também `from`):

```ts
// trocar o mock do server por:
const consulta = vi.hoisted(() => ({ select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }))
vi.mock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => ({ rpc, from: () => consulta }) }))
// e o import passa a ser:
import { listarTrechosDaOp, resumoTrechosDaOp } from '../estrutura-repository'

describe('listarTrechosDaOp', () => {
  it('trechos na ordem, cada um com os seus postos na ordem da rota', async () => {
    consulta.select.mockReturnValue(consulta)
    consulta.eq.mockReturnValue(consulta)
    consulta.maybeSingle.mockResolvedValue({ data: {
      sf_ordem_trechos: [{ seq: 2, codigo: 'PMOC14', tipo: 'pmo', compels_op: '8498' }, { seq: 1, codigo: 'PRT410', tipo: 'prt', compels_op: '8500' }],
      sf_ordem_postos: [{ posto: 'Teste', ordem: 2, trecho_seq: 2 }, { posto: 'SPI', ordem: 0, trecho_seq: 1 }, { posto: 'AOI', ordem: 1, trecho_seq: 1 }],
    }, error: null })
    expect(await listarTrechosDaOp('PMOC14', '8498')).toEqual([
      { seq: 1, codigo: 'PRT410', tipo: 'prt', compelsOp: '8500', postos: ['SPI', 'AOI'] },
      { seq: 2, codigo: 'PMOC14', tipo: 'pmo', compelsOp: '8498', postos: ['Teste'] },
    ])
  })
  it('OP inexistente ou sem trechos = vazio', async () => {
    consulta.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect(await listarTrechosDaOp('X', '1')).toEqual([])
  })
})
```

Acrescentar em `src/modules/shopfloor/application/__tests__/estrutura-actions.test.ts` (o mock `repo` ganha `listarTrechosDaOp: vi.fn()`; importar `lerTrechosDaOpAction`):

```ts
describe('lerTrechosDaOpAction', () => {
  it('devolve os trechos; sem permissão ou erro = vazio', async () => {
    repo.listarTrechosDaOp.mockResolvedValueOnce([{ seq: 1, codigo: 'PRT410', tipo: 'prt', compelsOp: '8500', postos: ['SPI'] }])
    expect(await lerTrechosDaOpAction('PMOC14', '8498')).toHaveLength(1)
    vi.mocked(podeNoModulo).mockReturnValueOnce(false)
    expect(await lerTrechosDaOpAction('PMOC14', '8498')).toEqual([])
    repo.listarTrechosDaOp.mockRejectedValueOnce(new Error('x'))
    expect(await lerTrechosDaOpAction('PMOC14', '8498')).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine" && npx vitest run --maxWorkers=2 src/modules/shopfloor/domain/__tests__/trechos-op.test.ts "src/app/(app)/shopfloor/fluxo/__tests__/seletor-trecho.test.tsx" src/modules/shopfloor/infra/__tests__/estrutura-repository.test.ts src/modules/shopfloor/application/__tests__/estrutura-actions.test.ts`
Expected: FAIL (módulos/funções não existem).

- [ ] **Step 3: Implementar domínio, repositório, action e seletor**

`src/modules/shopfloor/domain/trechos-op.ts`:

```ts
/** Trechos de uma OP já criada (0184), para o seletor do Fluxo: cada trecho e os seus postos, na ordem da rota. */
export interface TrechoDaOp {
  seq: number
  codigo: string
  tipo: 'prt' | 'pmo'
  compelsOp: string | null
  postos: string[]
}

export function rotuloTrechoDaOp(t: TrechoDaOp): string {
  return t.compelsOp ? `${t.codigo} (${t.compelsOp})` : t.codigo
}

/** Postos a destacar com o trecho escolhido. null = "Todos" (ou trecho que não existe): nada esmaece. */
export function realceDoTrecho(trechos: TrechoDaOp[], seq: number | null): Set<string> | null {
  if (seq === null) return null
  const t = trechos.find((x) => x.seq === seq)
  return t ? new Set(t.postos) : null
}
```

Em `src/modules/shopfloor/infra/estrutura-repository.ts`, acrescentar (com `import type { TrechoDaOp } from '../domain/trechos-op'`):

```ts
/** Os trechos da OP com os postos de cada um (seletor do Fluxo). OP sem trechos ou inexistente: vazio. */
export async function listarTrechosDaOp(pmo: string, op: string): Promise<TrechoDaOp[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.from('sf_ordens')
    .select('sf_ordem_trechos(seq,codigo,tipo,compels_op),sf_ordem_postos(posto,ordem,trecho_seq)')
    .eq('pmo', pmo).eq('op', op).maybeSingle()
  if (error) throw new Error(`trechos da OP: ${error.message}`)
  const d = data as {
    sf_ordem_trechos?: { seq: number; codigo: string; tipo: 'prt' | 'pmo'; compels_op: string | null }[]
    sf_ordem_postos?: { posto: string; ordem: number; trecho_seq: number | null }[]
  } | null
  const postos = [...(d?.sf_ordem_postos ?? [])].sort((a, b) => a.ordem - b.ordem)
  return [...(d?.sf_ordem_trechos ?? [])].sort((a, b) => a.seq - b.seq).map((t) => ({
    seq: t.seq, codigo: t.codigo, tipo: t.tipo, compelsOp: t.compels_op,
    postos: postos.filter((p) => p.trecho_seq === t.seq).map((p) => p.posto),
  }))
}
```

Em `src/modules/shopfloor/application/estrutura-actions.ts`, acrescentar (imports: `listarTrechosDaOp` e `type TrechoDaOp` de `../domain/trechos-op`):

```ts
/** Trechos da OP (com os postos) para o seletor do Fluxo. Sem sessão, sem permissão de ver ou erro: vazio. */
export async function lerTrechosDaOpAction(pmo: string, op: string): Promise<TrechoDaOp[]> {
  const s = await getSessao()
  if (!s || !podeNoModulo(s.perfil, 'shopfloor', 'visualizar')) return []
  try { return await listarTrechosDaOp(String(pmo ?? ''), String(op ?? '')) } catch { return [] }
}
```

`src/app/(app)/shopfloor/fluxo/seletor-trecho.tsx`:

```tsx
'use client'

import { rotuloTrechoDaOp, type TrechoDaOp } from '@/modules/shopfloor/domain/trechos-op'

/** "Trecho: Todos / PRT410 (8500) / …" acima do desenho. Com menos de 2 trechos não há o que escolher. */
export function SeletorTrecho({ trechos, valor, onChange }: {
  trechos: TrechoDaOp[]
  valor: number | null
  onChange: (seq: number | null) => void
}) {
  if (trechos.length < 2) return null
  const botao = (rotulo: string, seq: number | null) => (
    <button key={seq ?? 'todos'} type="button" aria-pressed={valor === seq} onClick={() => onChange(seq)}
      className={`rounded-md border px-2.5 py-1 text-xs ${valor === seq ? 'border-enterplak bg-enterplak text-white' : 'border-border bg-card hover:bg-muted'}`}>
      {rotulo}
    </button>
  )
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">Trecho:</span>
      {botao('Todos', null)}
      {trechos.map((t) => botao(rotuloTrechoDaOp(t), t.seq))}
    </div>
  )
}
```

- [ ] **Step 4: Ligar no Fluxo**

`src/app/(app)/shopfloor/fluxo/fonte-fluxo.tsx`: importar `lerTrechosDaOpAction` de `@/modules/shopfloor/application/estrutura-actions`; em `FonteFluxo` acrescentar `lerTrechosDaOp: typeof lerTrechosDaOpAction`; em `fonteReal` acrescentar `lerTrechosDaOp: lerTrechosDaOpAction`.

`src/app/(app)/vitrine/fluxo/fonte-vitrine.ts`: no objeto devolvido por `criarFonteVitrine`, acrescentar `async lerTrechosDaOp() { return [] },` (a OP da vitrine não tem trechos).

`src/app/(app)/shopfloor/fluxo/fluxo-form.tsx` (dentro de `FluxoForm`, que já tem `const fonte = useFonteFluxo()` na linha ~504):

```tsx
import { SeletorTrecho } from './seletor-trecho'
import { realceDoTrecho, type TrechoDaOp } from '@/modules/shopfloor/domain/trechos-op'
// … logo depois de `const opSel = useMemo(...)`:
  // Trechos da OP (0184): o seletor destaca os postos de um trecho reaproveitando o esmaecimento da busca de SN.
  const [trechosOp, setTrechosOp] = useState<TrechoDaOp[]>([])
  const [trechoSel, setTrechoSel] = useState<number | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- trocar de OP zera o trecho escolhido
    setTrechoSel(null)
    if (!opSel) { setTrechosOp([]); return }
    let vivo = true
    fonte.lerTrechosDaOp(opSel.pmo, opSel.op).then((t) => { if (vivo) setTrechosOp(t) }).catch(() => { if (vivo) setTrechosOp([]) })
    return () => { vivo = false }
  }, [opSel, fonte])
  const realce = useMemo(() => realceDoTrecho(trechosOp, trechoSel), [trechosOp, trechoSel])
```

No `useMemo` das `edges`, trocar `if (!rota) return { ...e, data: base }` por:

```tsx
      if (!rota) return realce ? { ...e, data: { ...base, atenuado: !(realce.has(e.source) && realce.has(e.target)) } } : { ...e, data: base }
```

e acrescentar `realce` nas dependências desse `useMemo`.

No `useEffect` que monta os nós (`setNodes((prev) => …)`), logo depois do bloco `...(rota ? (() => { … })() : {}),`, acrescentar:

```tsx
          // Trecho escolhido (sem busca de SN): os postos dele ficam, os outros esmaecem. Entrada/Saída não mudam.
          ...(!rota && realce && !n.data.ehEntrada && !n.data.ehSaida ? { foraRota: !realce.has(n.id) } : {}),
```

e acrescentar `realce` nas dependências desse `useEffect`.

Logo antes de `<div ref={canvasRef} …>`:

```tsx
        <SeletorTrecho trechos={trechosOp} valor={trechoSel} onChange={setTrechoSel} />
```

(Se `opSel` não tiver `pmo`/`op` como `string` no tipo, use `opSel.pmo ?? ''` / `opSel.op ?? ''`.)

- [ ] **Step 5: Rodar e ver passar**

Run: `cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine" && npx vitest run --maxWorkers=2 src/modules/shopfloor "src/app/(app)/shopfloor/fluxo" "src/app/(app)/vitrine" && npx tsc --noEmit -p . && npx eslint "src/app/(app)/shopfloor/fluxo" "src/app/(app)/vitrine/fluxo" src/modules/shopfloor/domain/trechos-op.ts src/modules/shopfloor/infra/estrutura-repository.ts src/modules/shopfloor/application/estrutura-actions.ts`
Expected: PASS (inclui `fluxo-node-trecho.test.tsx`, que mocka `estrutura-actions` — se ele quebrar por faltar `lerTrechosDaOpAction` no mock, acrescente `lerTrechosDaOpAction: vi.fn(async () => [])` ao `trechos` hoisted dele); sem erro de tipo/lint.

- [ ] **Step 6: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine"
git add src/modules/shopfloor/domain/trechos-op.ts src/modules/shopfloor/domain/__tests__/trechos-op.test.ts src/modules/shopfloor/infra/estrutura-repository.ts src/modules/shopfloor/infra/__tests__/estrutura-repository.test.ts src/modules/shopfloor/application/estrutura-actions.ts src/modules/shopfloor/application/__tests__/estrutura-actions.test.ts "src/app/(app)/shopfloor/fluxo" "src/app/(app)/vitrine/fluxo/fonte-vitrine.ts"
git commit -m "feat(fluxo): seletor de trecho — destaca os postos da PRT ou da PMO escolhida

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: verificação da branch inteira + roteiro de deploy

**Files:**
- Modify: `docs/superpowers/plans/2026-11-18-cadastro-op-compels.md` (anotar o resultado na seção "Resultado da verificação" no fim)

- [ ] **Step 1: Suíte inteira, tipos, lint e harness**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine"
npx vitest run --maxWorkers=2
npx tsc --noEmit -p .
npx eslint .
bash supabase/tests/rodar-estrutura-op-test.sh
grep -rn "sf_estruturas\|sf_estrutura_trechos\|sf_salvar_estrutura\|/shopfloor/estruturas\|aplicarEstruturaNaOp\|situacaoEstruturaPorPmo" src supabase/migrations/0184_estrutura_op.sql | grep -v "drop "
```

Expected: vitest sem falha nova (falhas que já existiam na main — ex.: timeout de `modal-abastecimento.test.tsx` na suíte cheia — anotar e rodar o arquivo sozinho); `tsc` limpo; eslint sem erro novo desta branch; harness `PROVA ESTRUTURA OK` / `PROVA CADASTRO OK` / `ESTRUTURA OP SQL OK`; o `grep` não acha nada.

- [ ] **Step 2: `next build`**

Run: `cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine" && npx next build`
Expected: build OK (o `node_modules` desta worktree é cópia com hard link, que o build aceita; sem `.env.local`, a coleta de `/api/alertas/avaliar` pode falhar — é do ambiente, não da branch). Conferir na saída que existem as rotas `/shopfloor/ordens/nova` e `/api/compels/espelho-ops` e que `/shopfloor/estruturas` sumiu.

- [ ] **Step 3: Smoke local (manual, com o Compels simulado do smoke de 13/11)**

1. Banco local: aplicar a 0184 com `psql -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0184_estrutura_op.sql`, depois `notify pgrst, 'reload schema';`.
2. Rodar a rota do espelho: `curl -fsS -X POST -H "Authorization: Bearer $ESTOQUE_CRON_SECRET" http://127.0.0.1:3000/api/compels/espelho-ops` → JSON com `lidas` > 0. Sem o cabeçalho → 401 (não 302).
3. Ordens → Nova OP: escolher a PMO da família simulada (9498 PMOC14 → 9499 PRT420 → 9500 PRT410), a OP 9498; conferir os 3 trechos na ordem, os postos copiados da OP de referência, ajustar com ← / →, marcar "Série própria" na PRT410 com uma faixa e salvar. Conferir no banco `sf_ordem_trechos` (3 linhas, a PMO `tipo = 'pmo'`), `sf_ordem_postos.trecho_seq` e `sf_ordem_faixas`.
4. PMO inexistente: "Não está no Compels — cadastro manual", criar OP com um trecho.
5. Fluxo da OP 9498: "Trecho: Todos / PRT410 (9500) / PRT420 (9499) / PMOC14 (9498)"; escolher um trecho esmaece os outros postos. OP manual: sem seletor.
6. Editar a OP 9498 no diálogo: trocar o número → recusa; acrescentar um posto → salva e ele aparece no trecho da PMO no Fluxo.

- [ ] **Step 4: Anotar o resultado e commitar**

Acrescentar no fim deste arquivo uma seção `## Resultado da verificação` com o que rodou (números do vitest, harness, build, smoke) e commitar:

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-vitrine"
git add docs/superpowers/plans/2026-11-18-cadastro-op-compels.md
git commit -m "docs(ordens): resultado da verificação do cadastro de OP integrado ao Compels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Deploy (depois da revisão e do merge; quem faz é o usuário)

1. **RDS (antes do app).** A 0184 entra **fora de ordem** (o RDS está na 0188; a 0189/0190 são de outras branches e não dependem dela):
   ```bash
   mkdir -p ~/lote && cd ~/ShopFloor && git fetch -q origin && git show origin/main:supabase/migrations/0184_estrutura_op.sql > ~/lote/0184_estrutura_op.sql && wc -l ~/lote/0184_estrutura_op.sql
   HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"'); PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null PGOPTIONS='-c lock_timeout=5s' psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f ~/lote/0184_estrutura_op.sql
   ```
   O arquivo termina com `notify pgrst, 'reload schema';`. Conferir:
   ```bash
   HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"'); PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select to_regclass('public.sf_ordem_trechos') is not null as trechos, to_regclass('public.sf_compels_ops') is not null as espelho, (select count(*) from information_schema.columns where column_name = 'trecho_seq') = 2 as trecho_seq, (select count(*) from pg_proc where proname in ('sf_cadastrar_op','sf_ordem_regravar_postos','sf_ordem_regravar_faixas','sf_ultima_op_da_pmo','sf_compels_ops_sincronizar')) = 5 as funcoes; notify pgrst, 'reload schema';"
   ```
   Todas `t`. (O `git fetch` + `git show` só tira a 0184 do merge para `~/lote/`: o HEAD não anda, então o `deploy.sh` do passo 2 ainda vê o pull avançar e faz o build.)
2. **App:** `cd ~/ShopFloor && bash deploy/aws/deploy.sh` (não rodar `git pull` à mão antes).
3. **Crontab** (`crontab -e`, máquina em UTC; o `~/.estoque-cron-header` já existe):
   ```
   */10 10-21 * * 1-5 flock -n $HOME/.espelho-ops.lock curl -fsS -m 120 -X POST -H @$HOME/.estoque-cron-header http://127.0.0.1:3000/api/compels/espelho-ops >> $HOME/espelho-ops.log 2>&1
   ```
   Primeira rodada à mão (mesmo `curl` sem o `flock`) e `tail ~/espelho-ops.log`: JSON com `lidas` > 0. HTML/302 no log = rota fora do `middleware.ts`.
4. **Chave das PRTs:** continua desligada (`COMPELS_PRT_LIGADO` ausente) — as linhas das PRTs ficam na fila com "Apontamento das PRTs desligado" até a frequência ser decidida.
5. **Rollback:** `docs/operacao/estrutura-op/rollback-0184.sql` (`psql -1`) + o app anterior (`git reset --hard <commit anterior>` + `npm run build` + `pm2 restart shopfloor --update-env` + `pm2 save`) + tirar a linha do crontab.
