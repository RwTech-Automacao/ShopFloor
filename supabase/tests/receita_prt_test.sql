-- Prova da 0195 (receita da Integração com PRT da estrutura). Roda depois de estrutura_op_esquema.sql +
-- receita_prt_esquema.sql + 0184 + sf_sn_na_faixa + 0194 + 0066 + 0195.
\set ON_ERROR_STOP on

-- a chamada da Integração com o resto de sempre: sem posto anterior (a sequência não é o que se testa aqui)
create or replace function pg_temp.integ(p_placas jsonb, p_sn text, p_pmo text default 'PMOE', p_op text default '9100',
  p_posto text default 'Integração') returns jsonb language sql as $f$
  select sf_integrar('Fulano', 'C', p_pmo, p_op, p_sn, p_sn, '', false, p_placas, p_posto)
$f$;
create or replace function pg_temp.placa(p_pmo text, p_op text, p_sn text) returns jsonb language sql as $f$
  select jsonb_build_object('pmo', p_pmo, 'op', p_op, 'sn', p_sn, 'sn_norm', p_sn)
$f$;
create or replace function pg_temp.espera(r jsonb, esperado jsonb, caso text) returns void language plpgsql as $f$
begin
  if r is distinct from esperado then raise exception '%: esperava %, veio %', caso, esperado, r; end if;
end $f$;
create or replace function pg_temp.espera_ok(r jsonb, caso text) returns void language plpgsql as $f$
begin
  if not coalesce((r->>'ok')::boolean, false) then raise exception '%: esperava ok, veio %', caso, r; end if;
end $f$;
create or replace function pg_temp.bipe(p_pmo text, p_op text, p_posto text, p_status text, p_sn text) returns void language sql as $f$
  -- data_hora pelo relógio (não o início da transação): o LIFO do cancelamento depende da ordem dos bipes
  insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm, data_hora)
  values (p_posto, p_pmo, p_op, p_status, p_sn, p_sn, clock_timestamp())
$f$;
create or replace function pg_temp.op(p_pmo text, p_op text) returns uuid language sql as $f$
  select id from sf_ordens where pmo = p_pmo and op = p_op
$f$;
create or replace function pg_temp.receita(p_pmo text, p_op text, p_itens text[]) returns void language sql as $f$
  delete from sf_ordem_componentes where ordem_id = pg_temp.op(p_pmo, p_op);
  insert into sf_ordem_componentes (ordem_id, posto, pmo_componente)
  select pg_temp.op(p_pmo, p_op), 'Integração', i from unnest(p_itens) i;
$f$;

-- a OP do produto: PRT410 (série própria, termina num posto com status), PRT420 (série própria, termina num posto de
-- passagem), PRT430 (mesma série) e a PMO com a Integração
select sf_cadastrar_op($j${
  "ordem": {"pmo":"PMOE","op":"9100","cliente":"C","qtd":10,"placas_por_painel":1},
  "trechos": [
    {"seq":1,"codigo":"PRT410","tipo":"prt","compels_op":"9103","sn_modo":"proprio","postos":["SPI","Inspeção AOI TOP"],"faixas":[{"sn_ini":"A001","sn_fim":"A050"}]},
    {"seq":2,"codigo":"PRT420","tipo":"prt","compels_op":"9102","sn_modo":"proprio","postos":["Montagem PTH"],"faixas":[{"sn_ini":"B001","sn_fim":"B050"}]},
    {"seq":3,"codigo":"PRT430","tipo":"prt","compels_op":"9101","sn_modo":"mesmo","postos":["Inspeção PTH"],"faixas":[]},
    {"seq":4,"codigo":"PMOE","tipo":"pmo","compels_op":"9100","postos":["Teste","Integração","Almoxarifado"],"faixas":[{"sn_ini":"100","sn_fim":"199"}]}
  ],
  "componentes": [{"posto":"Integração","pmo":"PRT410"}]}$j$::jsonb);
