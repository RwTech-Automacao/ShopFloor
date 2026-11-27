# Nova OP — ignorar uma PRT · Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na Nova OP integrada ao Compels, deixar o usuário ignorar uma PRT da cadeia (tirando ou mantendo os postos dela na rota), com Desfazer antes de salvar, log da decisão, e permitir incluí-la de novo na edição da OP enquanto não houver bipe nos postos que passariam a ser dela.

**Architecture:** PRT ignorada = não é trecho: não vai em `sf_ordem_trechos`, então nunca entra na fila do apontamento automático (0197). O cadastro no banco (`sf_cadastrar_op`, 0195) já aceita a cadeia sem uma PRT — quem recusava era a action (`cadastrarOpAction`, conferência `bate`), que passa a aceitar "espelho menos as ignoradas". A edição no banco (`sf_ordem_regravar_trechos`, 0197) NÃO aceita trecho novo (`TRECHOS_DIFERENTES`), então a migração 0199 cria a `sf_ordem_incluir_trechos` (interna) e a chama do texto da 0197 só quando a entrada traz item sem `seq`: confere a cadeia pelo espelho `sf_compels_ops`, recusa bipe, renumera os trechos e grava a PRT; o resto da regravação segue igual.

**Tech Stack:** Next.js 16 (App Router, server actions — sem API nova do Next; guia: `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`), React 19, TypeScript, Vitest + Testing Library, Supabase/PostgreSQL 15 (plpgsql), harness SQL em Docker (`supabase/tests/`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-26-nova-op-ignorar-prt-design.md` (aprovada 26/11/2026). Branch `feat/nova-op-ignorar-prt`, worktree `/home/rwtech/Área de trabalho/ShopFloor-ignorar-prt`. Trabalhe só nela.
- Só PRT pode ser ignorada. A PMO mãe nunca (o botão não aparece para ela, e o servidor/banco recusam).
- Textos exatos da tela: **"Ignorar esta PRT"**, **"Tirar os postos da rota"**, **"Manter os postos na rota da OP"**, selo **"Ignorada"**, **"Desfazer"**.
- "Manter": os postos vão para o **começo do trecho seguinte** (preservando a ordem da rota); se a PRT era a última antes da PMO, vão para a PMO.
- PRT ignorada **não é trecho**: sem faixa, sem série própria, sem apontamento automático no Compels. **Nenhuma coluna nova.** **Nada grava no Compels.**
- Seq dos trechos **renumerado sem buraco ao enviar** (1..n).
- Edição: incluir de novo uma PRT da cadeia que ficou de fora **enquanto não houver bipe** nos postos que passariam a ser dela.
- A decisão (quem, quando, qual PRT, tirar/manter) vai no **mesmo log** (`registrarLog`, entidade `sf_ordem`) do cadastro/edição.
- Não acrescentar UI que a spec não peça. Fora do escopo: motivo cadastrado; apontar no Compels a PRT ignorada.
- Migração: número **0199** (0198 reservada pela `feat/sat-ordem-servico`; conferido em todas as branches locais e worktrees em 26/11). Idempotente, `$func$`, `notify pgrst, 'reload schema';` na última linha, sem tabela nova (RLS InitPlan não se aplica), **sem mudar o comportamento existente** (a regravação da 0197 só ganha linhas). Rollback em `docs/operacao/estrutura-op/rollback-0199.sql`. ORDEM DE DEPLOY: migração antes do app.
- Não rodar migração em banco remoto, não fazer push. Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Testes: `npx vitest run <arquivo> --maxWorkers=2`; harness SQL com Docker (`postgres:15-alpine`).
- PT-BR em tudo (código de domínio, mensagens, commits).

## O que o código real diz (respostas da spec)

**(a) O cadastro aceita uma cadeia sem uma das PRTs do espelho?**
- **Banco: sim.** `sf_cadastrar_op` vigente (`supabase/migrations/0195_receita_integracao_prt.sql:202-289`) só exige: trechos não vazios (`SEM_TRECHO`), seq único (`TRECHO_SEQ_REPETIDO`), uma PMO e ela com o maior seq (`PMO_NAO_E_ULTIMO`), postos/faixas/receita. Não lê `sf_compels_ops` nem exige seq contíguo. **Sem a PMO** cai em `PMO_NAO_E_ULTIMO`.
- **Action: não.** `cadastrarOpAction` (`src/modules/shopfloor/application/cadastro-op-actions.ts:63-66`) compara com `trechosDoEspelho` por tamanho, código, OP, seq e tipo (`bate`) — faltando uma PRT dá "Os trechos não batem com o Compels…". → Task 3 troca por `erroCadeiaCompels` (espelho menos ignoradas). **A migração não mexe no cadastro.**

**(b) A edição aceita incluir um trecho novo e recusa se houver bipe?**
- **Não.** `sf_ordem_regravar_trechos` vigente (`0197_prt_apontamento_automatico.sql:454-680`) recusa com `TRECHOS_DIFERENTES` se o número de itens for diferente do gravado ou se algum `seq` não existir (linhas 486-492). → Task 1 (0199).
- A trava de bipe que já existe ("histórico 1", `POSTO_COM_REGISTROS`, linhas 576-584) cobre posto com registro **trocando de trecho**; a 0199 acrescenta a recusa explícita `PRT_INCLUIDA_COM_REGISTROS:<codigo>` para qualquer posto da PRT incluída com registro na OP.
- O seq do trecho só existe em `sf_ordem_trechos.seq`, `sf_ordem_postos.trecho_seq` e `sf_ordem_faixas.trecho_seq` (0184:226-227); a fila de PRT liga por `ordem_id` + código (`sf_estoque_envios.pmo = codigo`), então renumerar é seguro dentro da transação (a regravação já segura o advisory da OP e a linha `FOR UPDATE`; o bipe espera em `KEY SHARE`).

**Apontamento (0197):** `sf_trecho_enfileirar` (`0197:123-161`) faz `join sf_ordem_trechos ot ... where ot.posto_conclui = new.posto and ot.tipo = 'prt' and o.apontar_prt`, e `sf_prt_agrupar` (`0197:266-288`) também só lê `sf_ordem_trechos`. PRT ignorada nunca entra na fila; no modo "manter" os postos dela viram do trecho seguinte, que só aponta no PRÓPRIO posto final. Provado na Task 1 (caso 1).

**Log:** `registrarLog` (`src/modules/logs/application/registrar-log.ts`) grava usuário (sessão) e hora; o cadastro registra `acao: 'criar'` e a edição `acao: 'alterar_campo'`, ambos `entidade: 'sf_ordem'`. A decisão entra na `descricao` e em `dados` (`prtsIgnoradas` / `prtsIncluidas`).

**Harness:** `rodar-editar-op-trechos-test.sh` monta só 0184+0194 e o rollback dele confere o texto da 0194 — não serve para a 0199, que redefine o texto da **0197**. O ambiente certo é o do `rodar-prt-agrupar-test.sh` (estado vigente 0184→0197); a Task 1 cria `rodar-ignorar-prt-test.sh` com esse mesmo ambiente.

## Decisões tomadas onde a spec deixava aberto

1. **Renumerar na edição:** como o cadastro manda seq 1..n, reincluir uma PRT exige renumerar. A 0199 faz isso no banco, pela **ordem da lista enviada** (item gravado vem com o seq antigo; a PRT incluída vem **sem seq**, com `codigo` + `compels_op`). Os gravados têm de vir todos, uma vez, na mesma ordem relativa, e a PMO por último.
2. **Quem confere a cadeia na edição é o banco** (`sf_compels_ops`, pela cadeia de mães até 20 níveis — a regra do `trechosDoEspelho`), não a action: a edição não lê o espelho no servidor.
3. **PRT incluída entra vazia** (sem posto, série "mesma da PMO"), no lugar dela na cadeia; os postos vêm com ← → dos vizinhos ou "Adicionar posto". Salvar com ela vazia é barrado pela validação de sempre ("O trecho … está sem posto.").
4. **Desfazer** devolve a PRT com os postos que tinha quando foi ignorada, tirando-os de onde estiverem agora; volta no lugar dela pela ordem da cadeia (seq da tela).
5. **Cadastro manual** não aceita ignoradas (recusa com a mensagem do manual de sempre).
6. **Na edição**, a lista "PRTs fora desta OP" mostra cada PRT com o selo "Ignorada" e o botão "Incluir de novo" — só isso.
7. Mensagens novas: `PRT_INCLUIDA_FORA_DA_CADEIA` → "X não é uma PRT desta OP no Compels. Recarregue a página e tente de novo."; `PRT_INCLUIDA_REPETIDA` → "X já é um trecho desta OP."; `PRT_INCLUIDA_COM_REGISTROS` → "X não pode voltar com esses postos: algum deles já tem peças bipadas nesta OP."; ignorar a PMO → "A OP da PMO não pode ser ignorada."

## Mapa de arquivos

| Arquivo | O quê |
|---|---|
| `supabase/migrations/0199_ignorar_prt.sql` (novo) | `sf_ordem_incluir_trechos` + `sf_ordem_regravar_trechos` (texto da 0197 + 5 linhas) |
| `docs/operacao/estrutura-op/rollback-0199.sql` (novo) | volta a regravação ao texto da 0197 e apaga a função nova |
| `supabase/tests/ignorar_prt_test.sql` (novo) | prova da 0199 |
| `supabase/tests/rodar-ignorar-prt-test.sh` (novo) | harness: estado vigente, 0199 2×, prova, rollback 2×, 0199 de novo |
| `src/modules/shopfloor/domain/cadastro-op.ts` | tipos `ModoIgnorar`, `PrtIgnorada`, `PrtIgnoradaEnvio`, `ESCOLHA_IGNORAR`, `TrechoCadastro.incluida`, `CadastroOp.ignoradas`; `chaveTrecho`, `ignorarPrt`, `desfazerIgnorar`, `trechosParaEnviar`, `ignoradasParaEnviar`, `erroCadeiaCompels`, `resumoIgnoradas` |
| `src/modules/shopfloor/application/cadastro-op-actions.ts` | conferência da cadeia com ignoradas + log |
| `src/app/(app)/shopfloor/ordens/ignorar-prt.tsx` (novo) | `IgnorarPrt`, `PrtsIgnoradas`, `PrtsForaDaOp` |
| `src/app/(app)/shopfloor/ordens/nova/nova-op-cliente.tsx` | estado das ignoradas, botões, Desfazer, envio |
| `src/modules/shopfloor/domain/edicao-op-trechos.ts` | `TrechoParaGravar`, `trechosParaGravar` (incluída sem seq), `cadeiaDaOp`, `prtsForaDaOp`, `incluirPrt` |
| `src/modules/shopfloor/infra/ordem-repository.ts` | `TrechoEdicao.seq: number \| null` + `codigo`/`compels_op` |
| `src/modules/shopfloor/application/ordens-actions.ts` | `lerTrechos` aceita a incluída; log |
| `src/modules/shopfloor/domain/erros-trecho.ts` | 3 códigos novos |
| `src/app/(app)/shopfloor/ordens-nova/[id]/editar-op-cliente.tsx`, `page.tsx` | lista "PRTs fora desta OP" e a cadeia |
| Testes novos | `domain/__tests__/cadastro-op-ignorar.test.ts`, `domain/__tests__/edicao-op-incluir-prt.test.ts`, `application/__tests__/ordens-actions-incluir-prt.test.ts`, `ordens/nova/__tests__/nova-op-ignorar-prt.test.tsx`, `ordens-nova/[id]/__tests__/editar-op-incluir-prt.test.tsx` |
| Testes estendidos | `application/__tests__/cadastro-op-actions.test.ts`, `domain/__tests__/erros-trecho.test.ts`, `ordens-nova/[id]/__tests__/page.test.tsx` |

Todos os caminhos abaixo são relativos à raiz do worktree. Rode cada comando de lá:

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-ignorar-prt"
```

---

### Task 1: Banco — 0199 (incluir PRT de novo na edição), rollback e prova SQL

**Files:**
- Create: `supabase/tests/ignorar_prt_test.sql`
- Create: `supabase/tests/rodar-ignorar-prt-test.sh`
- Create: `supabase/migrations/0199_ignorar_prt.sql`
- Create: `docs/operacao/estrutura-op/rollback-0199.sql`

**Interfaces:**
- Consumes: `sf_cadastrar_op(jsonb)` (0195), `sf_ordem_regravar_trechos(uuid, jsonb, jsonb, jsonb, jsonb)` (0197), tabela `sf_compels_ops` (0184).
- Produces: `public.sf_ordem_incluir_trechos(p_ordem_id uuid, p_pmo text, p_op text, p_entrada jsonb) returns jsonb` (interna, sem grant). `sf_ordem_regravar_trechos` passa a aceitar, em `p_trechos`, item **sem `seq`** (ausente, `null` ou `""`) com `codigo` + `compels_op` = PRT incluída de novo; a ordem da lista vira a ordem dos trechos. Códigos de erro novos: `PRT_INCLUIDA_FORA_DA_CADEIA:<codigo>`, `PRT_INCLUIDA_REPETIDA:<codigo>`, `PRT_INCLUIDA_COM_REGISTROS:<codigo>`; reaproveitados: `TRECHOS_DIFERENTES`, `PMO_NAO_E_ULTIMO`.

- [ ] **Step 1: Escrever a prova SQL (falha: a 0199 não existe)**

```bash
cat > supabase/tests/ignorar_prt_test.sql <<'EOF'
-- Prova da 0199 (Nova OP: ignorar uma PRT; incluir de novo na edição). Roda depois de: esquema + 0132 (reserva) + 0153 +
-- 0184 + 0194 + 0066 + 0195 + 0197 + 0199 (2x). Cadeia do Compels de cada OP: PRT de nível 3 → PRT de nível 2 → PMO.
\set ON_ERROR_STOP on

create or replace function pg_temp.op(p_pmo text, p_op text) returns uuid language sql as $f$
  select id from sf_ordens where pmo = p_pmo and op = p_op
$f$;
create or replace function pg_temp.confere(p_caso text, p_veio text, p_esperado text) returns void language plpgsql as $f$
begin
  if p_veio is distinct from p_esperado then raise exception '% — veio "%", esperava "%"', p_caso, p_veio, p_esperado; end if;
end $f$;
-- o estado da OP numa linha: rota (posto:ordem:trecho), trechos (seq:codigo:compels_op:conclui:sn_modo), faixas, faixa 1
create or replace function pg_temp.estado(p uuid) returns text language sql as $f$
  select concat_ws(' | ',
    (select string_agg(posto || ':' || ordem || ':' || coalesce(trecho_seq::text, '-'), ',' order by ordem) from sf_ordem_postos where ordem_id = p),
    (select string_agg(seq || ':' || codigo || ':' || coalesce(compels_op, '-') || ':' || posto_conclui || ':' || sn_modo, ',' order by seq) from sf_ordem_trechos where ordem_id = p),
    (select string_agg(seq || ':' || sn_ini || '-' || sn_fim || ':' || coalesce(trecho_seq::text, '-'), ',' order by seq) from sf_ordem_faixas where ordem_id = p),
    (select sn_ini || '-' || sn_fim from sf_ordens where id = p))
$f$;
create or replace function pg_temp.rt(p uuid, trechos text) returns void language plpgsql as $f$
begin
  perform sf_ordem_regravar_trechos(p, trechos::jsonb, '{"cliente":"C","status":"ATIVA","placas_por_painel":1}'::jsonb, '[]'::jsonb, '[]'::jsonb);
end $f$;
-- recusa: a chamada tem que falhar com `msg` e nada da OP pode mudar (nem a renumeração)
create or replace function pg_temp.recusa(p uuid, entrada text, msg text) returns void language plpgsql as $f$
declare antes text := pg_temp.estado(p);
begin
  begin
    perform pg_temp.rt(p, entrada);
  exception when others then
    if sqlerrm <> msg then raise exception 'esperava "%", veio "%" (entrada %)', msg, sqlerrm, entrada; end if;
    if pg_temp.estado(p) is distinct from antes then raise exception 'recusa "%" mexeu na OP: % -> %', msg, antes, pg_temp.estado(p); end if;
    return;
  end;
  raise exception 'esperava "%", mas passou (entrada %)', msg, entrada;
end $f$;

-- o espelho do Compels (sf_compels_ops, só leitura no app): três cadeias PRT nível 3 → PRT nível 2 → PMO
insert into sf_compels_ops (numero, id_compels, codigo, nivel, mae_numero) values
  (9800, 9800, 'PMOI', 1, null), (9801, 9801, 'PRTI2', 2, 9800), (9802, 9802, 'PRTI1', 3, 9801),
  (9810, 9810, 'PMOJ', 1, null), (9811, 9811, 'PRTJ2', 2, 9810), (9812, 9812, 'PRTJ1', 3, 9811),
  (9820, 9820, 'PMOK', 1, null), (9821, 9821, 'PRTK2', 2, 9820), (9822, 9822, 'PRTK1', 3, 9821);

-- ======================= 1. CADASTRO SEM UMA PRT DA CADEIA =======================
-- PRTI2 ignorada no modo "manter": os postos dela (Montagem PTH, Inspeção PTH) foram para o começo da PMO
select sf_cadastrar_op($j${
  "ordem": {"pmo":"PMOI","op":"9800","cliente":"C","qtd":5,"placas_por_painel":1},
  "trechos": [
    {"seq":1,"codigo":"PRTI1","tipo":"prt","compels_op":"9802","sn_modo":"mesmo","postos":["SPI","Inspeção AOI TOP"],"faixas":[]},
    {"seq":2,"codigo":"PMOI","tipo":"pmo","compels_op":"9800","postos":["Montagem PTH","Inspeção PTH","Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"5"}]}
  ]}$j$::jsonb);
do $$
declare v uuid := pg_temp.op('PMOI', '9800');
begin
  perform pg_temp.confere('cadastro sem PRTI2', pg_temp.estado(v),
    'SPI:0:1,Inspeção AOI TOP:1:1,Montagem PTH:2:2,Inspeção PTH:3:2,Teste:4:2,Almoxarifado:5:2'
    || ' | 1:PRTI1:9802:Inspeção AOI TOP:mesmo,2:PMOI:9800:Almoxarifado:mesmo | 1:1-5:2 | 1-5');
  perform pg_temp.confere('OP nova aponta PRT', (select apontar_prt::text from sf_ordens where id = v), 'true');
  -- bipe no último posto da PRT ignorada (Inspeção PTH, agora da PMO): nada de PRT na fila
  insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values ('Inspeção PTH', 'PMOI', '9800', 'Aprovado', '1', '1');
  perform pg_temp.confere('PRT ignorada não enfileira', (select count(*)::text from sf_estoque_envios where ordem_id = v), '0');
  -- a PRT que ficou (PRTI1) continua sendo apontada no fim do trecho dela
  insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values ('Inspeção AOI TOP', 'PMOI', '9800', 'Aprovado', '2', '2');
  perform pg_temp.confere('PRT que ficou enfileira', (select string_agg(pmo || '/' || op, ',') from sf_estoque_envios where ordem_id = v), 'PRTI1/9802');
end $$;

-- sem a PMO: recusado (o cadastro de sempre)
do $$
begin
  perform sf_cadastrar_op($j${
    "ordem": {"pmo":"PMOI","op":"9800_X","cliente":"C","qtd":5,"placas_por_painel":1},
    "trechos": [{"seq":1,"codigo":"PRTI1","tipo":"prt","compels_op":"9802","postos":["SPI"],"faixas":[]}]}$j$::jsonb);
  raise exception 'cadastro sem a PMO passou';
exception when others then
  if sqlerrm <> 'PMO_NAO_E_ULTIMO' then raise exception 'sem a PMO: esperava PMO_NAO_E_ULTIMO, veio %', sqlerrm; end if;
end $$;

-- ======================= 2. INCLUIR DE NOVO NA EDIÇÃO, SEM BIPE =======================
select sf_cadastrar_op($j${
  "ordem": {"pmo":"PMOJ","op":"9810","cliente":"C","qtd":5,"placas_por_painel":1},
  "trechos": [
    {"seq":1,"codigo":"PRTJ1","tipo":"prt","compels_op":"9812","sn_modo":"proprio","postos":["SPI","Inspeção AOI TOP"],"faixas":[{"sn_ini":"A001","sn_fim":"A010"}]},
    {"seq":2,"codigo":"PMOJ","tipo":"pmo","compels_op":"9810","postos":["Montagem PTH","Inspeção PTH","Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"5"}]}
  ]}$j$::jsonb);
do $$
declare v uuid := pg_temp.op('PMOJ', '9810');
begin
  -- PRTJ2 volta entre PRTJ1 e a PMO, com os postos que eram dela; a PMO vira o trecho 3
  perform pg_temp.rt(v, $j$[
    {"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"A001","sn_fim":"A010"}]},
    {"codigo":"PRTJ2","compels_op":"9811","postos":["Montagem PTH","Inspeção PTH"],"sn_modo":"mesmo","faixas":[]},
    {"seq":2,"postos":["Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"5"}]}
  ]$j$);
  perform pg_temp.confere('incluir PRTJ2', pg_temp.estado(v),
    'SPI:0:1,Inspeção AOI TOP:1:1,Montagem PTH:2:2,Inspeção PTH:3:2,Teste:4:3,Almoxarifado:5:3'
    || ' | 1:PRTJ1:9812:Inspeção AOI TOP:proprio,2:PRTJ2:9811:Inspeção PTH:mesmo,3:PMOJ:9810:Almoxarifado:mesmo'
    || ' | 1:1-5:3,2:A001-A010:1 | 1-5');
  perform pg_temp.confere('estoque da incluída', (select estoque || ':' || tipo from sf_ordem_trechos where ordem_id = v and codigo = 'PRTJ2'), 'EINTER:prt');
  -- dali em diante a PRT incluída é apontada no fim do trecho dela
  insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values ('Inspeção PTH', 'PMOJ', '9810', 'Aprovado', '3', '3');
  perform pg_temp.confere('incluída enfileira', (select string_agg(pmo || '/' || op, ',') from sf_estoque_envios where ordem_id = v), 'PRTJ2/9811');
  -- e a edição de sempre (todos com seq) segue igual depois da renumeração
  perform pg_temp.rt(v, $j$[
    {"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"A001","sn_fim":"A010"}]},
    {"seq":2,"postos":["Montagem PTH","Inspeção PTH"],"sn_modo":"mesmo"},
    {"seq":3,"postos":["Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"6"}]}
  ]$j$);
  perform pg_temp.confere('edição depois', pg_temp.estado(v),
    'SPI:0:1,Inspeção AOI TOP:1:1,Montagem PTH:2:2,Inspeção PTH:3:2,Teste:4:3,Almoxarifado:5:3'
    || ' | 1:PRTJ1:9812:Inspeção AOI TOP:proprio,2:PRTJ2:9811:Inspeção PTH:mesmo,3:PMOJ:9810:Almoxarifado:mesmo'
    || ' | 1:1-6:3,2:A001-A010:1 | 1-6');
end $$;

-- ======================= 3. RECUSAS (nada muda, nem a renumeração) =======================
select sf_cadastrar_op($j${
  "ordem": {"pmo":"PMOK","op":"9820","cliente":"C","qtd":5,"placas_por_painel":1},
  "trechos": [
    {"seq":1,"codigo":"PRTK1","tipo":"prt","compels_op":"9822","sn_modo":"mesmo","postos":["SPI","Inspeção AOI TOP"],"faixas":[]},
    {"seq":2,"codigo":"PMOK","tipo":"pmo","compels_op":"9820","postos":["Montagem PTH","Inspeção PTH","Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"5"}]}
  ]}$j$::jsonb);
do $$
declare v uuid := pg_temp.op('PMOK', '9820');
  ok1 text := '{"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"mesmo"}';
  ok2 text := '{"seq":2,"postos":["Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"5"}]}';
  nova text := '{"codigo":"PRTK2","compels_op":"9821","postos":["Montagem PTH","Inspeção PTH"],"sn_modo":"mesmo"}';
begin
  -- forma e trechos gravados
  perform pg_temp.recusa(v, format('[%s,%s]', nova, ok2), 'TRECHOS_DIFERENTES');
  perform pg_temp.recusa(v, format('[%s,%s,%s,%s]', ok1, ok1, nova, ok2), 'TRECHOS_DIFERENTES');
  perform pg_temp.recusa(v, format('[{"seq":"x","postos":["SPI"]},%s,%s]', nova, ok2), 'TRECHOS_DIFERENTES');
  perform pg_temp.recusa(v, format('[%s,%s,{"seq":9,"postos":["Teste"]}]', ok1, nova), 'TRECHOS_DIFERENTES');
  perform pg_temp.recusa(v, format('[%s,%s,{"seq":1,"postos":["SPI","Inspeção AOI TOP"]}]', ok2, nova), 'TRECHOS_DIFERENTES');
  -- a PMO por último
  perform pg_temp.recusa(v, format('[%s,%s,%s]', ok1, ok2, nova), 'PMO_NAO_E_ULTIMO');
  -- da cadeia desta OP: outra cadeia, código que não bate, a própria PMO, OP do Compels inválida
  perform pg_temp.recusa(v, format('[%s,{"codigo":"PRTJ2","compels_op":"9811","postos":["Montagem PTH"]},%s]', ok1, ok2), 'PRT_INCLUIDA_FORA_DA_CADEIA:PRTJ2');
  perform pg_temp.recusa(v, format('[%s,{"codigo":"PRTX","compels_op":"9821","postos":["Montagem PTH"]},%s]', ok1, ok2), 'PRT_INCLUIDA_FORA_DA_CADEIA:PRTX');
  perform pg_temp.recusa(v, format('[%s,{"codigo":"PMOK","compels_op":"9820","postos":["Montagem PTH"]},%s]', ok1, ok2), 'PRT_INCLUIDA_FORA_DA_CADEIA:PMOK');
  perform pg_temp.recusa(v, format('[%s,{"codigo":"PRTK2","compels_op":"abc","postos":["Montagem PTH"]},%s]', ok1, ok2), 'PRT_INCLUIDA_FORA_DA_CADEIA:PRTK2');
  -- já na OP, ou duas vezes
  perform pg_temp.recusa(v, format('[{"codigo":"PRTK1","compels_op":"9822","postos":["NQA"]},%s,%s]', ok1, ok2), 'PRT_INCLUIDA_REPETIDA:PRTK1');
  perform pg_temp.recusa(v, format('[%s,%s,%s,%s]', ok1, nova, nova, ok2), 'PRT_INCLUIDA_REPETIDA:PRTK2');
  -- a regravação de sempre recusa depois da renumeração, e a renumeração volta junto
  perform pg_temp.recusa(v, format('[%s,{"codigo":"PRTK2","compels_op":"9821","postos":[]},%s]', ok1, ok2), 'TRECHO_SEM_POSTO:PRTK2');
  -- com bipe num posto que passaria a ser da PRT incluída
  insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values ('Inspeção PTH', 'PMOK', '9820', 'Aprovado', '1', '1');
  perform pg_temp.recusa(v, format('[%s,%s,%s]', ok1, nova, ok2), 'PRT_INCLUIDA_COM_REGISTROS:PRTK2');
end $$;
-- só o posto sem bipe vai para a PRT incluída; o bipado (Inspeção PTH) fica na PMO
do $$
declare v uuid := pg_temp.op('PMOK', '9820');
begin
  perform pg_temp.rt(v, $j$[
    {"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"mesmo"},
    {"codigo":"PRTK2","compels_op":"9821","postos":["Montagem PTH"],"sn_modo":"mesmo"},
    {"seq":2,"postos":["Inspeção PTH","Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"5"}]}
  ]$j$);
  perform pg_temp.confere('incluir só com o posto sem bipe', pg_temp.estado(v),
    'SPI:0:1,Inspeção AOI TOP:1:1,Montagem PTH:2:2,Inspeção PTH:3:3,Teste:4:3,Almoxarifado:5:3'
    || ' | 1:PRTK1:9822:Inspeção AOI TOP:mesmo,2:PRTK2:9821:Montagem PTH:mesmo,3:PMOK:9820:Almoxarifado:mesmo | 1:1-5:3 | 1-5');
end $$;

\echo 'IGNORAR PRT: TODOS OS CASOS OK'
EOF
```

- [ ] **Step 2: Escrever o harness**

```bash
cat > supabase/tests/rodar-ignorar-prt-test.sh <<'EOF'
#!/usr/bin/env bash
# Testes SQL da 0199 (Nova OP: ignorar uma PRT; incluir de novo na edição) num Postgres descartável.
# Uso: supabase/tests/rodar-ignorar-prt-test.sh
# Monta o estado vigente como o rodar-prt-agrupar-test.sh (esquema mínimo da 0184 + Integração, a reserva real da 0132,
# 0153, 0184, 0194, 0066, a sf_cancelar_lancamento da 0165, 0195 e 0197), confere que a 0199 só ACRESCENTA linhas à
# sf_ordem_regravar_trechos da 0197, aplica a 0199 DUAS vezes (idempotência), roda a prova (ignorar_prt_test.sql), o
# rollback (duas vezes; devolve as funções ao texto da 0197 byte a byte) e a 0199 de novo.
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-ignorar-prt-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
TMPD=$(mktemp -d)
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true; rm -rf "$TMPD"' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 1
extrai() { # $1 = início da função, $2 = arquivo, $3 = linha que fecha, $4 = saída
  awk -v f="$1" -v fim="$3" '
    index($0, f) == 1 { dentro = 1 }
    dentro { print }
    dentro && $0 == fim { exit }' "$2" > "$4"
  [ -s "$4" ] || { echo "$1 não encontrada em $2"; exit 1; }
}
# ---------- a 0199 só acrescenta à sf_ordem_regravar_trechos da 0197 (nenhuma linha some nem muda) ----------
extrai "create or replace function public.sf_ordem_regravar_trechos(" supabase/migrations/0197_prt_apontamento_automatico.sql '$func$;' "$TMPD/rt-0197.sql"
extrai "create or replace function public.sf_ordem_regravar_trechos(" supabase/migrations/0199_ignorar_prt.sql '$func$;' "$TMPD/rt-0199.sql"
if diff "$TMPD/rt-0197.sql" "$TMPD/rt-0199.sql" | grep -q '^<'; then echo "a 0199 mudou linha da regravação da 0197"; exit 1; fi
[ "$(diff "$TMPD/rt-0197.sql" "$TMPD/rt-0199.sql" | grep -c '^>')" = 5 ] || { echo "a 0199 devia acrescentar 5 linhas à regravação"; exit 1; }

extrai "create or replace function public.sf_sn_na_faixa(" supabase/migrations/0129_sf_almoxarifado_entrada.sql 'end $func$;' "$TMPD/sf_sn_na_faixa.sql"
extrai "create or replace function public.sf_cancelar_lancamento(" supabase/migrations/0165_placas_almoxarifado.sql '$func$;' "$TMPD/cancelar.sql"
extrai "create or replace function public.sf_estoque_reservar(" supabase/migrations/0132_sf_estoque_envios.sql '$func$;' "$TMPD/reservar.sql"
for F in sf_sn_na_faixa cancelar reservar; do docker cp "$TMPD/$F.sql" "$NOME":/tmp/$F.sql; done
docker cp supabase/tests/estrutura_op_esquema.sql "$NOME":/tmp/esquema.sql
docker cp supabase/tests/receita_prt_esquema.sql "$NOME":/tmp/esquema-integracao.sql
for M in 0153_sf_estoque_enviado 0184_estrutura_op 0194_editar_op_trechos 0066_sf_integracoes_por_posto 0195_receita_integracao_prt 0197_prt_apontamento_automatico 0199_ignorar_prt; do
  docker cp "supabase/migrations/$M.sql" "$NOME":/tmp/"${M%%_*}".sql
done
docker cp supabase/tests/ignorar_prt_test.sql "$NOME":/tmp/teste.sql
docker cp docs/operacao/estrutura-op/rollback-0199.sql "$NOME":/tmp/rollback.sql
P() { docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
Q() { docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq "$@"; }
P -f /tmp/esquema.sql
P -f /tmp/esquema-integracao.sql
P -f /tmp/sf_sn_na_faixa.sql
P -c "revoke all on function public.sf_estoque_reservar(int) from public, anon, authenticated" \
  -c "drop function public.sf_estoque_reservar(int)"
P -1 -f /tmp/reservar.sql   # a reserva REAL da 0132 (a do esquema mínimo é uma cópia sem comentários)
P -c "revoke all on function public.sf_estoque_reservar(int) from public, anon, authenticated" \
  -c "grant execute on function public.sf_estoque_reservar(int) to service_role"
P -1 -f /tmp/0153.sql
P -1 -f /tmp/0184.sql
P -1 -f /tmp/0194.sql
P -1 -f /tmp/0066.sql
P -1 -f /tmp/cancelar.sql
P -1 -f /tmp/0195.sql
P -1 -f /tmp/0197.sql
DEFS="select string_agg(pg_get_functiondef(p.oid), E'\n' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('sf_cadastrar_op','sf_ordem_regravar_trechos','sf_trecho_enfileirar','sf_prt_agrupar')"
Q -c "$DEFS" > "$TMPD/defs-antes.txt"
P -1 -f /tmp/0199.sql
P -1 -f /tmp/0199.sql   # idempotente
Q -c "$DEFS" > "$TMPD/defs-0199.txt"
cmp -s "$TMPD/defs-antes.txt" "$TMPD/defs-0199.txt" && { echo "a 0199 não mudou a regravação"; exit 1; }
# só a sf_ordem_incluir_trechos é nova, e ninguém de fora a chama
Q -c "select has_function_privilege('authenticated', 'public.sf_ordem_incluir_trechos(uuid,text,text,jsonb)', 'execute')" | grep -qx f \
  || { echo "authenticated não pode executar a sf_ordem_incluir_trechos"; exit 1; }
P -f /tmp/teste.sql

P -1 -f /tmp/rollback.sql
P -1 -f /tmp/rollback.sql   # rollback idempotente
Q -c "$DEFS" > "$TMPD/defs-rollback.txt"
diff "$TMPD/defs-antes.txt" "$TMPD/defs-rollback.txt" || { echo "rollback não devolveu as funções da 0197"; exit 1; }
Q -c "select count(*) from pg_proc where proname = 'sf_ordem_incluir_trechos'" | grep -qx 0 || { echo "rollback não removeu a sf_ordem_incluir_trechos"; exit 1; }
P -1 -f /tmp/0199.sql   # volta depois do rollback
Q -c "$DEFS" > "$TMPD/defs-volta.txt"
diff "$TMPD/defs-0199.txt" "$TMPD/defs-volta.txt" || { echo "a 0199 depois do rollback ficou diferente"; exit 1; }
echo "IGNORAR PRT SQL OK"
EOF
chmod +x supabase/tests/rodar-ignorar-prt-test.sh
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `supabase/tests/rodar-ignorar-prt-test.sh`
Expected: FAIL (código de saída 2) — `awk: cannot open "supabase/migrations/0199_ignorar_prt.sql" (No such file or directory)`.

- [ ] **Step 4: Escrever a 0199 e o rollback**

O cabeçalho e a função nova vão escritos aqui; a `sf_ordem_regravar_trechos` é o texto EXATO da 0197 (extraído do arquivo) com 5 linhas acrescentadas logo depois da recusa `OP_SEM_TRECHOS` — o harness confere que nada mais mudou, e o rollback é o mesmo texto da 0197 sem as 5 linhas.

```bash
GERA=$(mktemp -d)
cat > "$GERA/cab-0199.sql" <<'EOF'
-- =============================================================
-- 0199: NOVA OP — IGNORAR UMA PRT. Spec: docs/superpowers/specs/2026-11-26-nova-op-ignorar-prt-design.md
--
-- PRT ignorada = não é trecho. O cadastro (sf_cadastrar_op, 0195) já aceita a cadeia sem uma PRT: ele não confere o
-- espelho do Compels (só seq único, uma PMO e ela com o maior seq) — quem conferia a cadeia inteira era a action, que
-- passa a aceitar a cadeia menos as PRTs ignoradas. Esta migração não muda o cadastro.
--
-- O que muda é a EDIÇÃO (sf_ordem_regravar_trechos, 0194 → 0195 → 0197): ela passa a aceitar INCLUIR DE NOVO uma PRT
-- da cadeia que ficou de fora. Na entrada, a PRT incluída é o item SEM seq, com codigo + compels_op; a ordem da entrada
-- é a ordem nova dos trechos. Só quando há item sem seq roda a sf_ordem_incluir_trechos (nova, interna), que:
--   1. confere a forma e os trechos gravados (todos, uma vez, na mesma ordem entre si) — TRECHOS_DIFERENTES;
--   2. a PMO continua o último — PMO_NAO_E_ULTIMO;
--   3. a PRT incluída desce da OP do Compels do trecho da PMO pelo espelho (sf_compels_ops, pela cadeia de mães, até
--      20 níveis, a mesma regra do trechosDoEspelho) e o código bate — PRT_INCLUIDA_FORA_DA_CADEIA:<codigo>;
--   4. o código ou a OP do Compels dela ainda não é trecho da OP (nem vem duas vezes) — PRT_INCLUIDA_REPETIDA:<codigo>;
--   5. nenhum posto dela tem registro (bipe) nesta OP — PRT_INCLUIDA_COM_REGISTROS:<codigo>;
--   6. renumera os trechos pela posição na entrada (sf_ordem_trechos.seq e o trecho_seq de sf_ordem_postos e
--      sf_ordem_faixas; o seq do trecho não é gravado em mais lugar nenhum — a fila de PRT liga pelo código), grava a
--      PRT incluída (tipo 'prt', série 'mesmo', estoque EINTER) e devolve a entrada com os seqs novos.
-- Depois disso a regravação segue o texto da 0197 sem mudança (rota, série, faixas, travas do histórico). Uma recusa
-- adiante desfaz a renumeração junto: é tudo uma transação. Sem item sem seq, nada disso roda: a edição de sempre é a
-- mesma, byte a byte de comportamento.
--
-- Apontamento automático (0197): sf_trecho_enfileirar e sf_prt_agrupar só leem sf_ordem_trechos (tipo 'prt'), então a
-- PRT ignorada nunca entra na fila; a incluída de novo entra dali em diante, como qualquer trecho.
--
-- Sem tabela nova (nada de RLS). ORDEM DE DEPLOY: migração ANTES do app. Rollback: docs/operacao/estrutura-op/rollback-0199.sql.
-- Idempotente (psql -1 -v ON_ERROR_STOP=1 -f).

-- ---------- sf_ordem_incluir_trechos: a PRT incluída de novo na edição (só a sf_ordem_regravar_trechos chama) ----------
create or replace function public.sf_ordem_incluir_trechos(p_ordem_id uuid, p_pmo text, p_op text, p_entrada jsonb)
returns jsonb language plpgsql security definer set search_path = public as $func$
declare
  v_n int;
  v_pmo_seq int;
  v_pmo_op text;
  v_rep text;
begin
  -- 1. forma: cada item é objeto; seq ausente/nulo/vazio = PRT incluída, senão um número
  if jsonb_typeof(p_entrada) is distinct from 'array'
     or exists (select 1 from jsonb_array_elements(p_entrada) x
                 where jsonb_typeof(x) <> 'object' or (coalesce(x->>'seq', '') <> '' and x->>'seq' !~ '^\d{1,9}$')) then
    raise exception 'TRECHOS_DIFERENTES';
  end if;
  -- os trechos gravados: todos, uma vez cada, e na mesma ordem entre si
  select count(*) into v_n from sf_ordem_trechos where ordem_id = p_ordem_id;
  if (select count(*) from jsonb_array_elements(p_entrada) x where coalesce(x->>'seq', '') <> '') <> v_n
     or (select count(distinct (x->>'seq')::int) from jsonb_array_elements(p_entrada) x where coalesce(x->>'seq', '') <> '') <> v_n
     or exists (select 1 from jsonb_array_elements(p_entrada) x
                 where coalesce(x->>'seq', '') <> ''
                   and not exists (select 1 from sf_ordem_trechos ot where ot.ordem_id = p_ordem_id and ot.seq = (x->>'seq')::int))
     or exists (select 1 from (select row_number() over (order by e.i) as nova, row_number() over (order by (e.x->>'seq')::int) as velha
                                 from jsonb_array_elements(p_entrada) with ordinality e(x, i)
                                where coalesce(e.x->>'seq', '') <> '') z
                 where z.nova <> z.velha) then
    raise exception 'TRECHOS_DIFERENTES';
  end if;
  -- 2. a PMO continua o último trecho
  select ot.seq, btrim(coalesce(ot.compels_op, '')) into v_pmo_seq, v_pmo_op
    from sf_ordem_trechos ot where ot.ordem_id = p_ordem_id and ot.tipo = 'pmo';
  if (select nullif(e.x->>'seq', '')::int from jsonb_array_elements(p_entrada) with ordinality e(x, i) order by e.i desc limit 1)
     is distinct from v_pmo_seq then
    raise exception 'PMO_NAO_E_ULTIMO';
  end if;
  -- 3. a PRT incluída é da cadeia do Compels desta OP: desce da OP da PMO pelo espelho, com o mesmo código
  select coalesce(nullif(btrim(coalesce(x->>'codigo', '')), ''), '?') into v_rep
    from jsonb_array_elements(p_entrada) with ordinality e(x, i)
   where coalesce(x->>'seq', '') = ''
     and case
           when coalesce(x->>'compels_op', '') !~ '^\s*\d{1,9}\s*$' or v_pmo_op !~ '^\d{1,9}$' then true
           when btrim(x->>'compels_op') = v_pmo_op then true
           else not exists (
             with recursive sobe(numero, mae, n) as (
               select c.numero, c.mae_numero, 0 from sf_compels_ops c
                where c.numero = btrim(x->>'compels_op')::int
                  and lower(btrim(c.codigo)) = lower(btrim(coalesce(x->>'codigo', '')))
               union all
               select c.numero, c.mae_numero, s.n + 1 from sobe s join sf_compels_ops c on c.numero = s.mae where s.n < 20
             )
             select 1 from sobe where sobe.mae = v_pmo_op::int)
         end
   order by i limit 1;
  if v_rep is not null then raise exception 'PRT_INCLUIDA_FORA_DA_CADEIA:%', v_rep; end if;
  -- 4. ainda fora da OP: nem o código nem a OP do Compels já são trecho dela, e não vem duas vezes
  select btrim(x->>'codigo') into v_rep
    from jsonb_array_elements(p_entrada) with ordinality e(x, i)
   where coalesce(x->>'seq', '') = ''
     and (exists (select 1 from sf_ordem_trechos ot
                   where ot.ordem_id = p_ordem_id
                     and (lower(btrim(ot.codigo)) = lower(btrim(x->>'codigo'))
                          or btrim(coalesce(ot.compels_op, '')) = btrim(x->>'compels_op')))
          or exists (select 1 from jsonb_array_elements(p_entrada) with ordinality f(y, j)
                      where f.j <> e.i and coalesce(y->>'seq', '') = ''
                        and (lower(btrim(y->>'codigo')) = lower(btrim(x->>'codigo'))
                             or btrim(y->>'compels_op') = btrim(x->>'compels_op'))))
   order by i limit 1;
  if v_rep is not null then raise exception 'PRT_INCLUIDA_REPETIDA:%', v_rep; end if;
  -- 5. sem bipe: nenhum posto da PRT incluída tem registro nesta OP
  select btrim(x->>'codigo') into v_rep
    from jsonb_array_elements(p_entrada) with ordinality e(x, i),
         jsonb_array_elements_text(case when jsonb_typeof(x->'postos') = 'array' then x->'postos' else '[]'::jsonb end) pp
   where coalesce(x->>'seq', '') = ''
     and exists (select 1 from sf_registros r where r.pmo = p_pmo and r.op = p_op and r.posto = btrim(pp))
   order by i limit 1;
  if v_rep is not null then raise exception 'PRT_INCLUIDA_COM_REGISTROS:%', v_rep; end if;

  -- 6. renumera pela posição na entrada (em dois passos: a PK (ordem_id, seq) não aceita troca no meio) e grava a PRT
  update sf_ordem_trechos set seq = seq + 100000 where ordem_id = p_ordem_id;
  update sf_ordem_trechos ot set seq = m.nova
    from (select (e.x->>'seq')::int as velha, e.i::int as nova
            from jsonb_array_elements(p_entrada) with ordinality e(x, i) where coalesce(e.x->>'seq', '') <> '') m
   where ot.ordem_id = p_ordem_id and ot.seq = m.velha + 100000;
  update sf_ordem_postos op2 set trecho_seq = m.nova
    from (select (e.x->>'seq')::int as velha, e.i::int as nova
            from jsonb_array_elements(p_entrada) with ordinality e(x, i) where coalesce(e.x->>'seq', '') <> '') m
   where op2.ordem_id = p_ordem_id and op2.trecho_seq = m.velha;
  update sf_ordem_faixas f set trecho_seq = m.nova
    from (select (e.x->>'seq')::int as velha, e.i::int as nova
            from jsonb_array_elements(p_entrada) with ordinality e(x, i) where coalesce(e.x->>'seq', '') <> '') m
   where f.ordem_id = p_ordem_id and f.trecho_seq = m.velha;
  -- posto_conclui fica vazio só até a regravação, logo adiante na mesma transação, gravar o último posto do trecho
  insert into sf_ordem_trechos (ordem_id, seq, codigo, tipo, posto_conclui, sn_modo, estoque, compels_op)
  select p_ordem_id, e.i::int, btrim(e.x->>'codigo'), 'prt', '', 'mesmo', 'EINTER', btrim(e.x->>'compels_op')
    from jsonb_array_elements(p_entrada) with ordinality e(x, i)
   where coalesce(e.x->>'seq', '') = '';
  return (select jsonb_agg(e.x || jsonb_build_object('seq', e.i) order by e.i)
            from jsonb_array_elements(p_entrada) with ordinality e(x, i));
end
$func$;
revoke all on function public.sf_ordem_incluir_trechos(uuid, text, text, jsonb) from public, anon, authenticated, service_role;

EOF
cat > "$GERA/cab-rollback.sql" <<'EOF'
-- Rollback da 0199 (ignorar PRT na Nova OP: incluir de novo na edição). Devolve a sf_ordem_regravar_trechos ao texto da
-- 0197 e apaga a sf_ordem_incluir_trechos.
--
-- O app que manda PRT incluída (item sem seq) tem que sair ANTES: sem a 0199, esse item cai em TRECHOS_DIFERENTES.
-- FICAM: as PRTs já incluídas de novo (são trechos comuns, com o seq que a renumeração deu) e as OPs cadastradas sem uma
-- PRT (o cadastro nunca mudou). Nada de dado é desfeito.
-- Idempotente: psql -1 -v ON_ERROR_STOP=1 -f docs/operacao/estrutura-op/rollback-0199.sql

EOF
cat > "$GERA/gerar.py" <<'EOF'
import sys
raiz, cab_mig, cab_rb, saida_mig, saida_rb = sys.argv[1:6]
fonte = open(f'{raiz}/supabase/migrations/0197_prt_apontamento_automatico.sql', encoding='utf-8').read()
ini = fonte.index('-- ---------- sf_ordem_regravar_trechos: o texto da 0195;')
fim_txt = 'grant execute on function public.sf_ordem_regravar_trechos(uuid, jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;\n'
fim = fonte.index(fim_txt, ini) + len(fim_txt)
_, resto = fonte[ini:fim].split('\n', 1)
# migração: o texto da 0197 + as 5 linhas da PRT incluída, logo depois da recusa OP_SEM_TRECHOS
alvo = "  if not exists (select 1 from sf_ordem_trechos where ordem_id = p_ordem_id) then raise exception 'OP_SEM_TRECHOS'; end if;\n"
assert resto.count(alvo) == 1
bloco = (
    "  -- 0199: PRT INCLUÍDA DE NOVO (item sem seq): entra e os trechos são renumerados pela ordem da entrada ANTES de tudo\n"
    "  -- abaixo, que segue igual (uma recusa adiante desfaz a renumeração junto)\n"
    "  if exists (select 1 from jsonb_array_elements(v_entrada) x where jsonb_typeof(x) = 'object' and coalesce(x->>'seq', '') = '') then\n"
    "    v_entrada := sf_ordem_incluir_trechos(p_ordem_id, v_pmo, v_op, v_entrada);\n"
    "  end if;\n"
)
mig = (open(cab_mig, encoding='utf-8').read()
       + '-- ---------- sf_ordem_regravar_trechos: o texto da 0197 + a PRT incluída de novo (item sem seq) ----------\n'
       + resto.replace(alvo, alvo + bloco, 1)
       + "\nnotify pgrst, 'reload schema';\n")
open(saida_mig, 'w', encoding='utf-8').write(mig)
rb = (open(cab_rb, encoding='utf-8').read()
      + '-- ---------- sf_ordem_regravar_trechos: o texto da 0197 ----------\n'
      + resto
      + "\ndrop function if exists public.sf_ordem_incluir_trechos(uuid, text, text, jsonb);\n"
      + "\nnotify pgrst, 'reload schema';\n")
open(saida_rb, 'w', encoding='utf-8').write(rb)
EOF
python3 "$GERA/gerar.py" "$PWD" "$GERA/cab-0199.sql" "$GERA/cab-rollback.sql" \
  supabase/migrations/0199_ignorar_prt.sql docs/operacao/estrutura-op/rollback-0199.sql
rm -rf "$GERA"
tail -n 1 supabase/migrations/0199_ignorar_prt.sql
grep -n "0199: PRT INCLUÍDA DE NOVO" supabase/migrations/0199_ignorar_prt.sql
```

Expected: a última linha impressa é `notify pgrst, 'reload schema';` e o `grep` acha 1 linha (dentro da `sf_ordem_regravar_trechos`, logo depois de `OP_SEM_TRECHOS`).

- [ ] **Step 5: Rodar e ver passar**

Run: `supabase/tests/rodar-ignorar-prt-test.sh`
Expected: termina com
```
IGNORAR PRT: TODOS OS CASOS OK
...
IGNORAR PRT SQL OK
```
(os `NOTICE` de `does not exist, skipping` são esperados).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0199_ignorar_prt.sql docs/operacao/estrutura-op/rollback-0199.sql supabase/tests/ignorar_prt_test.sql supabase/tests/rodar-ignorar-prt-test.sh
git commit -m "$(cat <<'EOF'
feat(op): edição inclui de novo a PRT que ficou fora da OP (0199)

sf_ordem_regravar_trechos (texto da 0197 + 5 linhas) aceita item sem seq: a
sf_ordem_incluir_trechos confere a cadeia no espelho, recusa bipe nos postos,
renumera os trechos e grava a PRT. O cadastro não muda (já aceita a cadeia
sem uma PRT). Harness rodar-ignorar-prt-test.sh e rollback-0199.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Domínio do cadastro — ignorar, desfazer, envio e conferência da cadeia

**Files:**
- Modify: `src/modules/shopfloor/domain/cadastro-op.ts` (tipos `TrechoCadastro` e `CadastroOp`; funções novas depois de `rotuloTrecho`)
- Test: `src/modules/shopfloor/domain/__tests__/cadastro-op-ignorar.test.ts` (novo)

**Interfaces:**
- Consumes: `trechosDoEspelho`, `distribuirPostos`, `rotuloTrecho`, `norm` (privada) de `cadastro-op.ts`.
- Produces (todos exportados de `@/modules/shopfloor/domain/cadastro-op`):
  - `type ModoIgnorar = 'tirar' | 'manter'`
  - `const ESCOLHA_IGNORAR: Record<ModoIgnorar, string>` = `{ tirar: 'Tirar os postos da rota', manter: 'Manter os postos na rota da OP' }`
  - `interface PrtIgnorada { trecho: TrechoCadastro; modo: ModoIgnorar }`
  - `interface PrtIgnoradaEnvio { codigo: string; compelsOp: string | null; modo: ModoIgnorar }`
  - `TrechoCadastro.incluida?: boolean`; `CadastroOp.ignoradas?: PrtIgnoradaEnvio[]`
  - `chaveTrecho(t: { codigo: string; compelsOp: string | null }): string`
  - `ignorarPrt(trechos: TrechoCadastro[], seq: number, modo: ModoIgnorar): { trechos: TrechoCadastro[]; ignorada: PrtIgnorada } | null`
  - `desfazerIgnorar(trechos: TrechoCadastro[], ignorada: PrtIgnorada): TrechoCadastro[]`
  - `trechosParaEnviar(trechos: TrechoCadastro[]): TrechoCadastro[]`
  - `ignoradasParaEnviar(ignoradas: PrtIgnorada[]): PrtIgnoradaEnvio[]`
  - `erroCadeiaCompels(esperado: TrechoCadastro[], trechos: TrechoCadastro[], ignoradas: PrtIgnoradaEnvio[]): string | null`
  - `resumoIgnoradas(ignoradas: PrtIgnoradaEnvio[]): string | null`

- [ ] **Step 1: Preparar o worktree para rodar testes (só se faltar `node_modules`)**

```bash
[ -e node_modules ] || cp -al "/home/rwtech/Área de trabalho/ShopFloor/node_modules" node_modules
ls -ld node_modules
```

Expected: `drwx…` (diretório real, não symlink `l` — o `next build` não roda com symlink).

- [ ] **Step 2: Escrever o teste que falha**

```bash
cat > src/modules/shopfloor/domain/__tests__/cadastro-op-ignorar.test.ts <<'EOF'
import { describe, expect, it } from 'vitest'
import {
  desfazerIgnorar, distribuirPostos, erroCadeiaCompels, ignoradasParaEnviar, ignorarPrt, resumoIgnoradas,
  trechosDoEspelho, trechosParaEnviar, type OpEspelho, type TrechoCadastro,
} from '../cadastro-op'

const op = (numero: number, codigo: string, nivel: number, mae: number | null): OpEspelho => ({
  numero, idCompels: numero, codigo, descricao: `${codigo} desc`, situacao: 'Em Processo', nivel, quantidade: 10,
  quantidadeProduzida: 0, maeNumero: mae, principalNumero: null, cliente: 'C01', dataDocumento: '2026-11-10',
  ativa: true, lidoEm: '2026-11-18T13:00:00Z',
})
const ESPELHO = [op(8498, 'PMOC14', 1, null), op(8499, 'PRT420', 2, 8498), op(8500, 'PRT410', 3, 8499)]
const ESPERADO = trechosDoEspelho(ESPELHO[0]!, ESPELHO)
// PRT410 (seq 1) = SPI, AOI · PRT420 (seq 2) = PTH · PMOC14 (seq 3) = Teste, Almoxarifado
const T: TrechoCadastro[] = distribuirPostos(ESPERADO, [
  { posto: 'SPI', trechoCodigo: 'PRT410' }, { posto: 'AOI', trechoCodigo: 'PRT410' },
  { posto: 'PTH', trechoCodigo: 'PRT420' }, { posto: 'Teste', trechoCodigo: null }, { posto: 'Almoxarifado', trechoCodigo: null },
], 'Almoxarifado')
const postos = (ts: TrechoCadastro[]) => ts.map((t) => [t.codigo, t.postos])

describe('ignorarPrt', () => {
  it('a PMO nunca é ignorada (nem seq que não existe)', () => {
    expect(ignorarPrt(T, 3, 'tirar')).toBeNull()
    expect(ignorarPrt(T, 3, 'manter')).toBeNull()
    expect(ignorarPrt(T, 9, 'tirar')).toBeNull()
  })
  it('"tirar": a PRT e os postos dela saem da rota', () => {
    const r = ignorarPrt(T, 1, 'tirar')!
    expect(postos(r.trechos)).toEqual([['PRT420', ['PTH']], ['PMOC14', ['Teste', 'Almoxarifado']]])
    expect(r.ignorada).toEqual({ trecho: T[0], modo: 'tirar' })
  })
  it('"manter": os postos vão para o começo do trecho seguinte, na mesma ordem', () => {
    expect(postos(ignorarPrt(T, 1, 'manter')!.trechos)).toEqual([['PRT420', ['SPI', 'AOI', 'PTH']], ['PMOC14', ['Teste', 'Almoxarifado']]])
  })
  it('"manter" na última PRT antes da PMO: os postos vão para a PMO', () => {
    expect(postos(ignorarPrt(T, 2, 'manter')!.trechos)).toEqual([['PRT410', ['SPI', 'AOI']], ['PMOC14', ['PTH', 'Teste', 'Almoxarifado']]])
  })
})

describe('desfazerIgnorar', () => {
  it('devolve o estado anterior, nos dois modos', () => {
    for (const modo of ['tirar', 'manter'] as const) {
      for (const seq of [1, 2]) {
        const r = ignorarPrt(T, seq, modo)!
        expect(desfazerIgnorar(r.trechos, r.ignorada)).toEqual(T)
      }
    }
  })
  it('duas ignoradas, desfeitas na ordem inversa: volta ao começo', () => {
    const a = ignorarPrt(T, 1, 'manter')!
    const b = ignorarPrt(a.trechos, 2, 'manter')!
    expect(postos(b.trechos)).toEqual([['PMOC14', ['SPI', 'AOI', 'PTH', 'Teste', 'Almoxarifado']]])
    expect(desfazerIgnorar(desfazerIgnorar(b.trechos, b.ignorada), a.ignorada)).toEqual(T)
  })
  it('a PRT que já está nos trechos não entra de novo', () => {
    const r = ignorarPrt(T, 1, 'tirar')!
    expect(desfazerIgnorar(T, r.ignorada)).toBe(T)
  })
})

describe('envio', () => {
  it('seq renumerado sem buraco; sem ignorada, os mesmos objetos', () => {
    const r = ignorarPrt(T, 1, 'tirar')!
    expect(trechosParaEnviar(r.trechos).map((t) => [t.seq, t.codigo])).toEqual([[1, 'PRT420'], [2, 'PMOC14']])
    expect(trechosParaEnviar(T)).toEqual(T)
    expect(ignoradasParaEnviar([r.ignorada])).toEqual([{ codigo: 'PRT410', compelsOp: '8500', modo: 'tirar' }])
  })
})

describe('erroCadeiaCompels', () => {
  const NAO_BATE = 'Os trechos não batem com o Compels. Recarregue a página e escolha a OP de novo.'
  const sem = (seq: number) => trechosParaEnviar(ignorarPrt(T, seq, 'manter')!.trechos)
  it('a cadeia inteira bate (como antes)', () => {
    expect(erroCadeiaCompels(ESPERADO, T, [])).toBeNull()
  })
  it('a cadeia sem uma PRT bate quando ela vem nas ignoradas', () => {
    expect(erroCadeiaCompels(ESPERADO, sem(2), [{ codigo: 'PRT420', compelsOp: '8499', modo: 'manter' }])).toBeNull()
    expect(erroCadeiaCompels(ESPERADO, sem(1), [{ codigo: 'PRT410', compelsOp: '8500', modo: 'tirar' }])).toBeNull()
  })
  it('faltar PRT sem dizer que foi ignorada, ou ignorar a que está nos trechos: não bate', () => {
    expect(erroCadeiaCompels(ESPERADO, sem(2), [])).toBe(NAO_BATE)
    expect(erroCadeiaCompels(ESPERADO, T, [{ codigo: 'PRT420', compelsOp: '8499', modo: 'manter' }])).toBe(NAO_BATE)
  })
  it('a PMO não pode ser ignorada', () => {
    expect(erroCadeiaCompels(ESPERADO, sem(2), [{ codigo: 'PMOC14', compelsOp: '8498', modo: 'tirar' }])).toBe('A OP da PMO não pode ser ignorada.')
  })
  it('ignorada fora da cadeia, repetida ou com escolha inválida: não bate', () => {
    const ig = { codigo: 'PRT420', compelsOp: '8499', modo: 'manter' as const }
    expect(erroCadeiaCompels(ESPERADO, sem(2), [ig, { codigo: 'PRT999', compelsOp: '9999', modo: 'tirar' }])).toBe(NAO_BATE)
    expect(erroCadeiaCompels(ESPERADO, sem(2), [ig, ig])).toBe(NAO_BATE)
    expect(erroCadeiaCompels(ESPERADO, sem(2), [{ ...ig, modo: 'outro' as never }])).toBe(NAO_BATE)
  })
  it('seq com buraco (não renumerado): não bate', () => {
    expect(erroCadeiaCompels(ESPERADO, ignorarPrt(T, 1, 'tirar')!.trechos, [{ codigo: 'PRT410', compelsOp: '8500', modo: 'tirar' }])).toBe(NAO_BATE)
  })
})

describe('resumoIgnoradas', () => {
  it('a linha do log: qual PRT e a escolha', () => {
    expect(resumoIgnoradas([])).toBeNull()
    expect(resumoIgnoradas([{ codigo: 'PRT420', compelsOp: '8499', modo: 'manter' }]))
      .toBe('PRT ignorada: PRT420 (8499) — Manter os postos na rota da OP')
    expect(resumoIgnoradas([{ codigo: 'PRT410', compelsOp: '8500', modo: 'tirar' }, { codigo: 'PRT420', compelsOp: '8499', modo: 'manter' }]))
      .toBe('PRTs ignoradas: PRT410 (8500) — Tirar os postos da rota; PRT420 (8499) — Manter os postos na rota da OP')
  })
})
EOF
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/modules/shopfloor/domain/__tests__/cadastro-op-ignorar.test.ts --maxWorkers=2`
Expected: FAIL — `ignorarPrt is not a function` (e as demais funções novas).

- [ ] **Step 4: Implementar no domínio**

Em `src/modules/shopfloor/domain/cadastro-op.ts`, troque o fim da interface `TrechoCadastro`:

```ts
  /** PMO: as faixas da OP. PRT: só com série própria (com 'mesmo' é ignorada). */
  faixas: FaixaSN[]
}
```

por:

```ts
  /** PMO: as faixas da OP. PRT: só com série própria (com 'mesmo' é ignorada). */
  faixas: FaixaSN[]
  /** Edição: PRT da cadeia incluída de novo nesta edição, ainda não gravada (seq < 0 só enquanto está na tela). */
  incluida?: boolean
}
```

Troque o fim da interface `CadastroOp` (e o começo de `PmoDoEspelho`):

```ts
  componentes: { posto: string; pmo: string }[]
  burnin: { posto: string; tempo_min: number }[]
}

