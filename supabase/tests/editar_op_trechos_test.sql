-- Prova da 0194 (sf_ordem_regravar_trechos). Roda depois de estrutura_op_esquema.sql + 0184 + sf_sn_na_faixa + 0194.
\set ON_ERROR_STOP on

-- o perfil dos postos (no banco real: sf_postos.perfil -> sf_posto_perfis.recurso); o Almoxarifado é o recurso 'almoxarifado'
create table if not exists public.sf_posto_perfis (chave text primary key, recurso text not null default 'nenhum');
alter table public.sf_postos add column if not exists perfil text;
insert into public.sf_posto_perfis values ('almox', 'almoxarifado'), ('comum', 'nenhum') on conflict do nothing;
update public.sf_postos set perfil = case when chave = 'Almoxarifado' then 'almox' else 'comum' end;

-- o estado inteiro da OP numa linha: rota (posto:ordem:trecho), trechos (codigo:conclui:sn_modo), faixas e a faixa 1 da OP
create or replace function pg_temp.estado(p uuid) returns text language sql as $f$
  select concat_ws(' | ',
    (select string_agg(posto || ':' || ordem || ':' || coalesce(trecho_seq::text, '-'), ',' order by ordem) from sf_ordem_postos where ordem_id = p),
    (select string_agg(codigo || ':' || posto_conclui || ':' || sn_modo, ',' order by seq) from sf_ordem_trechos where ordem_id = p),
    (select string_agg(seq || ':' || sn_ini || '-' || sn_fim || ':' || coalesce(trecho_seq::text, '-'), ',' order by seq) from sf_ordem_faixas where ordem_id = p),
    (select sn_ini || '-' || sn_fim from sf_ordens where id = p))
$f$;

-- recusa: a chamada tem que falhar com `msg` e o estado da OP não pode mudar
create or replace function pg_temp.recusa(p uuid, entrada text, msg text) returns void language plpgsql as $f$
declare antes text := pg_temp.estado(p);
begin
  begin
    perform sf_ordem_regravar_trechos(p, entrada::jsonb);
  exception when others then
    if sqlerrm <> msg then raise exception 'esperava "%", veio "%" (entrada %)', msg, sqlerrm, entrada; end if;
    if pg_temp.estado(p) is distinct from antes then raise exception 'recusa "%" mexeu na OP: % -> %', msg, antes, pg_temp.estado(p); end if;
    return;
  end;
  raise exception 'esperava "%", mas passou (entrada %)', msg, entrada;
end $f$;

create or replace function pg_temp.op(p_pmo text, p_op text) returns uuid language sql as $f$
  select id from sf_ordens where pmo = p_pmo and op = p_op
$f$;

select sf_cadastrar_op($j${
  "ordem": {"pmo":"PMOE","op":"9100","cliente":"C","qtd":5,"placas_por_painel":1},
  "trechos": [
    {"seq":1,"codigo":"PRT410","tipo":"prt","compels_op":"9102","sn_modo":"proprio","postos":["SPI","Inspeção AOI TOP"],"faixas":[{"sn_ini":"A001","sn_fim":"A010"}]},
    {"seq":2,"codigo":"PRT420","tipo":"prt","compels_op":"9101","sn_modo":"mesmo","postos":["Montagem PTH","Inspeção PTH"],"faixas":[]},
    {"seq":3,"codigo":"PMOE","tipo":"pmo","compels_op":"9100","postos":["Teste","Embalagem","Almoxarifado"],"faixas":[{"sn_ini":"100","sn_fim":"104"}]}
  ]}$j$::jsonb);