-- outra OP com a MESMA PRT410 (o caso "placa de outra OP com a mesma PRT")
select sf_cadastrar_op($j${
  "ordem": {"pmo":"PMOF","op":"9200","cliente":"C","qtd":10,"placas_por_painel":1},
  "trechos": [
    {"seq":1,"codigo":"PRT410","tipo":"prt","compels_op":"9201","sn_modo":"proprio","postos":["SPI","Inspeção AOI TOP"],"faixas":[{"sn_ini":"F001","sn_fim":"F050"}]},
    {"seq":2,"codigo":"PMOF","tipo":"pmo","compels_op":"9200","postos":["Teste","Integração","Almoxarifado"],"faixas":[{"sn_ini":"200","sn_fim":"299"}]}
  ]}$j$::jsonb);

do $$
declare r jsonb; v uuid := pg_temp.op('PMOE', '9100'); n int;
begin
  -- a receita da PRT foi gravada pelo cadastro (série própria)
  if (select string_agg(pmo_componente, ',') from sf_ordem_componentes where ordem_id = v) is distinct from 'PRT410' then
    raise exception 'cadastro não gravou a PRT410 na receita';
  end if;

  -- 1) PMO na receita: aceita a placa da PMO, recusa outra, como antes
  perform pg_temp.receita('PMOE', '9100', array['PMOX']);
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PMOX', '7000', 'X1')), '101');
  perform pg_temp.espera_ok(r, 'PMO na receita');
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PMOY', '7001', 'Y1')), '102');
  perform pg_temp.espera(r, '{"ok":false,"erro":"PLACA_FORA_DA_RECEITA","pmo":"PMOY"}', 'PMO fora da receita');
  -- PMO sem diferenciar maiúsculas e espaços, como antes
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa(' pmox ', '7000', 'X2')), '103');
  perform pg_temp.espera_ok(r, 'PMO caixa diferente');

  -- 2) PRT na receita: a placa da própria OP que terminou o trecho
  perform pg_temp.receita('PMOE', '9100', array['PRT410']);
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PRT410', '9100', 'A001')), '110');
  perform pg_temp.espera(r, '{"ok":false,"erro":"PLACA_PRT_INCOMPLETA","placa":"A001","prt":"PRT410","posto":"Inspeção AOI TOP"}', 'PRT sem registro');
  perform pg_temp.bipe('PMOE', '9100', 'SPI', 'Aprovado', 'A001');               -- só o 1º posto do trecho
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PRT410', '9100', 'A001')), '110');
  perform pg_temp.espera(r, '{"ok":false,"erro":"PLACA_PRT_INCOMPLETA","placa":"A001","prt":"PRT410","posto":"Inspeção AOI TOP"}', 'PRT só no 1º posto');
  perform pg_temp.bipe('PMOE', '9100', 'Inspeção AOI TOP', 'Reprovado', 'A001');  -- reprovada no fim do trecho
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PRT410', '9100', 'A001')), '110');
  perform pg_temp.espera(r, '{"ok":false,"erro":"PLACA_PRT_INCOMPLETA","placa":"A001","prt":"PRT410","posto":"Inspeção AOI TOP"}', 'PRT reprovada');
  perform pg_temp.bipe('PMOE', '9100', 'Inspeção AOI TOP', 'Aprovado', 'A001');
  n := (select count(*) from sf_estoque_envios);
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PRT410', '9100', 'A001')), '110');
  perform pg_temp.espera_ok(r, 'PRT concluída');
  -- a integração da placa da PRT não aponta nada no Compels (o registro dela é PRT410/9100, que não é OP)
  if (select count(*) from sf_estoque_envios) <> n then raise exception 'integração da PRT criou linha na fila do Compels'; end if;
  -- as gravações de sempre: a integração, a placa como veio e os dois registros no posto da Integração
  if (select count(*) from sf_integracao_itens i join sf_integracoes g on g.id = i.integracao_id
       where g.codigo = r->>'codigo' and i.placa_pmo = 'PRT410' and i.placa_op = '9100' and i.placa_sn = 'A001') <> 1
     or (select count(*) from sf_registros where id_integracao = r->>'codigo' and posto = 'Integração') <> 2
     or (select qtd_placas from sf_integracoes where codigo = r->>'codigo') <> 1 then
    raise exception 'PRT concluída: gravação diferente da de sempre';
  end if;
  -- código da PRT sem diferenciar maiúsculas; registro de passagem (sem status) basta no fim do trecho de passagem
  perform pg_temp.receita('PMOE', '9100', array['prt420']);
  perform pg_temp.bipe('PMOE', '9100', 'Montagem PTH', '', 'B001');
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PRT420', '9100', 'B001')), '111');
  perform pg_temp.espera_ok(r, 'PRT de passagem');
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('Prt420', '9100', 'B002')), '112');
  perform pg_temp.espera(r, '{"ok":false,"erro":"PLACA_PRT_INCOMPLETA","placa":"B002","prt":"PRT420","posto":"Montagem PTH"}', 'PRT de passagem sem registro');

  -- 3) placa de outra OP com a mesma PRT não vale pela regra da PRT
  perform pg_temp.receita('PMOE', '9100', array['PRT410']);
  perform pg_temp.bipe('PMOF', '9200', 'Inspeção AOI TOP', 'Aprovado', 'F001');
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PRT410', '9200', 'F001')), '120');
  perform pg_temp.espera(r, '{"ok":false,"erro":"PLACA_FORA_DA_RECEITA","pmo":"PRT410"}', 'PRT de outra OP');
  -- nem com o SN concluído só na outra OP: o registro tem que ser da própria PMO/OP
  perform pg_temp.bipe('PMOF', '9200', 'Inspeção AOI TOP', 'Aprovado', 'A002');
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PRT410', '9100', 'A002')), '121');
  perform pg_temp.espera(r, '{"ok":false,"erro":"PLACA_PRT_INCOMPLETA","placa":"A002","prt":"PRT410","posto":"Inspeção AOI TOP"}', 'PRT concluída em outra OP');
  -- a OP SEPARADA com o mesmo código de um trecho de série própria vale pela regra da PMO (decisão 4 da spec)
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PRT410', '8683', 'Z1')), '122');
  perform pg_temp.espera(r, '{"ok":false,"erro":"PLACA_FORA_DA_RECEITA","pmo":"PRT410"}', 'OP 8683 ainda não cadastrada');
  insert into sf_ordens (pmo, op, cliente, sn_ini, sn_fim) values ('PRT410', '8683', 'C', 'Z1', 'Z9');
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PRT410', '8683', 'Z1')), '122');
  perform pg_temp.espera_ok(r, 'OP separada com o código de um trecho de série própria');
  -- e não precisa ter "terminado" nada: PLACA_PRT_INCOMPLETA é só para a placa da própria OP
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PRT410', '8683', 'Z2'), pg_temp.placa('PRT410', '9100', 'A003')), '124');
  perform pg_temp.espera(r, '{"ok":false,"erro":"PLACA_PRT_INCOMPLETA","placa":"A003","prt":"PRT410","posto":"Inspeção AOI TOP"}', 'OP separada + própria incompleta');

  -- PRT de MESMA série na receita no momento do bipe: volta a ser item de PMO, exatamente como antes da 0195
  perform pg_temp.receita('PMOE', '9100', array['PRT430']);
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PRT430', '9100', 'C1')), '125');
  perform pg_temp.espera_ok(r, 'PRT de mesma série: placa da própria OP sem conferir trecho');
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PRT430', '7777', 'C2')), '126');
  perform pg_temp.espera_ok(r, 'PRT de mesma série: qualquer OP pelo código, como antes');
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PRT431', '7777', 'C3')), '127');
  perform pg_temp.espera(r, '{"ok":false,"erro":"PLACA_FORA_DA_RECEITA","pmo":"PRT431"}', 'PRT de mesma série: código diferente fora');

  -- 4) PRT que não é trecho da OP (cadastrada como OP separada) segue pela regra da PMO
  perform pg_temp.receita('PMOE', '9100', array['PRT706']);
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PRT706', '8683', 'P1')), '123');
  perform pg_temp.espera_ok(r, 'PRT como OP separada');

  -- 5) receita mista (PMO + PRT): cada placa pela sua regra
  perform pg_temp.receita('PMOE', '9100', array['PMOX', 'PRT410']);
  perform pg_temp.bipe('PMOE', '9100', 'Inspeção AOI TOP', 'Aprovado', 'A003');
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PMOX', '7000', 'X3'), pg_temp.placa('PRT410', '9100', 'A003')), '130');
  perform pg_temp.espera_ok(r, 'mista ok');
  if (select qtd_placas from sf_integracoes where codigo = r->>'codigo') <> 2 then raise exception 'mista: qtd_placas'; end if;
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PMOX', '7000', 'X4'), pg_temp.placa('PRT410', '9100', 'A004')), '131');
  perform pg_temp.espera(r, '{"ok":false,"erro":"PLACA_PRT_INCOMPLETA","placa":"A004","prt":"PRT410","posto":"Inspeção AOI TOP"}', 'mista PRT incompleta');
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PMOY', '7001', 'Y4'), pg_temp.placa('PRT410', '9100', 'A004')), '132');
  perform pg_temp.espera(r, '{"ok":false,"erro":"PLACA_FORA_DA_RECEITA","pmo":"PMOY"}', 'mista PMO fora (vem antes)');
  -- a recusa não gravou nada
  if exists (select 1 from sf_integracoes where produto_sn in ('131', '132')) then raise exception 'recusa gravou integração'; end if;

  -- 6) receita vazia aceita qualquer placa
  perform pg_temp.receita('PMOE', '9100', array[]::text[]);
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('QUALQUER', '1', 'Q1'), pg_temp.placa('PRT410', '9100', 'A009')), '140');
  perform pg_temp.espera_ok(r, 'receita vazia');

  -- 7) OP sem trechos: receita por PMO como antes
  insert into sf_ordem_postos (ordem_id, posto, ordem) values ('00000000-0000-0000-0000-000000007100', 'Integração', 2);
  perform pg_temp.receita('PMOANT', '7100', array['PMOX']);
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PMOX', '7000', 'X5')), '150', 'PMOANT', '7100');
  perform pg_temp.espera_ok(r, 'OP antiga, PMO');
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PRT410', '7100', 'A010')), '151', 'PMOANT', '7100');
  perform pg_temp.espera(r, '{"ok":false,"erro":"PLACA_FORA_DA_RECEITA","pmo":"PRT410"}', 'OP antiga, código fora');

  -- 8) o resto da função não mudou: duplicidade e permissão
  perform pg_temp.receita('PMOE', '9100', array['PRT410']);
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PRT410', '9100', 'A001')), '160');
  perform pg_temp.espera(r, jsonb_build_object('ok', false, 'erro', 'PLACA_JA_VINCULADA', 'placa', 'A001',
    'codigo', (select g.codigo from sf_integracoes g join sf_integracao_itens i on i.integracao_id = g.id where i.placa_sn = 'A001')), 'placa já vinculada');
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PRT410', '9100', 'A005')), '110');
  if r->>'erro' <> 'PRODUTO_JA_INTEGRADO' then raise exception 'produto já integrado: %', r; end if;
  perform set_config('teste.perms', 'outra', true);
  r := pg_temp.integ(jsonb_build_array(pg_temp.placa('PRT410', '9100', 'A005')), '161');
  perform pg_temp.espera(r, '{"ok":false,"erro":"SEM_PERMISSAO"}', 'sem permissão');
  perform set_config('teste.perms', '', true);
  raise notice 'BIPE OK';
