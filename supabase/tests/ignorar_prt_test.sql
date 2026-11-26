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