-- A) caminho feliz, sem histórico: posto atravessa trechos pelas pontas, PRT troca de série, faixas de todos
do $$
declare v uuid := pg_temp.op('PMOE', '9100'); e text;
begin
  perform sf_ordem_regravar_trechos(v, $j$[
    {"seq":1,"postos":["SPI"],"sn_modo":"proprio","faixas":[{"sn_ini":"A001","sn_fim":"A020"}]},
    {"seq":2,"postos":["Inspeção AOI TOP","Montagem PTH","Inspeção PTH"," Teste "],"sn_modo":"proprio","faixas":[{"sn_ini":"B01","sn_fim":"B05"}]},
    {"seq":3,"postos":["Embalagem","Almoxarifado"],"sn_modo":"proprio","faixas":[{"sn_ini":"100","sn_fim":"109"},{"sn_ini":"200","sn_fim":"201"}]}
  ]$j$::jsonb);
  e := pg_temp.estado(v);
  if e <> 'SPI:0:1,Inspeção AOI TOP:1:2,Montagem PTH:2:2,Inspeção PTH:3:2,Teste:4:2,Embalagem:5:3,Almoxarifado:6:3'
         || ' | PRT410:SPI:proprio,PRT420:Teste:proprio,PMOE:Almoxarifado:mesmo'
         || ' | 1:100-109:3,2:200-201:3,3:A001-A020:1,4:B01-B05:2 | 100-109' then
    raise exception 'caso A falhou: %', e;
  end if;
  -- PRT volta para 'mesmo': as faixas dela somem (a lista que vier é ignorada)
  perform sf_ordem_regravar_trechos(v, $j$[
    {"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"A001","sn_fim":"A010"}]},
    {"seq":2,"postos":["Montagem PTH","Inspeção PTH"],"sn_modo":"mesmo","faixas":[{"sn_ini":"B01","sn_fim":"B05"}]},
    {"seq":3,"postos":["Teste","Embalagem","Almoxarifado"],"faixas":[{"sn_ini":"100","sn_fim":"104"}]}
  ]$j$::jsonb);
  e := pg_temp.estado(v);
  if e <> 'SPI:0:1,Inspeção AOI TOP:1:1,Montagem PTH:2:2,Inspeção PTH:3:2,Teste:4:3,Embalagem:5:3,Almoxarifado:6:3'
         || ' | PRT410:Inspeção AOI TOP:proprio,PRT420:Inspeção PTH:mesmo,PMOE:Almoxarifado:mesmo'
         || ' | 1:100-104:3,2:A001-A010:1 | 100-104' then
    raise exception 'caso A (volta) falhou: %', e;
  end if;
  -- o bipe segue o posto_conclui novo: a PRT410 é apontada na Inspeção AOI TOP
  insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values ('Inspeção AOI TOP', 'PMOE', '9100', 'Aprovado', 'A003', 'A003');
  if (select count(*) from sf_estoque_envios where ordem_id = v and pmo = 'PRT410' and op = '9102') <> 1 then raise exception 'caso A falhou (fila)'; end if;
  delete from sf_registros where pmo = 'PMOE' and op = '9100';
end $$;

-- B) recusas (as travas de sempre e as novas): nada muda
do $$
declare v uuid := pg_temp.op('PMOE', '9100');
  ok1 text := '{"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"A001","sn_fim":"A010"}]}';
  ok2 text := '{"seq":2,"postos":["Montagem PTH","Inspeção PTH"],"sn_modo":"mesmo","faixas":[]}';
  ok3 text := '{"seq":3,"postos":["Teste","Embalagem","Almoxarifado"],"faixas":[{"sn_ini":"100","sn_fim":"104"}]}';