end $$;

-- ---------- 9) a gravação recusa PRT inválida na receita ----------
create or replace function pg_temp.recusa_cadastro(p jsonb, msg text) returns void language plpgsql as $f$
declare antes int := (select count(*) from sf_ordens);
begin
  begin
    perform sf_cadastrar_op(p);
  exception when others then
    if sqlerrm <> msg then raise exception 'cadastro: esperava "%", veio "%"', msg, sqlerrm; end if;
    if (select count(*) from sf_ordens) <> antes then raise exception 'cadastro recusado gravou OP'; end if;
    return;
  end;
  raise exception 'cadastro: esperava "%", mas passou', msg;
end $f$;

do $$
declare base jsonb := $j${
  "ordem": {"pmo":"PMOG","op":"9300","cliente":"C","qtd":10,"placas_por_painel":1},
  "trechos": [
    {"seq":1,"codigo":"PRT510","tipo":"prt","compels_op":"9302","sn_modo":"proprio","postos":["SPI"],"faixas":[{"sn_ini":"G001","sn_fim":"G010"}]},
    {"seq":2,"codigo":"PRT520","tipo":"prt","compels_op":"9301","sn_modo":"mesmo","postos":["Inspeção AOI TOP"],"faixas":[]},
    {"seq":3,"codigo":"PMOG","tipo":"pmo","compels_op":"9300","postos":["Teste","Integração","Almoxarifado"],"faixas":[{"sn_ini":"300","sn_fim":"399"}]}
  ]}$j$::jsonb;
  v uuid; e text;