export interface PmoDoEspelho
```

por:

```ts
  componentes: { posto: string; pmo: string }[]
  burnin: { posto: string; tempo_min: number }[]
  /** PRTs da cadeia do Compels que ficaram fora da OP (não são trecho) e a escolha de cada uma. */
  ignoradas?: PrtIgnoradaEnvio[]
}

/** Ignorar uma PRT: 'tirar' = os postos dela saem da rota; 'manter' = vão para o começo do trecho seguinte. */
export type ModoIgnorar = 'tirar' | 'manter'

/** A escolha como aparece nos botões, na lista de ignoradas e no log. */
export const ESCOLHA_IGNORAR: Record<ModoIgnorar, string> = {
  tirar: 'Tirar os postos da rota',
  manter: 'Manter os postos na rota da OP',
}

/** Uma PRT ignorada na tela: o trecho como estava (para o Desfazer) e a escolha. */
export interface PrtIgnorada { trecho: TrechoCadastro; modo: ModoIgnorar }

/** O que vai para o servidor (e para o log) de cada PRT ignorada. */
export interface PrtIgnoradaEnvio { codigo: string; compelsOp: string | null; modo: ModoIgnorar }

export interface PmoDoEspelho
```

E logo DEPOIS da função `rotuloTrecho` (que termina em `return t.compelsOp ? \`${t.codigo} (${t.compelsOp})\` : t.codigo` + `}`), acrescente:

```ts

/** A identidade de um trecho na cadeia do Compels: o código (aparado, maiúsculo) e a OP do Compels. */
export function chaveTrecho(t: { codigo: string; compelsOp: string | null }): string {
  return `${norm(t.codigo)}|${t.compelsOp ?? ''}`
}

/**
 * Ignora a PRT de `seq`: ela deixa de ser trecho. 'tirar' some com os postos dela; 'manter' os põe no COMEÇO do trecho
 * seguinte (a ordem da rota não muda; a última PRT antes da PMO passa os postos para a PMO). A PMO nunca: null.
 */
export function ignorarPrt(
  trechos: TrechoCadastro[], seq: number, modo: ModoIgnorar,
): { trechos: TrechoCadastro[]; ignorada: PrtIgnorada } | null {
  const i = trechos.findIndex((t) => t.seq === seq)
  const t = trechos[i]
  if (!t || t.tipo !== 'prt' || i === trechos.length - 1) return null
  const resto = trechos.filter((_, k) => k !== i)
  const novos = modo === 'manter'
    ? resto.map((x, k) => (k === i ? { ...x, postos: [...t.postos, ...x.postos] } : x))
    : resto
  return { trechos: novos, ignorada: { trecho: t, modo } }
}

/**
 * Desfaz o "ignorar": a PRT volta a ser trecho, no lugar dela na cadeia (pelo seq da tela), com os postos que tinha —
 * tirados de onde estiverem agora. Já presente: igual.
 */
export function desfazerIgnorar(trechos: TrechoCadastro[], ignorada: PrtIgnorada): TrechoCadastro[] {
  const volta = ignorada.trecho
  if (trechos.some((t) => t.seq === volta.seq)) return trechos
  const dela = new Set(volta.postos)
  const sem = trechos.map((t) => (t.postos.some((p) => dela.has(p)) ? { ...t, postos: t.postos.filter((p) => !dela.has(p)) } : t))
  const k = sem.findIndex((t) => t.seq > volta.seq)
  const at = k < 0 ? sem.length : k
  return [...sem.slice(0, at), volta, ...sem.slice(at)]
}

/** Os trechos como vão para o servidor: seq renumerado 1..n na ordem da rota, sem buraco das PRTs ignoradas. */
export function trechosParaEnviar(trechos: TrechoCadastro[]): TrechoCadastro[] {
  return trechos.map((t, i) => (t.seq === i + 1 ? t : { ...t, seq: i + 1 }))
}

export function ignoradasParaEnviar(ignoradas: PrtIgnorada[]): PrtIgnoradaEnvio[] {
  return ignoradas.map((i) => ({ codigo: i.trecho.codigo, compelsOp: i.trecho.compelsOp, modo: i.modo }))
}

/**
 * O cadastro no modo Compels confere a cadeia: os trechos são os do espelho (`esperado`, de trechosDoEspelho) menos as
 * PRTs ignoradas, na mesma ordem, com seq 1..n. Ignorada só PRT da cadeia, uma vez, com escolha válida. null = bate.
 */
export function erroCadeiaCompels(
  esperado: TrechoCadastro[], trechos: TrechoCadastro[], ignoradas: PrtIgnoradaEnvio[],
): string | null {
  const NAO_BATE = 'Os trechos não batem com o Compels. Recarregue a página e escolha a OP de novo.'
  const pmo = esperado.find((t) => t.tipo === 'pmo')
  if (pmo && ignoradas.some((i) => chaveTrecho(i) === chaveTrecho(pmo))) return 'A OP da PMO não pode ser ignorada.'
  const fora = new Set(ignoradas.map(chaveTrecho))
  if (fora.size !== ignoradas.length) return NAO_BATE
  for (const i of ignoradas) {
    if (i.modo !== 'tirar' && i.modo !== 'manter') return NAO_BATE
    if (!esperado.some((e) => e.tipo === 'prt' && chaveTrecho(e) === chaveTrecho(i))) return NAO_BATE
  }
  const restantes = esperado.filter((e) => !fora.has(chaveTrecho(e)))
  const bate = restantes.length === trechos.length && restantes.every((e, i) => {
    const t = trechos[i]!
    return e.codigo === t.codigo && e.compelsOp === t.compelsOp && e.tipo === t.tipo && t.seq === i + 1
  })
  return bate ? null : NAO_BATE
}

/** A linha do log do cadastro com as PRTs ignoradas e a escolha de cada uma; null sem ignorada. */
export function resumoIgnoradas(ignoradas: PrtIgnoradaEnvio[]): string | null {
  if (ignoradas.length === 0) return null
  const itens = ignoradas.map((i) => `${rotuloTrecho(i)} — ${ESCOLHA_IGNORAR[i.modo]}`)
  return `${ignoradas.length === 1 ? 'PRT ignorada' : 'PRTs ignoradas'}: ${itens.join('; ')}`
}
```