begin
  perform pg_temp.recusa(v, format('[%s,%s]', ok1, ok3), 'TRECHOS_DIFERENTES');
  perform pg_temp.recusa(v, format('[%s,%s,%s,{"seq":9,"postos":["NQA"]}]', ok1, ok2, ok3), 'TRECHOS_DIFERENTES');
  perform pg_temp.recusa(v, format('[%s,%s,%s]', ok1, ok1, ok3), 'TRECHOS_DIFERENTES');
  perform pg_temp.recusa(v, format('[%s,%s,{"seq":4,"postos":["Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"2"}]}]', ok1, ok2), 'TRECHOS_DIFERENTES');
  perform pg_temp.recusa(v, '{}', 'TRECHOS_DIFERENTES');
  perform pg_temp.recusa(v, format('[%s,{"seq":2,"postos":["Montagem PTH","Teste "]},%s]', ok1, ok3), 'POSTO_REPETIDO:Teste');
  perform pg_temp.recusa(v, format('[%s,{"seq":2,"postos":[" "]},%s]', ok1, ok3), 'TRECHO_SEM_POSTO:PRT420');
  perform pg_temp.recusa(v, format('[%s,%s,{"seq":3,"postos":["Teste","Almoxarifado","Embalagem"],"faixas":[{"sn_ini":"100","sn_fim":"104"}]}]', ok1, ok2), 'ALMOXARIFADO_FORA_DO_FIM');
  perform pg_temp.recusa(v, format('[%s,%s,{"seq":3,"postos":["Teste","Embalagem"],"faixas":[{"sn_ini":"100","sn_fim":"104"}]}]', ok1, ok2), 'ALMOXARIFADO_FORA_DO_FIM');
  perform pg_temp.recusa(v, format('[%s,{"seq":2,"postos":["Montagem PTH","Almoxarifado"]},{"seq":3,"postos":["Teste","Embalagem","Inspeção PTH"],"faixas":[{"sn_ini":"100","sn_fim":"104"}]}]', ok1), 'ALMOXARIFADO_FORA_DO_FIM');
  perform pg_temp.recusa(v, format('[%s,{"seq":2,"postos":["Montagem PTH","Inspeção PTH"],"sn_modo":"outro"},%s]', ok1, ok3), 'SN_MODO_INVALIDO:PRT420');
  perform pg_temp.recusa(v, format('[%s,%s,{"seq":3,"postos":["Teste","Embalagem","Almoxarifado"],"faixas":[]}]', ok1, ok2), 'TRECHO_SEM_FAIXA:PMOE');
  perform pg_temp.recusa(v, format('[{"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"proprio"},%s,%s]', ok2, ok3), 'TRECHO_SEM_FAIXA:PRT410');
  perform pg_temp.recusa(v, format('[%s,{"seq":2,"postos":["Montagem PTH","Inspeção PTH"],"sn_modo":"proprio","faixas":[]},%s]', ok1, ok3), 'TRECHO_SEM_FAIXA:PRT420');
  perform pg_temp.recusa(v, format('[{"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"A010","sn_fim":"A001"}]},%s,%s]', ok2, ok3), 'FAIXA_INVALIDA:PRT410');
  perform pg_temp.recusa(v, format('[{"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"A001","sn_fim":"B010"}]},%s,%s]', ok2, ok3), 'FAIXA_INVALIDA:PRT410');
  perform pg_temp.recusa(v, format('[%s,%s,{"seq":3,"postos":["Teste","Embalagem","Almoxarifado"],"faixas":[{"sn_ini":"100","sn_fim":""}]}]', ok1, ok2), 'FAIXA_INVALIDA:PMOE');
  perform pg_temp.recusa(v, format('[{"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"102","sn_fim":"120"}]},%s,%s]', ok2, ok3), 'FAIXA_SOBREPOSTA:PRT410');
  perform pg_temp.recusa(v, format('[%s,%s,{"seq":3,"postos":["Teste","Embalagem","Almoxarifado"],"faixas":[{"sn_ini":"100","sn_fim":"104"},{"sn_ini":"104","sn_fim":"110"}]}]', ok1, ok2), 'FAIXA_SOBREPOSTA:PMOE');
  -- posto fora do catálogo: a FK de sf_ordem_postos recusa, e a transação inteira volta
  begin
    perform sf_ordem_regravar_trechos(v, format('[%s,{"seq":2,"postos":["Montagem PTH","Não existe"]},%s]', ok1, ok3)::jsonb);
    raise exception 'caso B falhou (posto desconhecido passou)';
  exception when foreign_key_violation then null;
  end;
  if pg_temp.estado(v) not like 'SPI:0:1,Inspeção AOI TOP:1:1,Montagem PTH:2:2,Inspeção PTH:3:2,%' then raise exception 'caso B: posto desconhecido mexeu'; end if;
  perform pg_temp.recusa('00000000-0000-0000-0000-000000000999', '[]', 'OP_INEXISTENTE');