begin
  -- PRT com a mesma série da PMO: recusada (também em minúsculas)
  perform pg_temp.recusa_cadastro(base || '{"componentes":[{"posto":"Integração","pmo":"PMOX"},{"posto":"Integração","pmo":"PRT520"}]}', 'RECEITA_PRT_INVALIDA:PRT520');
  perform pg_temp.recusa_cadastro(base || '{"componentes":[{"posto":"Integração","pmo":" prt520 "}]}', 'RECEITA_PRT_INVALIDA:prt520');
  -- num posto fora da rota o item não seria gravado: não recusa (e não grava)
  v := sf_cadastrar_op(base || '{"componentes":[{"posto":"Burn-in","pmo":"PRT520"},{"posto":"Integração","pmo":"PRT510"},{"posto":"Integração","pmo":"PMOX"}]}');
  if (select string_agg(posto || '>' || pmo_componente, ',' order by pmo_componente) from sf_ordem_componentes where ordem_id = v)
     is distinct from 'Integração>PMOX,Integração>PRT510' then
    raise exception 'cadastro gravou a receita errada';
  end if;

  -- a edição: PRT 'mesmo' na receita recusa sem mexer em nada
  e := (select string_agg(posto || '>' || pmo_componente, ',' order by pmo_componente) from sf_ordem_componentes where ordem_id = v)
       || '|' || (select string_agg(codigo || ':' || sn_modo, ',' order by seq) from sf_ordem_trechos where ordem_id = v);
  begin
    perform sf_ordem_regravar_trechos(v, $j$[
      {"seq":1,"postos":["SPI"],"sn_modo":"proprio","faixas":[{"sn_ini":"G001","sn_fim":"G010"}]},
      {"seq":2,"postos":["Inspeção AOI TOP"],"sn_modo":"mesmo","faixas":[]},
      {"seq":3,"postos":["Teste","Integração","Almoxarifado"],"faixas":[{"sn_ini":"300","sn_fim":"399"}]}]$j$::jsonb,
      '{"cliente":"C","status":"ATIVA","placas_por_painel":1}', '[{"posto":"Integração","pmo":"PRT520"}]', '[]');
    raise exception 'edição aceitou PRT com a mesma série';
  exception when others then
    if sqlerrm <> 'RECEITA_PRT_INVALIDA:PRT520' then raise; end if;
  end;
  -- a PRT que deixa de ter série própria na MESMA edição também recusa
  begin
    perform sf_ordem_regravar_trechos(v, $j$[
      {"seq":1,"postos":["SPI"],"sn_modo":"mesmo","faixas":[]},
      {"seq":2,"postos":["Inspeção AOI TOP"],"sn_modo":"mesmo","faixas":[]},
      {"seq":3,"postos":["Teste","Integração","Almoxarifado"],"faixas":[{"sn_ini":"300","sn_fim":"399"}]}]$j$::jsonb,
      '{"cliente":"C","status":"ATIVA","placas_por_painel":1}', '[{"posto":"Integração","pmo":"PRT510"}]', '[]');
    raise exception 'edição aceitou PRT que perdeu a série própria';
  exception when others then
    if sqlerrm <> 'RECEITA_PRT_INVALIDA:PRT510' then raise; end if;
  end;
  if (select string_agg(posto || '>' || pmo_componente, ',' order by pmo_componente) from sf_ordem_componentes where ordem_id = v)
       || '|' || (select string_agg(codigo || ':' || sn_modo, ',' order by seq) from sf_ordem_trechos where ordem_id = v) is distinct from e then
    raise exception 'recusa da edição mexeu na OP';
  end if;
  -- a PRT que passa a ter série própria entra; código que não é trecho segue como PMO
  perform sf_ordem_regravar_trechos(v, $j$[
    {"seq":1,"postos":["SPI"],"sn_modo":"proprio","faixas":[{"sn_ini":"G001","sn_fim":"G010"}]},
    {"seq":2,"postos":["Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"H001","sn_fim":"H010"}]},
    {"seq":3,"postos":["Teste","Integração","Almoxarifado"],"faixas":[{"sn_ini":"300","sn_fim":"399"}]}]$j$::jsonb,
    '{"cliente":"C","status":"ATIVA","placas_por_painel":1}',
    '[{"posto":"Integração","pmo":"PRT520"},{"posto":"Integração","pmo":"PRT706"}]', '[]');
  if (select string_agg(pmo_componente, ',' order by pmo_componente) from sf_ordem_componentes where ordem_id = v) is distinct from 'PRT520,PRT706' then
    raise exception 'edição não gravou a receita com a PRT';
  end if;
  -- PRT de mesma série cujo código é também a PMO de uma OP cadastrada (OP separada): vale como PMO, não recusa
  insert into sf_ordens (pmo, op, cliente) values ('PRT520', '8690', 'C');
  perform sf_ordem_regravar_trechos(v, $j$[
    {"seq":1,"postos":["SPI"],"sn_modo":"proprio","faixas":[{"sn_ini":"G001","sn_fim":"G010"}]},
    {"seq":2,"postos":["Inspeção AOI TOP"],"sn_modo":"mesmo","faixas":[]},
    {"seq":3,"postos":["Teste","Integração","Almoxarifado"],"faixas":[{"sn_ini":"300","sn_fim":"399"}]}]$j$::jsonb,
    '{"cliente":"C","status":"ATIVA","placas_por_painel":1}', '[{"posto":"Integração","pmo":"PRT520"}]', '[]');
  v := sf_cadastrar_op(jsonb_set(jsonb_set(base, '{ordem,op}', '"9310"'), '{trechos,2,compels_op}', '"9310"')
                       || '{"componentes":[{"posto":"Integração","pmo":"PRT520"}]}');
  if (select string_agg(pmo_componente, ',') from sf_ordem_componentes where ordem_id = v) is distinct from 'PRT520' then
    raise exception 'cadastro recusou a PRT de mesma série que também é PMO cadastrada';
  end if;
  raise notice 'GRAVACAO OK';
end $$;

-- ---------- 10) cancelar o bipe de uma placa integrada é recusado (sf_cancelar_lancamento) ----------
do $$
declare v_id uuid; v_cod text;
begin
  -- A001 terminou a PRT410 (Aprovado no fim do trecho) e está integrada no produto 110
  select id into v_id from sf_registros where pmo = 'PMOE' and op = '9100' and numero_serie_norm = 'A001'
   order by data_hora desc, id desc limit 1;
  select g.codigo into v_cod from sf_integracoes g join sf_integracao_itens i on i.integracao_id = g.id where i.placa_sn = 'A001';
  begin
    perform sf_cancelar_lancamento(v_id, 'teste');
    raise exception 'cancelou o bipe de uma placa integrada';
  exception when others then
    if sqlerrm <> 'PLACA_INTEGRADA:A001|110|' || v_cod then raise; end if;
  end;
  if not exists (select 1 from sf_registros where id = v_id) then raise exception 'a recusa apagou o registro'; end if;
  -- as recusas de antes continuam vindo primeiro (LIFO)
  begin
    perform sf_cancelar_lancamento((select id from sf_registros where pmo = 'PMOE' and op = '9100' and numero_serie_norm = 'A001' and posto = 'SPI'), 'teste');
    raise exception 'cancelou um bipe que não é o último';
  exception when others then
    if sqlerrm <> 'NAO_E_ULTIMO' then raise; end if;
  end;
  -- desfeita a integração, o cancelamento passa
  update sf_integracoes set status = 'CANCELADA' where codigo = v_cod;
  perform sf_cancelar_lancamento(v_id, 'teste');
  if exists (select 1 from sf_registros where id = v_id) or not exists (select 1 from sf_registros_cancelados where id_original = v_id) then
    raise exception 'cancelamento depois de desfazer a integração não moveu o registro';
  end if;
  -- SN que não é placa integrada cancela como antes
  perform pg_temp.bipe('PMOE', '9100', 'SPI', 'Aprovado', 'A040');
  perform sf_cancelar_lancamento((select id from sf_registros where numero_serie_norm = 'A040'), 'teste');
  raise notice 'CANCELAMENTO OK';
end $$;