- [ ] **Step 5: Rodar e ver passar (com o teste antigo do domínio junto)**

Run: `npx vitest run src/modules/shopfloor/domain/__tests__/cadastro-op-ignorar.test.ts src/modules/shopfloor/domain/__tests__/cadastro-op.test.ts --maxWorkers=2`
Expected: PASS — `Test Files 2 passed`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/shopfloor/domain/cadastro-op.ts src/modules/shopfloor/domain/__tests__/cadastro-op-ignorar.test.ts
git commit -m "$(cat <<'EOF'
feat(op): domínio para ignorar PRT na Nova OP (tirar/manter, desfazer, envio)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Cadastro no servidor — aceitar a cadeia menos as ignoradas e registrar no log

**Files:**
- Modify: `src/modules/shopfloor/application/cadastro-op-actions.ts` (import; conferência `bate`; `registrarLog`)
- Test: `src/modules/shopfloor/application/__tests__/cadastro-op-actions.test.ts` (acrescentar `describe` no fim)

**Interfaces:**
- Consumes (Task 2): `erroCadeiaCompels`, `resumoIgnoradas`, `type PrtIgnoradaEnvio`, `CadastroOp.ignoradas`.
- Produces: `cadastrarOpAction(c: CadastroOp)` aceita `c.ignoradas`; log `acao: 'criar'` com `descricao` terminando em `· PRT ignorada: <rótulo> — <escolha>` e `dados.prtsIgnoradas: { codigo, compelsOp, modo }[]`.

- [ ] **Step 1: Escrever o teste que falha** (acrescente ao FIM do arquivo)