end $$;

-- C) OP antiga (sem trechos): recusada e intocada
do $$
declare v uuid := '00000000-0000-0000-0000-000000007100'; antes text := pg_temp.estado('00000000-0000-0000-0000-000000007100');
begin
  perform pg_temp.recusa(v, '[{"seq":1,"postos":["Teste"],"faixas":[{"sn_ini":"1","sn_fim":"2"}]}]', 'OP_SEM_TRECHOS');
  if pg_temp.estado(v) <> 'Teste:0:-,Almoxarifado:1:- | 1:100-199:- | 100-199' then raise exception 'caso C: OP antiga mudou: %', pg_temp.estado(v); end if;
end $$;

-- D) sem permissão
do $$
begin
  perform set_config('teste.perms', 'shopfloor.visualizar', false);
  perform pg_temp.recusa(pg_temp.op('PMOE', '9100'), '[]', 'sem permissão');
  perform set_config('teste.perms', '', false);
end $$;

-- E) histórico
select sf_cadastrar_op($j${
  "ordem": {"pmo":"PMOH","op":"9900","cliente":"C","qtd":5,"placas_por_painel":1},
  "trechos": [
    {"seq":1,"codigo":"PRTH1","tipo":"prt","compels_op":"9902","sn_modo":"proprio","postos":["SPI","Inspeção AOI TOP"],"faixas":[{"sn_ini":"H001","sn_fim":"H010"}]},
    {"seq":2,"codigo":"PRTH2","tipo":"prt","compels_op":"9901","sn_modo":"mesmo","postos":["Montagem PTH","Inspeção PTH"],"faixas":[]},
    {"seq":3,"codigo":"PMOH","tipo":"pmo","compels_op":"9900","postos":["Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"5"}]}
  ]}$j$::jsonb);
insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values
  ('Inspeção AOI TOP', 'PMOH', '9900', 'Aprovado', 'H005', 'H005'),
  ('Teste', 'PMOH', '9900', 'Aprovado', '3', '3');
do $$
declare v uuid := pg_temp.op('PMOH', '9900');
  h2 text := '{"seq":2,"postos":["Montagem PTH","Inspeção PTH"],"sn_modo":"mesmo"}';
  h3 text := '{"seq":3,"postos":["Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"5"}]}';
begin
  if (select count(*) from sf_estoque_envios where ordem_id = v and pmo = 'PRTH1' and cancelado_em is null) <> 1 then raise exception 'caso E: fila não montou'; end if;
  -- posto com registro não troca de trecho (nem o da PRT, nem o da PMO)
  perform pg_temp.recusa(v, format('[{"seq":1,"postos":["SPI"],"sn_modo":"proprio","faixas":[{"sn_ini":"H001","sn_fim":"H010"}]},{"seq":2,"postos":["Inspeção AOI TOP","Montagem PTH","Inspeção PTH"]},%s]', h3), 'POSTO_COM_REGISTROS:Inspeção AOI TOP');
  perform pg_temp.recusa(v, '[{"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"H001","sn_fim":"H010"}]},{"seq":2,"postos":["Montagem PTH","Inspeção PTH","Teste"]},{"seq":3,"postos":["Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"5"}]}]', 'POSTO_COM_REGISTROS:Teste');
  -- PRT com histórico: não troca o posto final, nem a série; faixa só cresce
  perform pg_temp.recusa(v, format('[{"seq":1,"postos":["Inspeção AOI TOP","SPI"],"sn_modo":"proprio","faixas":[{"sn_ini":"H001","sn_fim":"H010"}]},%s,%s]', h2, h3), 'PRT_COM_HISTORICO:PRTH1');
  perform pg_temp.recusa(v, format('[{"seq":1,"postos":["SPI","Inspeção AOI TOP","NQA"],"sn_modo":"proprio","faixas":[{"sn_ini":"H001","sn_fim":"H010"}]},%s,%s]', h2, h3), 'PRT_COM_HISTORICO:PRTH1');
  perform pg_temp.recusa(v, format('[{"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"mesmo"},%s,%s]', h2, h3), 'PRT_COM_HISTORICO:PRTH1');
  perform pg_temp.recusa(v, format('[{"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"H006","sn_fim":"H010"}]},%s,%s]', h2, h3), 'PRT_FAIXA_COM_HISTORICO:PRTH1');
  -- o que não mexe no histórico passa: faixa maior + outra faixa; SPI sai da PRTH1 (não é o posto final, sem registro)
  perform sf_ordem_regravar_trechos(v, format('[{"seq":1,"postos":["Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"H001","sn_fim":"H020"},{"sn_ini":"J01","sn_fim":"J02"}]},%s,%s]', h2, h3)::jsonb);
  if pg_temp.estado(v) <> 'Inspeção AOI TOP:0:1,Montagem PTH:1:2,Inspeção PTH:2:2,Teste:3:3,Almoxarifado:4:3 | PRTH1:Inspeção AOI TOP:proprio,PRTH2:Inspeção PTH:mesmo,PMOH:Almoxarifado:mesmo | 1:1-5:3,2:H001-H020:1,3:J01-J02:1 | 1-5' then
    raise exception 'caso E (passa) falhou: %', pg_temp.estado(v);
  end if;
  -- PRTH2 sem histórico: troca de série e de posto final à vontade (SPI entra nela, posto sem registro)
  perform sf_ordem_regravar_trechos(v, format('[{"seq":1,"postos":["Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"H001","sn_fim":"H020"}]},{"seq":2,"postos":["Inspeção PTH","Montagem PTH","SPI"],"sn_modo":"proprio","faixas":[{"sn_ini":"K1","sn_fim":"K9"}]},%s]', h3)::jsonb);
  if (select posto_conclui || ':' || sn_modo from sf_ordem_trechos where ordem_id = v and seq = 2) <> 'SPI:proprio' then raise exception 'caso E (PRTH2) falhou: %', pg_temp.estado(v); end if;
  -- registro num posto do meio da PRT também é histórico
  insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values ('Montagem PTH', 'PMOH', '9900', 'Aprovado', 'K3', 'K3');
  perform pg_temp.recusa(v, format('[{"seq":1,"postos":["Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"H001","sn_fim":"H020"}]},{"seq":2,"postos":["Inspeção PTH","Montagem PTH","SPI"],"sn_modo":"mesmo"},%s]', h3), 'PRT_COM_HISTORICO:PRTH2');
  perform pg_temp.recusa(v, format('[{"seq":1,"postos":["Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"H001","sn_fim":"H020"}]},{"seq":2,"postos":["Inspeção PTH","Montagem PTH","SPI"],"sn_modo":"proprio","faixas":[{"sn_ini":"K4","sn_fim":"K9"}]},%s]', h3), 'PRT_FAIXA_COM_HISTORICO:PRTH2');
  -- cancelar o lançamento (o trigger cancela a entrada intocada): a PRTH1 fica sem histórico e o posto final pode mudar
  delete from sf_registros where pmo = 'PMOH' and op = '9900' and posto = 'Inspeção AOI TOP';
  if exists (select 1 from sf_estoque_envios where ordem_id = v and pmo = 'PRTH1' and cancelado_em is null) then raise exception 'caso E: entrada não cancelou'; end if;
  perform sf_ordem_regravar_trechos(v, format('[{"seq":1,"postos":["NQA","Inspeção AOI TOP","Embalagem"],"sn_modo":"mesmo"},{"seq":2,"postos":["Inspeção PTH","Montagem PTH","SPI"],"sn_modo":"proprio","faixas":[{"sn_ini":"K1","sn_fim":"K9"}]},%s]', h3)::jsonb);
  if (select posto_conclui || ':' || sn_modo from sf_ordem_trechos where ordem_id = v and seq = 1) <> 'Embalagem:mesmo' then raise exception 'caso E (sem histórico) falhou: %', pg_temp.estado(v); end if;
end $$;

-- F) grants: authenticated executa a função (o resto ela faz como dona); anon e as auxiliares, não
do $$
begin
  if has_function_privilege('anon', 'public.sf_ordem_regravar_trechos(uuid, jsonb)', 'execute') then raise exception 'caso F: anon executa'; end if;
  if not has_function_privilege('authenticated', 'public.sf_ordem_regravar_trechos(uuid, jsonb)', 'execute') then raise exception 'caso F: authenticated sem execute'; end if;
  if has_function_privilege('authenticated', 'public.sf_faixa_coerente(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.sf_faixas_sobrepoem(text, text, text, text)', 'execute') then
    raise exception 'caso F: auxiliar exposta';
  end if;
  if not has_function_privilege('authenticated', 'public.sf_ordem_regravar_postos(uuid, text[])', 'execute')
     or not has_function_privilege('authenticated', 'public.sf_ordem_regravar_faixas(uuid, jsonb)', 'execute') then
    raise exception 'caso F: as funções da 0184 perderam o grant';
  end if;
end $$;
-- como authenticated de verdade (sem escrita direta nas tabelas): grava pela função
revoke insert, update, delete on public.sf_ordem_postos, public.sf_ordem_faixas from authenticated;
select id as v_pmoe from sf_ordens where pmo = 'PMOE' and op = '9100' \gset
set role authenticated;
select sf_ordem_regravar_trechos(:'v_pmoe', $j$[
  {"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"A001","sn_fim":"A030"}]},
  {"seq":2,"postos":["Montagem PTH","Inspeção PTH"],"sn_modo":"mesmo"},
  {"seq":3,"postos":["Teste","Embalagem","Almoxarifado"],"faixas":[{"sn_ini":"100","sn_fim":"104"}]}]$j$::jsonb);
reset role;
do $$
begin
  if not exists (select 1 from sf_ordem_faixas f join sf_ordens o on o.id = f.ordem_id where o.pmo = 'PMOE' and f.sn_fim = 'A030') then
    raise exception 'caso F: authenticated não gravou pela função';
  end if;
end $$;

-- G) as funções da 0184 continuam funcionando e duas chamadas na mesma transação (tabelas temporárias) não se atrapalham
do $$
declare v uuid := pg_temp.op('PMOE', '9100');
begin
  perform sf_ordem_regravar_postos(v, array['SPI','Inspeção AOI TOP','Montagem PTH','Inspeção PTH','Teste','NQA','Almoxarifado']);
  perform sf_ordem_regravar_faixas(v, '[{"sn_ini":"100","sn_fim":"105"}]'::jsonb);
  perform sf_ordem_regravar_trechos(v, '[{"seq":1,"postos":["SPI"],"sn_modo":"proprio","faixas":[{"sn_ini":"A001","sn_fim":"A030"}]},{"seq":2,"postos":["Inspeção AOI TOP","Montagem PTH","Inspeção PTH"]},{"seq":3,"postos":["Teste","NQA","Almoxarifado"],"faixas":[{"sn_ini":"100","sn_fim":"105"}]}]'::jsonb);
  perform sf_ordem_regravar_trechos(v, '[{"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"A001","sn_fim":"A030"}]},{"seq":2,"postos":["Montagem PTH","Inspeção PTH"]},{"seq":3,"postos":["Teste","NQA","Almoxarifado"],"faixas":[{"sn_ini":"100","sn_fim":"105"}]}]'::jsonb);
  if pg_temp.estado(v) <> 'SPI:0:1,Inspeção AOI TOP:1:1,Montagem PTH:2:2,Inspeção PTH:3:2,Teste:4:3,NQA:5:3,Almoxarifado:6:3 | PRT410:Inspeção AOI TOP:proprio,PRT420:Inspeção PTH:mesmo,PMOE:Almoxarifado:mesmo | 1:100-105:3,2:A001-A030:1 | 100-105' then
    raise exception 'caso G falhou: %', pg_temp.estado(v);
  end if;
end $$;
\echo 'PROVA EDITAR OP TRECHOS OK'