```bash
cat >> src/modules/shopfloor/application/__tests__/cadastro-op-actions.test.ts <<'EOF'

describe('cadastrarOpAction com PRT ignorada', () => {
  // cadeia PRT410 (nível 3) → PRT420 (nível 2) → PMOC14
  const CADEIA = [op(8498, 'PMOC14', 1, null), op(8499, 'PRT420', 2, 8498), op(8500, 'PRT410', 3, 8499)]
  const sem420 = (over: Partial<CadastroOp> = {}): CadastroOp => cad({
    trechos: [
      { seq: 1, codigo: 'PRT410', tipo: 'prt', compelsOp: '8500', descricao: '', quantidade: 10, situacao: '', snModo: 'mesmo', postos: ['SPI'], faixas: [] },
      { seq: 2, codigo: 'PMOC14', tipo: 'pmo', compelsOp: '8498', descricao: '', quantidade: 10, situacao: '', snModo: 'mesmo', postos: ['Inspeção PTH', 'Teste'], faixas: [{ sn_ini: '1001', sn_fim: '1010' }] },
    ],
    componentes: [], burnin: [],
    ignoradas: [{ codigo: 'PRT420', compelsOp: '8499', modo: 'manter' }],
    ...over,
  })
  beforeEach(() => { m.listarEspelho.mockResolvedValue(CADEIA) })

  it('grava a cadeia sem a PRT ignorada e registra no log qual PRT e a escolha', async () => {
    expect(await cadastrarOpAction(sem420())).toEqual({ ok: true, id: 'uuid-1', pmo: 'PMOC14', op: '8498' })
    expect(m.cadastrarOp.mock.calls[0]![0].trechos.map((t) => [t.seq, t.codigo])).toEqual([[1, 'PRT410'], [2, 'PMOC14']])
    expect(m.registrarLog).toHaveBeenCalledWith(expect.objectContaining({
      acao: 'criar',
      descricao: 'OP PMOC14/8498 criada (compels) · PRT ignorada: PRT420 (8499) — Manter os postos na rota da OP',
      dados: expect.objectContaining({ prtsIgnoradas: [{ codigo: 'PRT420', compelsOp: '8499', modo: 'manter' }] }),
    }))
  })
  it('a PRT que falta sem estar nas ignoradas continua recusada', async () => {
    expect(await cadastrarOpAction(sem420({ ignoradas: [] }))).toEqual({ ok: false, erro: 'Os trechos não batem com o Compels. Recarregue a página e escolha a OP de novo.' })
    expect(m.cadastrarOp).not.toHaveBeenCalled()
  })
  it('a PMO não pode ser ignorada', async () => {
    const r = await cadastrarOpAction(sem420({ ignoradas: [{ codigo: 'PRT420', compelsOp: '8499', modo: 'manter' }, { codigo: 'PMOC14', compelsOp: '8498', modo: 'tirar' }] }))
    expect(r).toEqual({ ok: false, erro: 'A OP da PMO não pode ser ignorada.' })
    expect(m.cadastrarOp).not.toHaveBeenCalled()
  })
  it('cadastro manual não tem PRT para ignorar', async () => {
    const manual = cad({
      modo: 'manual', pmo: 'PMOZ', op: '9000',
      trechos: [{ seq: 1, codigo: 'PMOZ', tipo: 'pmo', compelsOp: null, descricao: '', quantidade: null, situacao: '', snModo: 'mesmo', postos: ['Teste'], faixas: [{ sn_ini: '1', sn_fim: '10' }] }],
      componentes: [], burnin: [],
      ignoradas: [{ codigo: 'PRT420', compelsOp: '8499', modo: 'tirar' }],
    })
    expect(await cadastrarOpAction(manual)).toEqual({ ok: false, erro: 'Cadastro manual tem um trecho só, sem OP do Compels.' })
  })
})
EOF
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/shopfloor/application/__tests__/cadastro-op-actions.test.ts --maxWorkers=2`
Expected: FAIL — "grava a cadeia sem a PRT ignorada…" recebe `{ ok: false, erro: 'Os trechos não batem com o Compels…' }`; "a PMO não pode ser ignorada" e "cadastro manual…" também falham.

- [ ] **Step 3: Implementar**

Em `src/modules/shopfloor/application/cadastro-op-actions.ts`, troque:

```ts
import { erroSufixoOp, fixarAlmoxarifado, trechosDoEspelho, validarCadastro, type CadastroOp, type UltimaOp } from '../domain/cadastro-op'
```

por:

```ts
import {
  erroCadeiaCompels, erroSufixoOp, fixarAlmoxarifado, resumoIgnoradas, trechosDoEspelho, validarCadastro,
  type CadastroOp, type PrtIgnoradaEnvio, type UltimaOp,
} from '../domain/cadastro-op'
```

Troque:

```ts
  if (c.modo === 'compels') {
```

por:

```ts
  // PRTs da cadeia que ficam fora da OP (não são trecho): conferidas contra o espelho abaixo, como os trechos
  const ignoradas: PrtIgnoradaEnvio[] = Array.isArray(c.ignoradas) ? c.ignoradas : []

  if (c.modo === 'compels') {
```

Troque:

```ts
    const bate = esperado.length === trechos.length &&
      esperado.every((t, i) => t.codigo === trechos[i]!.codigo && t.compelsOp === trechos[i]!.compelsOp &&
        t.seq === trechos[i]!.seq && t.tipo === trechos[i]!.tipo)
    if (!bate) return { ok: false, erro: 'Os trechos não batem com o Compels. Recarregue a página e escolha a OP de novo.' }
  } else if (trechos.length !== 1 || trechos[0]!.tipo !== 'pmo' || trechos[0]!.compelsOp !== null) {
```

por:

```ts
    const erroCadeia = erroCadeiaCompels(esperado, trechos, ignoradas)
    if (erroCadeia) return { ok: false, erro: erroCadeia }
  } else if (trechos.length !== 1 || trechos[0]!.tipo !== 'pmo' || trechos[0]!.compelsOp !== null || ignoradas.length > 0) {
```

Troque:

```ts
  await registrarLog({
    entidade: 'sf_ordem', entidadeId: id, acao: 'criar', descricao: `OP ${limpo.pmo}/${limpo.op} criada (${limpo.modo})`,
    dados: { modo: limpo.modo, trechos: limpo.trechos.map((t) => ({ codigo: t.codigo, compelsOp: t.compelsOp, snModo: t.snModo, postos: t.postos, faixas: t.faixas })) },
  })
```

por:

```ts
  // a decisão de ignorar fica no log da OP (quem e quando o log já grava): qual PRT e tirar/manter os postos
  const linhaIgnoradas = resumoIgnoradas(ignoradas)
  await registrarLog({
    entidade: 'sf_ordem', entidadeId: id, acao: 'criar',
    descricao: `OP ${limpo.pmo}/${limpo.op} criada (${limpo.modo})${linhaIgnoradas ? ` · ${linhaIgnoradas}` : ''}`,
    dados: {
      modo: limpo.modo,
      trechos: limpo.trechos.map((t) => ({ codigo: t.codigo, compelsOp: t.compelsOp, snModo: t.snModo, postos: t.postos, faixas: t.faixas })),
      prtsIgnoradas: ignoradas.map((i) => ({ codigo: i.codigo, compelsOp: i.compelsOp, modo: i.modo })),
    },
  })
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/shopfloor/application/__tests__/cadastro-op-actions.test.ts --maxWorkers=2`
Expected: PASS — `Tests 18 passed` (14 antigos + 4 novos).

- [ ] **Step 5: Commit**

```bash
git add src/modules/shopfloor/application/cadastro-op-actions.ts src/modules/shopfloor/application/__tests__/cadastro-op-actions.test.ts
git commit -m "$(cat <<'EOF'
feat(op): cadastro aceita a cadeia do Compels menos as PRTs ignoradas e registra no log

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Tela da Nova OP — "Ignorar esta PRT", lista das ignoradas com Desfazer, envio

**Files:**
- Create: `src/app/(app)/shopfloor/ordens/ignorar-prt.tsx`
- Modify: `src/app/(app)/shopfloor/ordens/nova/nova-op-cliente.tsx`
- Test: `src/app/(app)/shopfloor/ordens/nova/__tests__/nova-op-ignorar-prt.test.tsx` (novo)

**Interfaces:**
- Consumes (Task 2): `ignorarPrt`, `desfazerIgnorar`, `trechosParaEnviar`, `ignoradasParaEnviar`, `ESCOLHA_IGNORAR`, `rotuloTrecho`, tipos `ModoIgnorar`, `PrtIgnorada`, `TrechoCadastro`. `CorrenteTrechos` (prop existente `situacao?: (t) => ReactNode`, bloco no cabeçalho do trecho).
- Produces (de `src/app/(app)/shopfloor/ordens/ignorar-prt.tsx`):
  - `IgnorarPrt({ t, aoIgnorar }: { t: TrechoCadastro; aoIgnorar: (seq: number, modo: ModoIgnorar) => void })`
  - `PrtsIgnoradas({ ignoradas, aoDesfazer }: { ignoradas: PrtIgnorada[]; aoDesfazer: (ig: PrtIgnorada) => void })` — `<ul aria-label="PRTs ignoradas">`, botão `aria-label="Desfazer: <rótulo>"`.
  - (a Task 7 acrescenta `PrtsForaDaOp` neste arquivo)

- [ ] **Step 1: Escrever o teste que falha**

```bash
cat > "src/app/(app)/shopfloor/ordens/nova/__tests__/nova-op-ignorar-prt.test.tsx" <<'EOF'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { OpEspelho } from '@/modules/shopfloor/domain/cadastro-op'

vi.mock('server-only', () => ({}))
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
const acoes = vi.hoisted(() => ({ cadastrarOpAction: vi.fn(), ultimaOpDaPmoAction: vi.fn() }))
vi.mock('@/modules/shopfloor/application/cadastro-op-actions', () => acoes)
vi.mock('@/modules/shopfloor/application/ordens-actions', () => ({ criarOrdemAction: vi.fn(), editarOrdemAction: vi.fn(), opTemRegistrosAction: vi.fn() }))
vi.mock('@/modules/shopfloor/application/padroes-fluxo-actions', () => ({ salvarPadraoAction: vi.fn(), excluirPadraoAction: vi.fn() }))

const { NovaOpCliente } = await import('../nova-op-cliente')

const op = (numero: number, codigo: string, nivel: number, mae: number | null): OpEspelho => ({
  numero, idCompels: numero, codigo, descricao: codigo === 'PMOC14' ? 'PLACA X' : 'PARTES', situacao: 'Em Processo', nivel,
  quantidade: 10, quantidadeProduzida: 0, maeNumero: mae, principalNumero: null, cliente: 'CLIENTE COMPELS', dataDocumento: '2026-11-10',
  ativa: true, lidoEm: '2026-11-18T13:00:00Z',
})
const ESPELHO = [op(8498, 'PMOC14', 1, null), op(8499, 'PRT420', 2, 8498), op(8500, 'PRT410', 3, 8499)]
const POSTOS = ['SPI', 'Inspeção AOI TOP', 'Inspeção PTH', 'Teste', 'Almoxarifado']
const PERFIS = { Almoxarifado: { recurso: 'almoxarifado' } } as never

beforeEach(() => {
  vi.clearAllMocks()
  acoes.ultimaOpDaPmoAction.mockResolvedValue({ ok: true, ultima: {
    op: '8476', cliente: 'LINCE', descricao: 'PLACA X', placasPorPainel: 1, embalagemIndividual: false,
    postos: [
      { posto: 'SPI', trechoCodigo: 'PRT410' }, { posto: 'Inspeção AOI TOP', trechoCodigo: 'PRT410' },
      { posto: 'Inspeção PTH', trechoCodigo: 'PRT420' }, { posto: 'Teste', trechoCodigo: null }, { posto: 'Almoxarifado', trechoCodigo: null },
    ],
    componentes: [], burnin: [],
  } })
  acoes.cadastrarOpAction.mockResolvedValue({ ok: true, id: 'u1', pmo: 'PMOC14', op: '8498' })
})

async function abrir() {
  render(<NovaOpCliente espelho={ESPELHO} postos={POSTOS} postosPerfil={PERFIS} clientesExistentes={['LINCE']} />)
  fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'PMOC14' } })
  fireEvent.click(screen.getByRole('button', { name: 'PMOC14 — PLACA X · 1 OP aberta' }))
  fireEvent.click(await screen.findByRole('button', { name: /^OP 8498/ }))
  await screen.findByText('Postos copiados da OP 8476 — confira.')
}
const trecho = (titulo: string) => screen.getByRole('region', { name: titulo })
const titulos = () => screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)
function ignorar(titulo: string, escolha: 'Tirar os postos da rota' | 'Manter os postos na rota da OP') {
  fireEvent.click(within(trecho(titulo)).getByRole('button', { name: 'Ignorar esta PRT' }))
  fireEvent.click(within(trecho(titulo)).getByRole('button', { name: escolha }))
}

describe('Nova OP: ignorar PRT', () => {
  it('cada PRT tem "Ignorar esta PRT"; a PMO não', async () => {
    await abrir()
    expect(within(trecho('PRT410 (8500)')).getByRole('button', { name: 'Ignorar esta PRT' })).toBeTruthy()
    expect(within(trecho('PRT420 (8499)')).getByRole('button', { name: 'Ignorar esta PRT' })).toBeTruthy()
    expect(within(trecho('PMOC14 (8498)')).queryByRole('button', { name: 'Ignorar esta PRT' })).toBeNull()
  })

  it('"Tirar os postos da rota": a PRT some com os postos e fica riscada na lista, com o selo e a escolha', async () => {
    await abrir()
    ignorar('PRT410 (8500)', 'Tirar os postos da rota')
    expect(titulos()).toEqual(['PRT420 (8499)', 'PMOC14 (8498)'])
    expect(screen.getByTestId('resumo-rota').textContent).toBe('2 trechos · 3 postos')
    const item = within(screen.getByRole('list', { name: 'PRTs ignoradas' })).getByRole('listitem')
    expect(item.textContent).toContain('PRT410 (8500)')
    expect(item.textContent).toContain('Ignorada')
    expect(item.textContent).toContain('Tirar os postos da rota')
    expect(within(item).getByText('PRT410 (8500)').className).toContain('line-through')
  })

  it('"Manter os postos na rota da OP": os postos vão para o começo do trecho seguinte', async () => {
    await abrir()
    ignorar('PRT420 (8499)', 'Manter os postos na rota da OP')
    expect(titulos()).toEqual(['PRT410 (8500)', 'PMOC14 (8498)'])
    expect(trecho('PMOC14 (8498)').textContent).toMatch(/Inspeção PTH.*Teste.*Almoxarifado/)
  })

  it('Desfazer devolve a PRT com os postos que tinha', async () => {
    await abrir()
    ignorar('PRT420 (8499)', 'Manter os postos na rota da OP')
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer: PRT420 (8499)' }))
    expect(titulos()).toEqual(['PRT410 (8500)', 'PRT420 (8499)', 'PMOC14 (8498)'])
    expect(trecho('PRT420 (8499)').textContent).toContain('Inspeção PTH')
    expect(trecho('PMOC14 (8498)').textContent).not.toContain('Inspeção PTH')
    expect(screen.queryByRole('list', { name: 'PRTs ignoradas' })).toBeNull()
  })

  it('salvar manda os trechos renumerados e as ignoradas com a escolha', async () => {
    await abrir()
    ignorar('PRT410 (8500)', 'Manter os postos na rota da OP')
    fireEvent.change(screen.getByLabelText('SN inicial *'), { target: { value: '1001' } })
    fireEvent.change(screen.getByLabelText('SN final *'), { target: { value: '1010' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar OP' }))
    await waitFor(() => expect(acoes.cadastrarOpAction).toHaveBeenCalledTimes(1))
    const enviado = acoes.cadastrarOpAction.mock.calls[0]![0]
    expect(enviado.trechos.map((t: { seq: number; codigo: string; postos: string[] }) => [t.seq, t.codigo, t.postos])).toEqual([
      [1, 'PRT420', ['SPI', 'Inspeção AOI TOP', 'Inspeção PTH']], [2, 'PMOC14', ['Teste', 'Almoxarifado']],
    ])
    expect(enviado.ignoradas).toEqual([{ codigo: 'PRT410', compelsOp: '8500', modo: 'manter' }])
  })

  it('outra PMO na busca limpa as ignoradas', async () => {
    await abrir()
    ignorar('PRT410 (8500)', 'Tirar os postos da rota')
    fireEvent.click(screen.getByRole('button', { name: 'Trocar PMO' }))
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'PMOC1' } })
    fireEvent.click(screen.getByRole('button', { name: 'PMOC14 — PLACA X · 1 OP aberta' }))
    fireEvent.click(await screen.findByRole('button', { name: /^OP 8498/ }))
    await screen.findByText('Postos copiados da OP 8476 — confira.')
    expect(screen.queryByRole('list', { name: 'PRTs ignoradas' })).toBeNull()
    expect(titulos()).toEqual(['PRT410 (8500)', 'PRT420 (8499)', 'PMOC14 (8498)'])
  })
})
EOF
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "src/app/(app)/shopfloor/ordens/nova/__tests__/nova-op-ignorar-prt.test.tsx" --maxWorkers=2`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name "Ignorar esta PRT"`.

- [ ] **Step 3: Criar os componentes**

```bash
cat > "src/app/(app)/shopfloor/ordens/ignorar-prt.tsx" <<'EOF'
'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ESCOLHA_IGNORAR, rotuloTrecho, type ModoIgnorar, type PrtIgnorada, type TrechoCadastro } from '@/modules/shopfloor/domain/cadastro-op'

/**
 * PRT ignorada (spec 2026-11-26): a PRT da cadeia do Compels que não vira trecho. Na Nova OP, "Ignorar esta PRT" no
 * cabeçalho de cada PRT abre a escolha (tirar os postos × mantê-los na rota) e a lista das ignoradas tem o Desfazer.
 * Na edição, as PRTs da cadeia que ficaram de fora podem ser incluídas de novo.
 */

/** "Ignorar esta PRT" no cabeçalho do trecho PRT (na PMO não aparece) e a escolha, em dois botões. */
export function IgnorarPrt({ t, aoIgnorar }: { t: TrechoCadastro; aoIgnorar: (seq: number, modo: ModoIgnorar) => void }) {
  const [aberto, setAberto] = useState(false)
  if (t.tipo !== 'prt') return null
  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" variant="ghost" size="sm" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        Ignorar esta PRT
      </Button>
      {aberto && (
        <div role="group" aria-label={`Ignorar ${rotuloTrecho(t)}`} className="flex flex-wrap gap-1">
          {(['tirar', 'manter'] as ModoIgnorar[]).map((modo) => (
            <Button key={modo} type="button" variant="outline" size="sm" onClick={() => aoIgnorar(t.seq, modo)}>
              {ESCOLHA_IGNORAR[modo]}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

/** As PRTs ignoradas antes de salvar: riscadas, com o selo "Ignorada", a escolha feita e o Desfazer. */
export function PrtsIgnoradas({ ignoradas, aoDesfazer }: { ignoradas: PrtIgnorada[]; aoDesfazer: (ig: PrtIgnorada) => void }) {
  if (ignoradas.length === 0) return null
  return (
    <ul aria-label="PRTs ignoradas" className="flex flex-col gap-1">
      {ignoradas.map((ig) => (
        <li key={ig.trecho.seq} className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm">
          <span className="font-medium text-muted-foreground line-through">{rotuloTrecho(ig.trecho)}</span>
          <Badge variant="outline">Ignorada</Badge>
          <span className="text-xs text-muted-foreground">{ESCOLHA_IGNORAR[ig.modo]}</span>
          <Button type="button" variant="ghost" size="sm" className="ml-auto" aria-label={`Desfazer: ${rotuloTrecho(ig.trecho)}`}
            onClick={() => aoDesfazer(ig)}>
            Desfazer
          </Button>
        </li>
      ))}
    </ul>
  )
}
EOF
```

- [ ] **Step 4: Ligar na Nova OP** (`src/app/(app)/shopfloor/ordens/nova/nova-op-cliente.tsx`)

Troque o import do domínio:

```tsx
import {
  distribuirPostos, erroSufixoOp, fixarAlmoxarifado, moverPostoEntreTrechos, opsDaPmo, pmosDoEspelho, rotuloPmo,
  trechoManual, trechosDoEspelho, ultimaLeitura, validarCadastro,
  type CadastroOp, type OpEspelho, type TrechoCadastro, type UltimaOp,
} from '@/modules/shopfloor/domain/cadastro-op'
```

por:

```tsx
import {
  desfazerIgnorar, distribuirPostos, erroSufixoOp, fixarAlmoxarifado, ignoradasParaEnviar, ignorarPrt, moverPostoEntreTrechos,
  opsDaPmo, pmosDoEspelho, rotuloPmo, trechoManual, trechosDoEspelho, trechosParaEnviar, ultimaLeitura, validarCadastro,
  type CadastroOp, type ModoIgnorar, type OpEspelho, type PrtIgnorada, type TrechoCadastro, type UltimaOp,
} from '@/modules/shopfloor/domain/cadastro-op'
```

Troque:

```tsx
import { ReceitasDosPostos, TempoBurninCampo } from '../editores-posto'
```

por:

```tsx
import { ReceitasDosPostos, TempoBurninCampo } from '../editores-posto'
import { IgnorarPrt, PrtsIgnoradas } from '../ignorar-prt'
```

Troque:

```tsx
  const [trechos, setTrechos] = useState<TrechoCadastro[]>([])
```

por:

```tsx
  const [trechos, setTrechos] = useState<TrechoCadastro[]>([])
  // PRTs da cadeia que o usuário ignorou (não viram trecho); cada uma guarda o trecho para o Desfazer
  const [ignoradas, setIgnoradas] = useState<PrtIgnorada[]>([])
```

Em `digitarBusca`, troque:

```tsx
      setOpEscolhida(null); setTrocandoOp(false); setTrechos([]); setDadosOk(false)
```

por:

```tsx
      setOpEscolhida(null); setTrocandoOp(false); setTrechos([]); setIgnoradas([]); setDadosOk(false)
```

Em `escolherPmo`, troque:

```tsx
    setPmo(codigo); setModo(m); setOpEscolhida(null); setTrocandoOp(false); setTrechos([]); setDadosOk(false); setCarregando(true); setErroUltima(false)
```

por:

```tsx
    setPmo(codigo); setModo(m); setOpEscolhida(null); setTrocandoOp(false); setTrechos([]); setIgnoradas([]); setDadosOk(false); setCarregando(true); setErroUltima(false)
```

Em `escolherOp`, troque:

```tsx
    setTrechos(novos)
    setPrtsVistas((v) => [...new Set([...v, ...codigosPrt(novos)])])
```

por:

```tsx
    setTrechos(novos)
    setIgnoradas([])
    setPrtsVistas((v) => [...new Set([...v, ...codigosPrt(novos)])])
```

Troque:

```tsx
  const mudarTrecho = (seq: number, f: (t: TrechoCadastro) => TrechoCadastro) =>
    setTrechos((ts) => fixarAlmoxarifado(ts.map((t) => (t.seq === seq ? f(t) : t)), almox))
```

por:

```tsx
  const mudarTrecho = (seq: number, f: (t: TrechoCadastro) => TrechoCadastro) =>
    setTrechos((ts) => fixarAlmoxarifado(ts.map((t) => (t.seq === seq ? f(t) : t)), almox))

  function ignorar(seq: number, modoIgnorar: ModoIgnorar) {
    const r = ignorarPrt(trechos, seq, modoIgnorar)
    if (!r) return
    setTrechos(fixarAlmoxarifado(r.trechos, almox))
    setIgnoradas((xs) => [...xs, r.ignorada])
  }

  function desfazer(ig: PrtIgnorada) {
    setTrechos((ts) => fixarAlmoxarifado(desfazerIgnorar(ts, ig), almox))
    setIgnoradas((xs) => xs.filter((x) => x !== ig))
  }
```

Em `salvar`, troque:

```tsx
      embalagemIndividual, placasPorPainel: Number(placasPorPainel), trechos,
      componentes: receitaParaLinhas(receitaDaRota(rota, limpa.receita, ehIntegracao)), burnin: temposParaLinhas(tb.tempos),
```

por:

```tsx
      embalagemIndividual, placasPorPainel: Number(placasPorPainel),
      // seq 1..n sem o buraco das PRTs ignoradas; elas vão à parte, para o servidor conferir a cadeia e o log
      trechos: trechosParaEnviar(trechos), ignoradas: ignoradasParaEnviar(ignoradas),
      componentes: receitaParaLinhas(receitaDaRota(rota, limpa.receita, ehIntegracao)), burnin: temposParaLinhas(tb.tempos),
```

No passo 4 ("Rota e faixas"), troque o bloco inteiro:

```tsx
        {trechos.length > 0 && (
          <CorrenteTrechos trechos={trechos} almox={almox} idBase={idBase} qtd={qtd} nPainel={nPainel}
            mudarTrecho={mudarTrecho} opcoesAdicionar={() => disponiveis}
            extraPosto={(p) => ehBurnin(p) && (
              <TempoBurninCampo valor={tempos[p] ?? ''} rotulo={`Tempo mínimo de Burn-in em ${p}`}
                setValor={(v) => setTempos((prev) => ({ ...prev, [p]: v }))} />
            )}
            aoAdicionarPosto={(p) => {
              if (ehBurnin(p) && (tempos[p] ?? '') === '') setTempos((prev) => ({ ...prev, [p]: BURNIN_PADRAO }))
            }}
            rodapeTrecho={(t) => (
              <ReceitasDosPostos postos={t.postos} ehIntegracao={ehIntegracao} receita={receita} setReceita={setReceita}
                pmosExistentes={pmosExistentes} pmoDaOp={pmo ?? ''} prtsDaOp={prtsDeSeriePropria(trechos)}
                prtsMesmaSerie={prtsDeMesmaSerie(trechos)} />
            )}
            moverEntreTrechos={(seq, p, delta) => setTrechos((ts) => moverPostoEntreTrechos(ts, seq, p, delta, almox))} />
        )}
```

por:

```tsx
        {trechos.length > 0 && (
          <div className="flex flex-col gap-3">
            <PrtsIgnoradas ignoradas={ignoradas} aoDesfazer={desfazer} />
            <CorrenteTrechos trechos={trechos} almox={almox} idBase={idBase} qtd={qtd} nPainel={nPainel}
              mudarTrecho={mudarTrecho} opcoesAdicionar={() => disponiveis}
              situacao={(t) => <IgnorarPrt t={t} aoIgnorar={ignorar} />}
              extraPosto={(p) => ehBurnin(p) && (
                <TempoBurninCampo valor={tempos[p] ?? ''} rotulo={`Tempo mínimo de Burn-in em ${p}`}
                  setValor={(v) => setTempos((prev) => ({ ...prev, [p]: v }))} />
              )}
              aoAdicionarPosto={(p) => {
                if (ehBurnin(p) && (tempos[p] ?? '') === '') setTempos((prev) => ({ ...prev, [p]: BURNIN_PADRAO }))
              }}
              rodapeTrecho={(t) => (
                <ReceitasDosPostos postos={t.postos} ehIntegracao={ehIntegracao} receita={receita} setReceita={setReceita}
                  pmosExistentes={pmosExistentes} pmoDaOp={pmo ?? ''} prtsDaOp={prtsDeSeriePropria(trechos)}
                  prtsMesmaSerie={prtsDeMesmaSerie(trechos)} />
              )}
              moverEntreTrechos={(seq, p, delta) => setTrechos((ts) => moverPostoEntreTrechos(ts, seq, p, delta, almox))} />
          </div>
        )}
```

(A receita já se limpa sozinha: a PRT ignorada está em `prtsVistas` e o `limparReceitaPrt` do `salvar` a tira da receita com o aviso de sempre.)

- [ ] **Step 5: Rodar e ver passar (com os testes antigos da Nova OP)**

Run: `npx vitest run "src/app/(app)/shopfloor/ordens/nova/__tests__" --maxWorkers=2`
Expected: PASS — `Test Files 2 passed`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/shopfloor/ordens/ignorar-prt.tsx" "src/app/(app)/shopfloor/ordens/nova/nova-op-cliente.tsx" "src/app/(app)/shopfloor/ordens/nova/__tests__/nova-op-ignorar-prt.test.tsx"
git commit -m "$(cat <<'EOF'
feat(op): Nova OP ignora uma PRT (tirar ou manter os postos), com Desfazer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Domínio da edição — cadeia da OP, PRTs fora dela, incluir de novo e gravar sem seq

**Files:**
- Modify: `src/modules/shopfloor/domain/edicao-op-trechos.ts` (import; `trechosParaGravar`; funções novas)
- Test: `src/modules/shopfloor/domain/__tests__/edicao-op-incluir-prt.test.ts` (novo)

**Interfaces:**
- Consumes (Task 2): `chaveTrecho`, `TrechoCadastro.incluida`; `trechosDoEspelho` (existente).
- Produces (de `@/modules/shopfloor/domain/edicao-op-trechos`):
  - `type TrechoParaGravar = { seq: number | null; postos: string[]; sn_modo: SnModo; faixas: FaixaSN[]; codigo?: string; compels_op?: string | null }`
  - `trechosParaGravar(trechos: TrechoCadastro[]): TrechoParaGravar[]` — incluída sai `{ seq: null, codigo, compels_op, postos, sn_modo, faixas }`; as demais exatamente como antes.
  - `cadeiaDaOp(trechos: TrechoCadastro[], espelho: OpEspelho[]): TrechoCadastro[]`
  - `prtsForaDaOp(trechos: TrechoCadastro[], cadeia: TrechoCadastro[]): TrechoCadastro[]`
  - `incluirPrt(trechos: TrechoCadastro[], cadeia: TrechoCadastro[], prt: TrechoCadastro): TrechoCadastro[]` — a incluída tem `seq: -(posição na cadeia + 1)`, `incluida: true`, `snModo: 'mesmo'`, `postos: []`, `faixas: []`.

- [ ] **Step 1: Escrever o teste que falha**

```bash
cat > src/modules/shopfloor/domain/__tests__/edicao-op-incluir-prt.test.ts <<'EOF'
import { describe, expect, it } from 'vitest'
import { cadeiaDaOp, incluirPrt, prtsForaDaOp, trechosDaOpGravada, trechosParaGravar } from '../edicao-op-trechos'
import type { OpEspelho } from '../cadastro-op'

const op = (numero: number, codigo: string, nivel: number, mae: number | null): OpEspelho => ({
  numero, idCompels: numero, codigo, descricao: `${codigo} desc`, situacao: 'Em Processo', nivel, quantidade: 10,
  quantidadeProduzida: 0, maeNumero: mae, principalNumero: null, cliente: 'C01', dataDocumento: '2026-11-10',
  ativa: true, lidoEm: '2026-11-18T13:00:00Z',
})
// cadeia no Compels: PRT410 (nível 3) → PRT420 (nível 2) → PMOC14; a OP foi cadastrada sem a PRT420
const ESPELHO = [op(8498, 'PMOC14', 1, null), op(8499, 'PRT420', 2, 8498), op(8500, 'PRT410', 3, 8499)]
const GRAVADA = trechosDaOpGravada(
  [
    { seq: 1, codigo: 'PRT410', tipo: 'prt', compels_op: '8500', sn_modo: 'proprio' },
    { seq: 2, codigo: 'PMOC14', tipo: 'pmo', compels_op: '8498', sn_modo: 'mesmo' },
  ],
  [{ posto: 'SPI', ordem: 0, trecho_seq: 1 }, { posto: 'Inspeção PTH', ordem: 1, trecho_seq: 2 }, { posto: 'Almoxarifado', ordem: 2, trecho_seq: 2 }],
  [{ seq: 1, sn_ini: '1001', sn_fim: '1010', trecho_seq: 2 }, { seq: 2, sn_ini: 'P001', sn_fim: 'P010', trecho_seq: 1 }],
  ESPELHO,
)
const CADEIA = cadeiaDaOp(GRAVADA, ESPELHO)

describe('incluir de novo uma PRT que ficou fora da OP', () => {
  it('a cadeia vem da OP da PMO no espelho; sem ela (ou cadastro manual), vazia', () => {
    expect(CADEIA.map((t) => t.codigo)).toEqual(['PRT410', 'PRT420', 'PMOC14'])
    expect(cadeiaDaOp(GRAVADA, [])).toEqual([])
    expect(cadeiaDaOp(GRAVADA.map((t) => ({ ...t, compelsOp: null })), ESPELHO)).toEqual([])
  })
  it('fora da OP: só as PRTs da cadeia que não são trecho', () => {
    expect(prtsForaDaOp(GRAVADA, CADEIA).map((t) => t.codigo)).toEqual(['PRT420'])
    expect(prtsForaDaOp(GRAVADA, [])).toEqual([])
  })
  it('entra no lugar dela na cadeia, sem posto, marcada como incluída', () => {
    const prt420 = prtsForaDaOp(GRAVADA, CADEIA)[0]!
    const r = incluirPrt(GRAVADA, CADEIA, prt420)
    expect(r.map((t) => [t.codigo, t.postos, t.incluida ?? false])).toEqual([
      ['PRT410', ['SPI'], false], ['PRT420', [], true], ['PMOC14', ['Inspeção PTH', 'Almoxarifado'], false],
    ])
    expect(r[1]).toMatchObject({ seq: -2, compelsOp: '8499', snModo: 'mesmo', faixas: [] })
    expect(prtsForaDaOp(r, CADEIA)).toEqual([])
    // já incluída, ou fora da cadeia: nada muda
    expect(incluirPrt(r, CADEIA, prt420)).toBe(r)
    expect(incluirPrt(GRAVADA, CADEIA, { ...prt420, compelsOp: '9999' })).toBe(GRAVADA)
  })
  it('para gravar: a incluída vai sem seq, com código e OP do Compels, na ordem da tela', () => {
    const r = incluirPrt(GRAVADA, CADEIA, prtsForaDaOp(GRAVADA, CADEIA)[0]!)
    const comPosto = r.map((t) => (t.incluida ? { ...t, postos: ['Inspeção PTH'] } : t.tipo === 'pmo' ? { ...t, postos: ['Almoxarifado'] } : t))
    expect(trechosParaGravar(comPosto)).toEqual([
      { seq: 1, postos: ['SPI'], sn_modo: 'proprio', faixas: [{ sn_ini: 'P001', sn_fim: 'P010' }] },
      { seq: null, codigo: 'PRT420', compels_op: '8499', postos: ['Inspeção PTH'], sn_modo: 'mesmo', faixas: [] },
      { seq: 2, postos: ['Almoxarifado'], sn_modo: 'mesmo', faixas: [{ sn_ini: '1001', sn_fim: '1010' }] },
    ])
  })
})
EOF
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/shopfloor/domain/__tests__/edicao-op-incluir-prt.test.ts --maxWorkers=2`
Expected: FAIL — `cadeiaDaOp is not a function`.

- [ ] **Step 3: Implementar** (`src/modules/shopfloor/domain/edicao-op-trechos.ts`)

Troque:

```ts
import type { SnModo, TipoTrecho, TrechoCadastro } from './cadastro-op'
```

por:

```ts
import { chaveTrecho, trechosDoEspelho, type SnModo, type TipoTrecho, type TrechoCadastro } from './cadastro-op'
```

Troque a função inteira:

```ts
/** O que vai no campo `trechos` da edição: rota, série e faixas por trecho (PRT 'mesmo' sem faixa; PMO sempre 'mesmo'). */
export function trechosParaGravar(trechos: TrechoCadastro[]): { seq: number; postos: string[]; sn_modo: SnModo; faixas: FaixaSN[] }[] {
  return trechos.map((t) => {
    const snModo: SnModo = t.tipo === 'pmo' ? 'mesmo' : t.snModo
    return { seq: t.seq, postos: t.postos, sn_modo: snModo, faixas: t.tipo === 'pmo' || snModo === 'proprio' ? t.faixas : [] }
  })
}
```

por:

```ts
/** Um trecho no campo `trechos` da edição. seq null = PRT incluída de novo (0199): vai com codigo + compels_op. */
export type TrechoParaGravar = {
  seq: number | null; postos: string[]; sn_modo: SnModo; faixas: FaixaSN[]; codigo?: string; compels_op?: string | null
}

/**
 * O que vai no campo `trechos` da edição, na ordem da tela: rota, série e faixas por trecho (PRT 'mesmo' sem faixa; PMO
 * sempre 'mesmo'). A PRT incluída nesta edição vai sem seq, com o código e a OP do Compels (o banco a numera).
 */
export function trechosParaGravar(trechos: TrechoCadastro[]): TrechoParaGravar[] {
  return trechos.map((t) => {
    const snModo: SnModo = t.tipo === 'pmo' ? 'mesmo' : t.snModo
    const base = { postos: t.postos, sn_modo: snModo, faixas: t.tipo === 'pmo' || snModo === 'proprio' ? t.faixas : [] }
    return t.incluida ? { seq: null, codigo: t.codigo, compels_op: t.compelsOp, ...base } : { seq: t.seq, ...base }
  })
}

/** A cadeia inteira do Compels da OP gravada (pela OP do trecho da PMO no espelho); [] se ela não está no espelho. */
export function cadeiaDaOp(trechos: TrechoCadastro[], espelho: OpEspelho[]): TrechoCadastro[] {
  const pmo = trechos.find((t) => t.tipo === 'pmo')
  if (!pmo?.compelsOp) return []
  const codigo = pmo.codigo.trim().toUpperCase()
  const opPmo = espelho.find((o) => String(o.numero) === pmo.compelsOp && o.codigo.trim().toUpperCase() === codigo)
  return opPmo ? trechosDoEspelho(opPmo, espelho) : []
}

/** As PRTs da cadeia que não são trecho da OP (ignoradas no cadastro), na ordem da cadeia. */
export function prtsForaDaOp(trechos: TrechoCadastro[], cadeia: TrechoCadastro[]): TrechoCadastro[] {
  const tem = new Set(trechos.map(chaveTrecho))
  return cadeia.filter((c) => c.tipo === 'prt' && !tem.has(chaveTrecho(c)))
}

/**
 * Inclui de novo a PRT da cadeia: entra SEM posto (os postos vêm com ← → dos vizinhos ou por "Adicionar posto"), no
 * lugar dela na cadeia — antes do primeiro trecho que vem depois dela no Compels, e sempre antes da PMO. seq negativo só
 * para a tela (o banco numera ao gravar). Fora da cadeia ou já na OP: igual.
 */
export function incluirPrt(trechos: TrechoCadastro[], cadeia: TrechoCadastro[], prt: TrechoCadastro): TrechoCadastro[] {
  const posicao = (t: TrechoCadastro) => cadeia.findIndex((c) => chaveTrecho(c) === chaveTrecho(t))
  const k = posicao(prt)
  if (k < 0 || prt.tipo !== 'prt' || trechos.some((t) => chaveTrecho(t) === chaveTrecho(prt))) return trechos
  const nova: TrechoCadastro = { ...prt, seq: -(k + 1), incluida: true, snModo: 'mesmo', postos: [], faixas: [] }
  const depois = trechos.findIndex((t) => t.tipo === 'pmo' || posicao(t) > k)
  const at = depois < 0 ? trechos.length : depois
  return [...trechos.slice(0, at), nova, ...trechos.slice(at)]
}
```

- [ ] **Step 4: Rodar e ver passar (com o teste antigo da edição)**

Run: `npx vitest run src/modules/shopfloor/domain/__tests__/edicao-op-incluir-prt.test.ts src/modules/shopfloor/domain/__tests__/edicao-op-trechos.test.ts --maxWorkers=2`
Expected: PASS — `Test Files 2 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/modules/shopfloor/domain/edicao-op-trechos.ts src/modules/shopfloor/domain/__tests__/edicao-op-incluir-prt.test.ts
git commit -m "$(cat <<'EOF'
feat(op): domínio da edição inclui de novo a PRT da cadeia que ficou fora da OP

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Edição no servidor — aceitar a PRT incluída, mensagens e log

**Files:**
- Modify: `src/modules/shopfloor/infra/ordem-repository.ts` (`TrechoEdicao`)
- Modify: `src/modules/shopfloor/application/ordens-actions.ts` (`lerTrechos`; `registrarLog` do `editarOrdemAction`)
- Modify: `src/modules/shopfloor/domain/erros-trecho.ts`
- Test: `src/modules/shopfloor/application/__tests__/ordens-actions-incluir-prt.test.ts` (novo); `src/modules/shopfloor/domain/__tests__/erros-trecho.test.ts` (estender)

**Interfaces:**
- Consumes (Task 1): códigos `PRT_INCLUIDA_FORA_DA_CADEIA:<c>`, `PRT_INCLUIDA_REPETIDA:<c>`, `PRT_INCLUIDA_COM_REGISTROS:<c>`; item sem `seq` em `sf_ordem_regravar_trechos`. (Task 5): o formato do campo `trechos` (`TrechoParaGravar`).
- Produces: `interface TrechoEdicao { seq: number | null; postos: string[]; sn_modo: 'mesmo' | 'proprio'; faixas: FaixaSN[]; codigo?: string; compels_op?: string }`; `editarOrdemAction` passa a lista na ordem recebida quando há incluída (ordenada por seq quando não há, como antes); log `acao: 'alterar_campo'` com `· PRT incluída de novo: <codigo> (<op>)` e `dados.prtsIncluidas`.

- [ ] **Step 1: Escrever os testes que falham**

```bash
cat > src/modules/shopfloor/application/__tests__/ordens-actions-incluir-prt.test.ts <<'EOF'
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

type Faixa = { sn_ini: string; sn_fim: string }
type Base = { pmo: string; op: string; status: string; placas_por_painel: number; sn_ini: string; sn_fim: string; faixas: Faixa[]; faixasPrt?: Faixa[] }
const m = vi.hoisted(() => ({
  atualizarOrdem: vi.fn<(...a: unknown[]) => Promise<undefined>>(async () => undefined),
  buscarOrdemBase: vi.fn<(id: string) => Promise<Base | null>>(async () => null),
  registrarLog: vi.fn(async () => undefined),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao: vi.fn(async () => ({ email: 'gestor@x', perfil: {} })) }))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: vi.fn(() => true) }))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog: m.registrarLog }))
vi.mock('../../infra/postos-repository', () => ({ mapaPostoPerfil: vi.fn(async () => ({ Almoxarifado: { recurso: 'almoxarifado' } })) }))
vi.mock('../../infra/ordem-repository', () => ({
  criarOrdem: vi.fn(async () => 'id-novo'),
  atualizarOrdem: m.atualizarOrdem,
  excluirOrdem: vi.fn(),
  contarRegistros: vi.fn(async () => 0),
  buscarOrdemBase: m.buscarOrdemBase,
  buscarOpEmUso: vi.fn(async () => null),
  listarPostos: vi.fn(async () => ['SPI', 'Inspeção PTH', 'Teste', 'Almoxarifado'].map((chave) => ({ chave }))),
  listarRotaGravada: vi.fn(async () => ['SPI', 'Inspeção PTH', 'Teste', 'Almoxarifado']),
  contarSnsForaDasFaixas: vi.fn(async () => 0),
}))
vi.mock('../../infra/estrutura-repository', () => ({ ordemTemTrechos: vi.fn(async () => true) }))

import { editarOrdemAction } from '../ordens-actions'

const BASE: Base = {
  pmo: 'PMOC14', op: '8498', status: 'ATIVA', placas_por_painel: 1, sn_ini: '1001', sn_fim: '1010',
  faixas: [{ sn_ini: '1001', sn_fim: '1010' }], faixasPrt: [],
}
// a OP gravada: PRT410 (seq 1) e PMOC14 (seq 2); a PRT420 volta entre as duas
const COM_INCLUIDA = [
  { seq: 1, postos: ['SPI'], sn_modo: 'mesmo', faixas: [] },
  { seq: null, codigo: ' PRT420 ', compels_op: '8499', postos: ['Inspeção PTH'], sn_modo: 'mesmo', faixas: [] },
  { seq: 2, postos: ['Teste', 'Almoxarifado'], sn_modo: 'mesmo', faixas: [{ sn_ini: '1001', sn_fim: '1010' }] },
]
function formulario(trechos: unknown): FormData {
  const fd = new FormData()
  fd.set('id', 'id-1'); fd.set('pmo', 'PMOC14'); fd.set('op', '8498'); fd.set('cliente', 'Cliente'); fd.set('qtd', '10')
  fd.set('status', 'ATIVA'); fd.set('placas_por_painel', '1')
  fd.set('trechos', JSON.stringify(trechos))
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  m.buscarOrdemBase.mockResolvedValue(BASE)
})

describe('editarOrdemAction: PRT incluída de novo (0199)', () => {
  it('manda a lista na ordem da tela, com a incluída sem seq (código aparado), e registra no log', async () => {
    expect(await editarOrdemAction(undefined, formulario(COM_INCLUIDA))).toMatchObject({ ok: true })
    const [, , postos, , , faixas, trechos] = m.atualizarOrdem.mock.calls[0]!
    expect(trechos).toEqual([
      { seq: 1, postos: ['SPI'], sn_modo: 'mesmo', faixas: [] },
      { seq: null, codigo: 'PRT420', compels_op: '8499', postos: ['Inspeção PTH'], sn_modo: 'mesmo', faixas: [] },
      { seq: 2, postos: ['Teste', 'Almoxarifado'], sn_modo: 'mesmo', faixas: [{ sn_ini: '1001', sn_fim: '1010' }] },
    ])
    expect(postos).toEqual(['SPI', 'Inspeção PTH', 'Teste', 'Almoxarifado'])
    expect(faixas).toEqual([{ sn_ini: '1001', sn_fim: '1010' }])
    expect(m.registrarLog).toHaveBeenCalledWith(expect.objectContaining({
      acao: 'alterar_campo',
      descricao: 'OP PMOC14/8498 editada · PRT incluída de novo: PRT420 (8499)',
      dados: expect.objectContaining({ prtsIncluidas: [{ codigo: 'PRT420', compelsOp: '8499' }] }),
    }))
  })

  it('sem incluída, a lista continua ordenada por seq e o log como sempre', async () => {
    const semIncluida = [COM_INCLUIDA[2], COM_INCLUIDA[0]]
    expect(await editarOrdemAction(undefined, formulario(semIncluida))).toMatchObject({ ok: true })
    expect((m.atualizarOrdem.mock.calls[0]![6] as { seq: number }[]).map((t) => t.seq)).toEqual([1, 2])
    expect(m.registrarLog).toHaveBeenCalledWith(expect.objectContaining({ descricao: 'OP PMOC14/8498 editada' }))
  })

  it('incluída sem código ou sem OP do Compels: trechos inválidos', async () => {
    const semCodigo = [COM_INCLUIDA[0], { ...COM_INCLUIDA[1], codigo: '' }, COM_INCLUIDA[2]]
    const semOp = [COM_INCLUIDA[0], { ...COM_INCLUIDA[1], compels_op: undefined }, COM_INCLUIDA[2]]
    expect(await editarOrdemAction(undefined, formulario(semCodigo))).toEqual({ ok: false, erro: 'Trechos inválidos.' })
    expect(await editarOrdemAction(undefined, formulario(semOp))).toEqual({ ok: false, erro: 'Trechos inválidos.' })
    expect(m.atualizarOrdem).not.toHaveBeenCalled()
  })

  it('a recusa do banco vira mensagem em PT-BR', async () => {
    m.atualizarOrdem.mockRejectedValueOnce({ message: 'PRT_INCLUIDA_COM_REGISTROS:PRT420' })
    expect(await editarOrdemAction(undefined, formulario(COM_INCLUIDA)))
      .toEqual({ ok: false, erro: 'PRT420 não pode voltar com esses postos: algum deles já tem peças bipadas nesta OP.' })
  })
})
EOF
python3 - <<'EOF'
p = 'src/modules/shopfloor/domain/__tests__/erros-trecho.test.ts'
c = open(p, encoding='utf-8').read()
velho = "  it('o resto não é erro de trecho', () => {"
novo = """  it('traduz a recusa da PRT incluída de novo (0199)', () => {
    expect(mensagemErroDeTrecho({ message: 'PRT_INCLUIDA_FORA_DA_CADEIA:PRT420' }))
      .toBe('PRT420 não é uma PRT desta OP no Compels. Recarregue a página e tente de novo.')
    expect(mensagemErroDeTrecho({ message: 'PRT_INCLUIDA_REPETIDA:PRT420' })).toBe('PRT420 já é um trecho desta OP.')
    expect(mensagemErroDeTrecho({ message: 'PRT_INCLUIDA_COM_REGISTROS:PRT420' }))
      .toBe('PRT420 não pode voltar com esses postos: algum deles já tem peças bipadas nesta OP.')
  })
  it('o resto não é erro de trecho', () => {"""
assert c.count(velho) == 1
open(p, 'w', encoding='utf-8').write(c.replace(velho, novo, 1))
EOF
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/shopfloor/application/__tests__/ordens-actions-incluir-prt.test.ts src/modules/shopfloor/domain/__tests__/erros-trecho.test.ts --maxWorkers=2`
Expected: FAIL — a incluída cai em `Trechos inválidos.` (o `lerTrechos` exige seq inteiro) e as 3 mensagens novas vêm `null`.

- [ ] **Step 3: Implementar**

Em `src/modules/shopfloor/infra/ordem-repository.ts`, troque:

```ts
/** Um trecho na edição por trecho (0194): os postos em ordem, a série e as faixas (PMO e PRT com série própria). */
export interface TrechoEdicao { seq: number; postos: string[]; sn_modo: 'mesmo' | 'proprio'; faixas: FaixaSN[] }
```

por:

```ts
/**
 * Um trecho na edição por trecho (0194): os postos em ordem, a série e as faixas (PMO e PRT com série própria).
 * seq null = PRT da cadeia incluída de novo nesta edição (0199): vai com codigo + compels_op, e a lista vai na ordem nova.
 */
export interface TrechoEdicao {
  seq: number | null
  postos: string[]
  sn_modo: 'mesmo' | 'proprio'
  faixas: FaixaSN[]
  codigo?: string
  compels_op?: string
}
```

Em `src/modules/shopfloor/application/ordens-actions.ts`, no comentário de `lerTrechos`, troque:

```ts
 * Postos fora do catálogo são recusados (não descartados: sumir com um posto mudaria o trecho calado).
 */
async function lerTrechos(
```

por:

```ts
 * Postos fora do catálogo são recusados (não descartados: sumir com um posto mudaria o trecho calado).
 * 0199: item com seq null (ou sem seq) = PRT da cadeia incluída de novo, com codigo + compels_op; aí a lista fica na
 * ordem em que veio (é a ordem nova dos trechos, e o banco confere a cadeia). Sem ele, ordenada por seq, como sempre.
 */
async function lerTrechos(
```

Troque:

```ts
    const t = item as { seq?: unknown; postos?: unknown; sn_modo?: unknown; faixas?: unknown }
    if (!Number.isInteger(t.seq) || !Array.isArray(t.postos) || (t.faixas !== undefined && !Array.isArray(t.faixas))) return invalido
```

por:

```ts
    const t = item as { seq?: unknown; codigo?: unknown; compels_op?: unknown; postos?: unknown; sn_modo?: unknown; faixas?: unknown }
    const incluida = t.seq === null || t.seq === undefined
    const codigo = typeof t.codigo === 'string' ? t.codigo.trim() : ''
    const compelsOp = typeof t.compels_op === 'string' ? t.compels_op.trim() : ''
    if (incluida ? codigo === '' || compelsOp === '' : !Number.isInteger(t.seq)) return invalido
    if (!Array.isArray(t.postos) || (t.faixas !== undefined && !Array.isArray(t.faixas))) return invalido
```

Troque:

```ts
    if (t.sn_modo !== 'mesmo' && t.sn_modo !== 'proprio') return { ok: false, erro: `Série inválida no trecho ${t.seq as number}: escolha "mesma série da PMO" ou "série própria".` }
    trechos.push({ seq: t.seq as number, postos, sn_modo: t.sn_modo, faixas })
  }
  return { ok: true, trechos: [...trechos].sort((a, b) => a.seq - b.seq) }
```

por:

```ts
    if (t.sn_modo !== 'mesmo' && t.sn_modo !== 'proprio') return { ok: false, erro: `Série inválida no trecho ${incluida ? codigo : t.seq as number}: escolha "mesma série da PMO" ou "série própria".` }
    trechos.push(incluida
      ? { seq: null, codigo, compels_op: compelsOp, postos, sn_modo: t.sn_modo, faixas }
      : { seq: t.seq as number, postos, sn_modo: t.sn_modo, faixas })
  }
  if (trechos.some((t) => t.seq === null)) return { ok: true, trechos }
  return { ok: true, trechos: [...trechos].sort((a, b) => (a.seq as number) - (b.seq as number)) }
```

No fim do `editarOrdemAction`, troque:

```ts
  await registrarLog({ entidade: 'sf_ordem', entidadeId: id, acao: 'alterar_campo', descricao: `OP ${dados.pmo}/${dados.op} editada`, dados: { ...dados, faixas, ...(trechosEdicao ? { trechos: trechosEdicao } : {}) } })
```

por:

```ts
  // 0199: a PRT incluída de novo fica no log da OP (quem e quando o log já grava)
  const incluidas = (trechosEdicao ?? []).filter((t) => t.seq === null).map((t) => ({ codigo: t.codigo ?? '', compelsOp: t.compels_op ?? null }))
  const linhaIncluidas = incluidas.length === 0 ? ''
    : ` · ${incluidas.length === 1 ? 'PRT incluída de novo' : 'PRTs incluídas de novo'}: ${incluidas.map((i) => `${i.codigo} (${i.compelsOp})`).join(', ')}`
  await registrarLog({
    entidade: 'sf_ordem', entidadeId: id, acao: 'alterar_campo', descricao: `OP ${dados.pmo}/${dados.op} editada${linhaIncluidas}`,
    dados: { ...dados, faixas, ...(trechosEdicao ? { trechos: trechosEdicao } : {}), ...(incluidas.length > 0 ? { prtsIncluidas: incluidas } : {}) },
  })
```

Em `src/modules/shopfloor/domain/erros-trecho.ts`, troque:

```ts
  const m = /^(TRECHO_SEM_POSTO|POSTO_REPETIDO|TRECHO_SEM_FAIXA|SN_MODO_INVALIDO|FAIXA_INVALIDA|FAIXA_SOBREPOSTA|POSTO_COM_REGISTROS|PRT_COM_HISTORICO|PRT_FAIXA_COM_HISTORICO|RECEITA_PRT_INVALIDA):(.+)$/.exec(msg)
```

por:

```ts
  const m = /^(TRECHO_SEM_POSTO|POSTO_REPETIDO|TRECHO_SEM_FAIXA|SN_MODO_INVALIDO|FAIXA_INVALIDA|FAIXA_SOBREPOSTA|POSTO_COM_REGISTROS|PRT_COM_HISTORICO|PRT_FAIXA_COM_HISTORICO|RECEITA_PRT_INVALIDA|PRT_INCLUIDA_FORA_DA_CADEIA|PRT_INCLUIDA_REPETIDA|PRT_INCLUIDA_COM_REGISTROS):(.+)$/.exec(msg)
```

E troque:

```ts
  if (m?.[1] === 'RECEITA_PRT_INVALIDA') return `${m[2]} não pode estar na receita da Integração: só entra PRT desta OP com série própria.`
```

por:

```ts
  if (m?.[1] === 'RECEITA_PRT_INVALIDA') return `${m[2]} não pode estar na receita da Integração: só entra PRT desta OP com série própria.`
  // 0199 (sf_ordem_regravar_trechos: a PRT incluída de novo)
  if (m?.[1] === 'PRT_INCLUIDA_FORA_DA_CADEIA') return `${m[2]} não é uma PRT desta OP no Compels. Recarregue a página e tente de novo.`
  if (m?.[1] === 'PRT_INCLUIDA_REPETIDA') return `${m[2]} já é um trecho desta OP.`
  if (m?.[1] === 'PRT_INCLUIDA_COM_REGISTROS') return `${m[2]} não pode voltar com esses postos: algum deles já tem peças bipadas nesta OP.`
```

- [ ] **Step 4: Rodar e ver passar (com todos os testes das actions e do domínio)**

Run: `npx vitest run src/modules/shopfloor/application/__tests__ src/modules/shopfloor/domain/__tests__/erros-trecho.test.ts --maxWorkers=2`
Expected: PASS — nenhum arquivo falhando (os `ordens-actions-*.test.ts` antigos continuam verdes: sem incluída, a lista segue ordenada por seq).

- [ ] **Step 5: Commit**

```bash
git add src/modules/shopfloor/infra/ordem-repository.ts src/modules/shopfloor/application/ordens-actions.ts src/modules/shopfloor/domain/erros-trecho.ts src/modules/shopfloor/application/__tests__/ordens-actions-incluir-prt.test.ts src/modules/shopfloor/domain/__tests__/erros-trecho.test.ts
git commit -m "$(cat <<'EOF'
feat(op): edição aceita a PRT incluída de novo (sem seq), com mensagens e log

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Tela de edição — "PRTs fora desta OP" com "Incluir de novo"

**Files:**
- Modify: `src/app/(app)/shopfloor/ordens/ignorar-prt.tsx` (acrescentar `PrtsForaDaOp`)
- Modify: `src/app/(app)/shopfloor/ordens-nova/[id]/editar-op-cliente.tsx`
- Modify: `src/app/(app)/shopfloor/ordens-nova/[id]/page.tsx`
- Test: `src/app/(app)/shopfloor/ordens-nova/[id]/__tests__/editar-op-incluir-prt.test.tsx` (novo); `src/app/(app)/shopfloor/ordens-nova/[id]/__tests__/page.test.tsx` (estender)

**Interfaces:**
- Consumes (Task 5): `cadeiaDaOp`, `prtsForaDaOp`, `incluirPrt`, `trechosParaGravar`. (Task 4): arquivo `ignorar-prt.tsx`.
- Produces: `PrtsForaDaOp({ prts, aoIncluir }: { prts: TrechoCadastro[]; aoIncluir: (t: TrechoCadastro) => void })` — `<ul aria-label="PRTs fora desta OP">`, botão `aria-label="Incluir <rótulo> de novo"`; `EditarOpCliente` ganha a prop opcional `cadeia?: TrechoCadastro[]` (padrão `[]`); a página passa `cadeia={cadeiaDaOp(trechos, espelho)}`.

- [ ] **Step 1: Escrever os testes que falham**

```bash
cat > "src/app/(app)/shopfloor/ordens-nova/[id]/__tests__/editar-op-incluir-prt.test.tsx" <<'EOF'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { TrechoCadastro } from '@/modules/shopfloor/domain/cadastro-op'

vi.mock('server-only', () => ({}))
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
const acoes = vi.hoisted(() => ({ editarOrdemAction: vi.fn(), criarOrdemAction: vi.fn(), opTemRegistrosAction: vi.fn() }))
vi.mock('@/modules/shopfloor/application/ordens-actions', () => acoes)
vi.mock('@/modules/shopfloor/application/padroes-fluxo-actions', () => ({ salvarPadraoAction: vi.fn(), excluirPadraoAction: vi.fn() }))
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirmacao: () => ({ confirmar: vi.fn(), dialog: null }) }))

const { EditarOpCliente } = await import('../editar-op-cliente')

const trecho = (t: Partial<TrechoCadastro> & Pick<TrechoCadastro, 'seq' | 'codigo' | 'tipo' | 'compelsOp' | 'postos'>): TrechoCadastro => ({
  descricao: '', quantidade: 10, situacao: 'Em Processo', snModo: 'mesmo', faixas: [], ...t,
})
// gravada sem a PRT420; a cadeia do Compels tem as três
const GRAVADA: TrechoCadastro[] = [
  trecho({ seq: 1, codigo: 'PRT410', tipo: 'prt', compelsOp: '8500', postos: ['SPI'] }),
  trecho({ seq: 2, codigo: 'PMOC14', tipo: 'pmo', compelsOp: '8498', postos: ['Inspeção PTH', 'Teste', 'Almoxarifado'], faixas: [{ sn_ini: '1001', sn_fim: '1010' }] }),
]
const CADEIA: TrechoCadastro[] = [
  trecho({ seq: 1, codigo: 'PRT410', tipo: 'prt', compelsOp: '8500', postos: [] }),
  trecho({ seq: 2, codigo: 'PRT420', tipo: 'prt', compelsOp: '8499', postos: [] }),
  trecho({ seq: 3, codigo: 'PMOC14', tipo: 'pmo', compelsOp: '8498', postos: [], faixas: [{ sn_ini: '', sn_fim: '' }] }),
]
const ORDEM = {
  id: '00000000-0000-0000-0000-000000000001', pmo: 'PMOC14', op: '8498', cliente: 'LINCE', qtd: 10, descricao: 'PLACA X',
  acp: '', status: 'ATIVA', embalagemIndividual: false, placasPorPainel: 1,
}
const PERFIS = { Almoxarifado: { recurso: 'almoxarifado' } } as never
const montar = (cadeia: TrechoCadastro[] = CADEIA) => render(
  <EditarOpCliente ordem={ORDEM} trechos={GRAVADA} resumo={[]} postos={['SPI', 'Inspeção PTH', 'Teste', 'Almoxarifado']}
    postosPerfil={PERFIS} clientesExistentes={['LINCE']} temRegistros={false} receita={{}} tempoBurnin={{}} cadeia={cadeia} />,
)
const titulos = () => screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  acoes.editarOrdemAction.mockResolvedValue({ ok: true, id: ORDEM.id, pmo: 'PMOC14', op: '8498' })
})

describe('Editar OP: incluir de novo a PRT ignorada', () => {
  it('lista só as PRTs da cadeia fora da OP; sem cadeia, nada aparece', () => {
    montar()
    const lista = screen.getByRole('list', { name: 'PRTs fora desta OP' })
    expect(within(lista).getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('PRT420 (8499)')])
  })
  it('sem cadeia (OP fora do espelho), nada aparece', () => {
    montar([])
    expect(screen.queryByRole('list', { name: 'PRTs fora desta OP' })).toBeNull()
  })
  it('"Incluir de novo" põe a PRT no lugar dela, vazia; salvar sem posto é barrado na tela', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Incluir PRT420 (8499) de novo' }))
    expect(titulos()).toEqual(['PRT410 (8500)', 'PRT420 (8499)', 'PMOC14 (8498)'])
    expect(screen.queryByRole('list', { name: 'PRTs fora desta OP' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    const { toast } = await import('sonner')
    expect(toast.error).toHaveBeenCalledWith('O trecho PRT420 (8499) está sem posto.', expect.anything())
    expect(acoes.editarOrdemAction).not.toHaveBeenCalled()
  })
  it('com o posto trazido da PMO (←), salva a incluída sem seq, na ordem da tela', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Incluir PRT420 (8499) de novo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mover Inspeção PTH para o trecho anterior' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(acoes.editarOrdemAction).toHaveBeenCalledTimes(1))
    const fd = acoes.editarOrdemAction.mock.calls[0]![1] as FormData
    expect(JSON.parse(String(fd.get('trechos')))).toEqual([
      { seq: 1, postos: ['SPI'], sn_modo: 'mesmo', faixas: [] },
      { seq: null, codigo: 'PRT420', compels_op: '8499', postos: ['Inspeção PTH'], sn_modo: 'mesmo', faixas: [] },
      { seq: 2, postos: ['Teste', 'Almoxarifado'], sn_modo: 'mesmo', faixas: [{ sn_ini: '1001', sn_fim: '1010' }] },
    ])
  })
})
EOF
python3 - <<'EOF'
p = 'src/app/(app)/shopfloor/ordens-nova/[id]/__tests__/page.test.tsx'
c = open(p, encoding='utf-8').read()
velho = """    expect((p.trechos as { postos: string[] }[])[0]!.postos).toEqual(['Teste'])
  })"""
novo = """    expect((p.trechos as { postos: string[] }[])[0]!.postos).toEqual(['Teste'])
    // sem espelho, sem cadeia: nada para incluir de novo
    expect(p.cadeia).toEqual([])
  })"""
assert c.count(velho) == 1
open(p, 'w', encoding='utf-8').write(c.replace(velho, novo, 1))
EOF
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "src/app/(app)/shopfloor/ordens-nova/[id]/__tests__" --maxWorkers=2`
Expected: FAIL — `Unable to find an accessible element with the role "list" and name "PRTs fora desta OP"`, e no `page.test.tsx` `expected undefined to deeply equal []`.

- [ ] **Step 3: Implementar**

Acrescente ao FIM de `src/app/(app)/shopfloor/ordens/ignorar-prt.tsx`:

```bash
cat >> "src/app/(app)/shopfloor/ordens/ignorar-prt.tsx" <<'EOF'

/** Edição: as PRTs da cadeia do Compels que ficaram fora da OP, cada uma com "Incluir de novo". */
export function PrtsForaDaOp({ prts, aoIncluir }: { prts: TrechoCadastro[]; aoIncluir: (t: TrechoCadastro) => void }) {
  if (prts.length === 0) return null
  return (
    <ul aria-label="PRTs fora desta OP" className="flex flex-col gap-1">
      {prts.map((t) => (
        <li key={`${t.codigo}|${t.compelsOp ?? ''}`} className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm">
          <span className="font-medium text-muted-foreground">{rotuloTrecho(t)}</span>
          <Badge variant="outline">Ignorada</Badge>
          <Button type="button" variant="outline" size="sm" className="ml-auto" aria-label={`Incluir ${rotuloTrecho(t)} de novo`}
            onClick={() => aoIncluir(t)}>
            Incluir de novo
          </Button>
        </li>
      ))}
    </ul>
  )
}
EOF
```

Em `src/app/(app)/shopfloor/ordens-nova/[id]/editar-op-cliente.tsx`, troque:

```tsx
import {
  erroTempoBurnin, faixasDaPmo, postosParaAdicionar, receitaDaRota, rotaDosTrechos, temposDaRota, trechosParaGravar,
} from '@/modules/shopfloor/domain/edicao-op-trechos'
```

por:

```tsx
import {
  erroTempoBurnin, faixasDaPmo, incluirPrt, postosParaAdicionar, prtsForaDaOp, receitaDaRota, rotaDosTrechos, temposDaRota,
  trechosParaGravar,
} from '@/modules/shopfloor/domain/edicao-op-trechos'
```

Troque:

```tsx
import { ReceitasDosPostos, TempoBurninCampo } from '../../ordens/editores-posto'
```

por:

```tsx
import { ReceitasDosPostos, TempoBurninCampo } from '../../ordens/editores-posto'
import { PrtsForaDaOp } from '../../ordens/ignorar-prt'
```

Troque:

```tsx
  tempoBurnin, pmosExistentes = [],
}: {
```

por:

```tsx
  tempoBurnin, pmosExistentes = [], cadeia = [],
}: {
```

Troque:

```tsx
  /** PMOs que podem entrar na receita de um posto de Integração. */
  pmosExistentes?: string[]
}) {
```

por:

```tsx
  /** PMOs que podem entrar na receita de um posto de Integração. */
  pmosExistentes?: string[]
  /** A cadeia do Compels da OP (cadeiaDaOp): as PRTs dela que não são trecho podem ser incluídas de novo. */
  cadeia?: TrechoCadastro[]
}) {
```

Troque:

```tsx
        <CorrenteTrechos trechos={trechos} almox={almoxFixo} idBase={idBase} qtd={qtd} nPainel={nPainel}
          mudarTrecho={mudarTrecho}
```

por:

```tsx
        <PrtsForaDaOp prts={prtsForaDaOp(trechos, cadeia)} aoIncluir={(t) => setTrechos((ts) => incluirPrt(ts, cadeia, t))} />
        <CorrenteTrechos trechos={trechos} almox={almoxFixo} idBase={idBase} qtd={qtd} nPainel={nPainel}
          mudarTrecho={mudarTrecho}
```

Em `src/app/(app)/shopfloor/ordens-nova/[id]/page.tsx`, troque:

```tsx
import { trechosDaOpGravada } from '@/modules/shopfloor/domain/edicao-op-trechos'
```

por:

```tsx
import { cadeiaDaOp, trechosDaOpGravada } from '@/modules/shopfloor/domain/edicao-op-trechos'
```

E troque:

```tsx
        pmosExistentes={pmos}
      />
```

por:

```tsx
        pmosExistentes={pmos}
        cadeia={cadeiaDaOp(trechos, espelho)}
      />
```

- [ ] **Step 4: Rodar e ver passar (com os testes antigos da edição)**

Run: `npx vitest run "src/app/(app)/shopfloor/ordens-nova/[id]/__tests__" --maxWorkers=2`
Expected: PASS — `Test Files 3 passed`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/shopfloor/ordens/ignorar-prt.tsx" "src/app/(app)/shopfloor/ordens-nova/[id]/editar-op-cliente.tsx" "src/app/(app)/shopfloor/ordens-nova/[id]/page.tsx" "src/app/(app)/shopfloor/ordens-nova/[id]/__tests__/editar-op-incluir-prt.test.tsx" "src/app/(app)/shopfloor/ordens-nova/[id]/__tests__/page.test.tsx"
git commit -m "$(cat <<'EOF'
feat(op): edição da OP mostra as PRTs da cadeia fora dela e inclui de novo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Verificação final

**Files:** nenhum (só confere; se algo falhar, corrija na task de origem e faça commit lá).

**Interfaces:** —

- [ ] **Step 1: Toda a suíte que toca OP/trechos**

Run: `npx vitest run "src/app/(app)/shopfloor/ordens" "src/app/(app)/shopfloor/ordens-nova" src/modules/shopfloor --maxWorkers=2`
Expected: PASS — nenhum arquivo falhando (no protótipo: 128 arquivos, 1225 testes).

- [ ] **Step 2: Tipos**

Run: `npx tsc --noEmit -p . ; echo "tsc=$?"`
Expected: nenhuma mensagem de erro e `tsc=0`.

- [ ] **Step 3: Lint dos arquivos tocados**

Run:
```bash
npx eslint src/modules/shopfloor/domain/cadastro-op.ts src/modules/shopfloor/domain/edicao-op-trechos.ts src/modules/shopfloor/domain/erros-trecho.ts src/modules/shopfloor/application/cadastro-op-actions.ts src/modules/shopfloor/application/ordens-actions.ts src/modules/shopfloor/infra/ordem-repository.ts "src/app/(app)/shopfloor/ordens/ignorar-prt.tsx" "src/app/(app)/shopfloor/ordens/nova/nova-op-cliente.tsx" "src/app/(app)/shopfloor/ordens-nova/[id]/editar-op-cliente.tsx" "src/app/(app)/shopfloor/ordens-nova/[id]/page.tsx" src/modules/shopfloor/domain/__tests__/cadastro-op-ignorar.test.ts src/modules/shopfloor/domain/__tests__/edicao-op-incluir-prt.test.ts src/modules/shopfloor/application/__tests__/ordens-actions-incluir-prt.test.ts src/modules/shopfloor/application/__tests__/cadastro-op-actions.test.ts "src/app/(app)/shopfloor/ordens/nova/__tests__/nova-op-ignorar-prt.test.tsx" "src/app/(app)/shopfloor/ordens-nova/[id]/__tests__/editar-op-incluir-prt.test.tsx"; echo "eslint=$?"
```
Expected: sem saída de erro e `eslint=0`.

- [ ] **Step 4: Harness SQL de novo (a migração e os harnesses vizinhos)**

Run: `supabase/tests/rodar-ignorar-prt-test.sh && supabase/tests/rodar-prt-agrupar-test.sh`
Expected: `IGNORAR PRT SQL OK` e `PRT AGRUPAR SQL OK` (o segundo prova que a 0197 segue igual; ele não aplica a 0199).

- [ ] **Step 5: Árvore limpa**

Run: `git status --short`
Expected: só o que já estava fora do controle antes (por exemplo `AGENTS.md` regravado pelo `next dev` e `node_modules/` ignorado); nenhum arquivo da feature pendente.

---

## Depois do plano (fora destas tasks; precisa do usuário)

- Dev → Prod segue o fluxo de sempre: 0199 no banco Dev (`supabase db push`, ver memória "Aplicar migração no Dev"), smoke guiado, merge, 0199 no RDS **antes** do deploy do app.
- Smoke sugerido: Nova OP de uma PMO com 2 PRTs → ignorar uma no modo "manter" → salvar → conferir o log da OP → bipar o último posto da PRT ignorada e ver que a fila do Compels não ganha linha de PRT → editar a OP e "Incluir de novo" sem bipe.
