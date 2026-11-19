-- Prova da 0194 (sf_ordem_regravar_trechos). Roda depois de estrutura_op_esquema.sql + 0184 + sf_sn_na_faixa + 0194.
\set ON_ERROR_STOP on

-- o perfil dos postos (no banco real: sf_postos.perfil -> sf_posto_perfis.recurso); o Almoxarifado é o recurso 'almoxarifado'
create table if not exists public.sf_posto_perfis (chave text primary key, recurso text not null default 'nenhum');
alter table public.sf_postos add column if not exists perfil text;
insert into public.sf_posto_perfis values ('almox', 'almoxarifado'), ('comum', 'nenhum') on conflict do nothing;
update public.sf_postos set perfil = case when chave = 'Almoxarifado' then 'almox' else 'comum' end;
-- um segundo posto de recurso almoxarifado (ALMOXARIFADO_REPETIDO) e as colunas da OP que a edição grava (0145/0148)
insert into public.sf_postos (chave, ordem, perfil) values ('Almox 2', 9, 'almox'), ('Burn-in', 8, 'comum') on conflict do nothing;
alter table public.sf_ordens add column if not exists reaberta_manual boolean not null default false,
  add column if not exists updated_at timestamptz;

-- o estado inteiro da OP numa linha: rota (posto:ordem:trecho), trechos (codigo:conclui:sn_modo), faixas e a faixa 1 da OP
create or replace function pg_temp.estado(p uuid) returns text language sql as $f$
  select concat_ws(' | ',
    (select string_agg(posto || ':' || ordem || ':' || coalesce(trecho_seq::text, '-'), ',' order by ordem) from sf_ordem_postos where ordem_id = p),
    (select string_agg(codigo || ':' || posto_conclui || ':' || sn_modo, ',' order by seq) from sf_ordem_trechos where ordem_id = p),
    (select string_agg(seq || ':' || sn_ini || '-' || sn_fim || ':' || coalesce(trecho_seq::text, '-'), ',' order by seq) from sf_ordem_faixas where ordem_id = p),
    (select sn_ini || '-' || sn_fim from sf_ordens where id = p))
$f$;

-- o estado inteiro, com os dados da OP, a receita e o Burn-in (o que uma recusa não pode mudar)
create or replace function pg_temp.estado_total(p uuid) returns text language sql as $f$
  select concat_ws(' || ', pg_temp.estado(p),
    (select concat_ws(':', cliente, qtd, descricao, acp, status, finalizada_por, reaberta_manual, embalagem_individual, placas_por_painel, updated_at)
       from sf_ordens where id = p),
    (select string_agg(posto || '>' || pmo_componente, ',' order by posto, pmo_componente) from sf_ordem_componentes where ordem_id = p),
    (select string_agg(posto || '=' || tempo_min, ',' order by posto) from sf_ordem_burnin where ordem_id = p))
$f$;

-- a chamada com os dados de sempre da OP (os casos de dados chamam a função direto)
create or replace function pg_temp.rt(p uuid, trechos jsonb,
  dados jsonb default '{"cliente":"C","status":"ATIVA","placas_por_painel":1}', comp jsonb default '[]', burn jsonb default '[]')
returns void language plpgsql as $f$
begin
  perform sf_ordem_regravar_trechos(p, trechos, dados, comp, burn);
end $f$;

-- recusa: a chamada tem que falhar com `msg` e nada da OP pode mudar
create or replace function pg_temp.recusa(p uuid, entrada text, msg text,
  dados jsonb default '{"cliente":"C","status":"ATIVA","placas_por_painel":1}', comp jsonb default '[]', burn jsonb default '[]')
returns void language plpgsql as $f$
declare antes text := pg_temp.estado_total(p);
begin
  begin
    perform sf_ordem_regravar_trechos(p, entrada::jsonb, dados, comp, burn);
  exception when others then
    if sqlerrm <> msg then raise exception 'esperava "%", veio "%" (entrada %)', msg, sqlerrm, entrada; end if;
    if pg_temp.estado_total(p) is distinct from antes then raise exception 'recusa "%" mexeu na OP: % -> %', msg, antes, pg_temp.estado_total(p); end if;
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
  perform pg_temp.rt(v, $j$[
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
  perform pg_temp.rt(v, $j$[
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
    perform pg_temp.rt(v, format('[%s,{"seq":2,"postos":["Montagem PTH","Não existe"]},%s]', ok1, ok3)::jsonb);
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
  perform pg_temp.rt(v, format('[{"seq":1,"postos":["Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"H001","sn_fim":"H020"},{"sn_ini":"J01","sn_fim":"J02"}]},%s,%s]', h2, h3)::jsonb);
  if pg_temp.estado(v) <> 'Inspeção AOI TOP:0:1,Montagem PTH:1:2,Inspeção PTH:2:2,Teste:3:3,Almoxarifado:4:3 | PRTH1:Inspeção AOI TOP:proprio,PRTH2:Inspeção PTH:mesmo,PMOH:Almoxarifado:mesmo | 1:1-5:3,2:H001-H020:1,3:J01-J02:1 | 1-5' then
    raise exception 'caso E (passa) falhou: %', pg_temp.estado(v);
  end if;
  -- PRTH2 sem histórico: troca de série e de posto final à vontade (SPI entra nela, posto sem registro)
  perform pg_temp.rt(v, format('[{"seq":1,"postos":["Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"H001","sn_fim":"H020"}]},{"seq":2,"postos":["Inspeção PTH","Montagem PTH","SPI"],"sn_modo":"proprio","faixas":[{"sn_ini":"K1","sn_fim":"K9"}]},%s]', h3)::jsonb);
  if (select posto_conclui || ':' || sn_modo from sf_ordem_trechos where ordem_id = v and seq = 2) <> 'SPI:proprio' then raise exception 'caso E (PRTH2) falhou: %', pg_temp.estado(v); end if;
  -- registro num posto do meio da PRT também é histórico
  insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values ('Montagem PTH', 'PMOH', '9900', 'Aprovado', 'K3', 'K3');
  perform pg_temp.recusa(v, format('[{"seq":1,"postos":["Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"H001","sn_fim":"H020"}]},{"seq":2,"postos":["Inspeção PTH","Montagem PTH","SPI"],"sn_modo":"mesmo"},%s]', h3), 'PRT_COM_HISTORICO:PRTH2');
  perform pg_temp.recusa(v, format('[{"seq":1,"postos":["Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"H001","sn_fim":"H020"}]},{"seq":2,"postos":["Inspeção PTH","Montagem PTH","SPI"],"sn_modo":"proprio","faixas":[{"sn_ini":"K4","sn_fim":"K9"}]},%s]', h3), 'PRT_FAIXA_COM_HISTORICO:PRTH2');
  -- cancelar o lançamento (o trigger cancela a entrada intocada): a PRTH1 fica sem histórico e o posto final pode mudar
  delete from sf_registros where pmo = 'PMOH' and op = '9900' and posto = 'Inspeção AOI TOP';
  if exists (select 1 from sf_estoque_envios where ordem_id = v and pmo = 'PRTH1' and cancelado_em is null) then raise exception 'caso E: entrada não cancelou'; end if;
  perform pg_temp.rt(v, format('[{"seq":1,"postos":["NQA","Inspeção AOI TOP","Embalagem"],"sn_modo":"mesmo"},{"seq":2,"postos":["Inspeção PTH","Montagem PTH","SPI"],"sn_modo":"proprio","faixas":[{"sn_ini":"K1","sn_fim":"K9"}]},%s]', h3)::jsonb);
  if (select posto_conclui || ':' || sn_modo from sf_ordem_trechos where ordem_id = v and seq = 1) <> 'Embalagem:mesmo' then raise exception 'caso E (sem histórico) falhou: %', pg_temp.estado(v); end if;
end $$;

-- F) grants: authenticated executa a função (o resto ela faz como dona); anon e as auxiliares, não
do $$
begin
  if has_function_privilege('anon', 'public.sf_ordem_regravar_trechos(uuid, jsonb, jsonb, jsonb, jsonb)', 'execute') then raise exception 'caso F: anon executa'; end if;
  if not has_function_privilege('authenticated', 'public.sf_ordem_regravar_trechos(uuid, jsonb, jsonb, jsonb, jsonb)', 'execute') then raise exception 'caso F: authenticated sem execute'; end if;
  if exists (select 1 from pg_proc where proname = 'sf_ordem_regravar_trechos' and pronargs = 2) then raise exception 'caso F: sobrou a assinatura antiga'; end if;
  if has_function_privilege('authenticated', 'public.sf_faixa_coerente(text, text)', 'execute')
     or has_function_privilege('service_role', 'public.sf_faixa_coerente(text, text)', 'execute')
     or has_function_privilege('service_role', 'public.sf_faixas_sobrepoem(text, text, text, text)', 'execute')
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
  {"seq":3,"postos":["Teste","Embalagem","Almoxarifado"],"faixas":[{"sn_ini":"100","sn_fim":"104"}]}]$j$::jsonb,
  '{"cliente":"C","status":"ATIVA","placas_por_painel":1}'::jsonb, '[]'::jsonb, '[]'::jsonb);
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
  perform pg_temp.rt(v, '[{"seq":1,"postos":["SPI"],"sn_modo":"proprio","faixas":[{"sn_ini":"A001","sn_fim":"A030"}]},{"seq":2,"postos":["Inspeção AOI TOP","Montagem PTH","Inspeção PTH"]},{"seq":3,"postos":["Teste","NQA","Almoxarifado"],"faixas":[{"sn_ini":"100","sn_fim":"105"}]}]'::jsonb);
  perform pg_temp.rt(v, '[{"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"A001","sn_fim":"A030"}]},{"seq":2,"postos":["Montagem PTH","Inspeção PTH"]},{"seq":3,"postos":["Teste","NQA","Almoxarifado"],"faixas":[{"sn_ini":"100","sn_fim":"105"}]}]'::jsonb);
  if pg_temp.estado(v) <> 'SPI:0:1,Inspeção AOI TOP:1:1,Montagem PTH:2:2,Inspeção PTH:3:2,Teste:4:3,NQA:5:3,Almoxarifado:6:3 | PRT410:Inspeção AOI TOP:proprio,PRT420:Inspeção PTH:mesmo,PMOE:Almoxarifado:mesmo | 1:100-105:3,2:A001-A030:1 | 100-105' then
    raise exception 'caso G falhou: %', pg_temp.estado(v);
  end if;
end $$;

-- H) os dados da OP, a receita e o Burn-in na mesma transação, com as regras do editarOrdemAction
do $$
declare v uuid := pg_temp.op('PMOE', '9100'); o record; x text;
  tr jsonb := '[{"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"A001","sn_fim":"A030"}]},{"seq":2,"postos":["Montagem PTH","Inspeção PTH"]},{"seq":3,"postos":["Teste","NQA","Almoxarifado"],"faixas":[{"sn_ini":"100","sn_fim":"105"}]}]';
begin
  perform sf_ordem_regravar_trechos(v, tr,
    '{"cliente":" LINCE ","qtd":6,"descricao":"D","acp":"X","status":"FINALIZADA","embalagem_individual":true,"placas_por_painel":2}',
    '[{"posto":"Teste","pmo":"PMOZ"},{"posto":"Fora","pmo":"PMOW"},{"posto":"Teste","pmo":"PMOZ"},{"posto":"NQA","pmo":" "}]',
    '[{"posto":"NQA","tempo_min":360},{"posto":"Teste","tempo_min":0},{"posto":"Fora","tempo_min":10}]');
  select * into o from sf_ordens where id = v;
  if o.cliente <> 'LINCE' or o.qtd <> 6 or o.descricao <> 'D' or o.acp <> 'X' or o.status <> 'FINALIZADA' or o.finalizada_por <> 'manual'
     or o.reaberta_manual or not o.embalagem_individual or o.placas_por_painel <> 2 or o.updated_at is null or o.sn_ini <> '100' then
    raise exception 'caso H falhou (OP: %)', row_to_json(o);
  end if;
  select string_agg(posto || '>' || pmo_componente, ',') into x from sf_ordem_componentes where ordem_id = v;
  if x is distinct from 'Teste>PMOZ' then raise exception 'caso H falhou (receita: %)', x; end if;
  select string_agg(posto || '=' || tempo_min, ',') into x from sf_ordem_burnin where ordem_id = v;
  if x is distinct from 'NQA=360' then raise exception 'caso H falhou (burn-in: %)', x; end if;
  -- reativar: limpa finalizada_por e liga reaberta_manual; ATIVA -> ATIVA não desliga a marca
  perform sf_ordem_regravar_trechos(v, tr, '{"cliente":"LINCE","status":"ATIVA","placas_por_painel":2}', '[]', '[]');
  select * into o from sf_ordens where id = v;
  if o.finalizada_por is not null or not o.reaberta_manual or o.qtd is not null then raise exception 'caso H falhou (reativar: %)', row_to_json(o); end if;
  perform sf_ordem_regravar_trechos(v, tr, '{"cliente":"LINCE","status":"ATIVA","placas_por_painel":2}', '[]', '[]');
  if not (select reaberta_manual from sf_ordens where id = v) then raise exception 'caso H falhou (a marca caiu)'; end if;
  -- recusas dos dados: nada muda (nem rota, nem receita, nem Burn-in)
  perform sf_ordem_regravar_trechos(v, tr, '{"cliente":"LINCE","status":"ATIVA","placas_por_painel":2}', '[{"posto":"Teste","pmo":"PMOZ"}]', '[{"posto":"NQA","tempo_min":60}]');
  perform pg_temp.recusa(v, tr::text, 'CLIENTE_VAZIO', '{"cliente":"  ","placas_por_painel":2}');
  perform pg_temp.recusa(v, tr::text, 'QTD_INVALIDA', '{"cliente":"C","qtd":-1,"placas_por_painel":2}');
  perform pg_temp.recusa(v, tr::text, 'QTD_INVALIDA', '{"cliente":"C","qtd":"abc","placas_por_painel":2}');
  perform pg_temp.recusa(v, tr::text, 'PLACAS_INVALIDAS', '{"cliente":"C","placas_por_painel":0}');
  perform pg_temp.recusa(v, tr::text, 'PLACAS_INVALIDAS', '{"cliente":"C","placas_por_painel":"x"}');
  perform pg_temp.recusa(v, tr::text, 'PLACAS_INVALIDAS', '{"cliente":"C"}');
  insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values ('Teste', 'PMOE', '9100', 'Aprovado', '101', '101');
  perform pg_temp.recusa(v, tr::text, 'PLACAS_COM_REGISTROS', '{"cliente":"C","placas_por_painel":1}');
  perform sf_ordem_regravar_trechos(v, tr, '{"cliente":"C","placas_por_painel":2}', '[]', '[]'); -- mesmo N: passa
  delete from sf_registros where pmo = 'PMOE' and op = '9100';
end $$;

-- H2) falha na ÚLTIMA escrita (a OP): rota, faixas, receita e Burn-in já regravados voltam todos
create or replace function public.teste_falha_na_op() returns trigger language plpgsql as $f$
begin
  if new.cliente = 'FALHA' then raise exception 'FALHA_SIMULADA'; end if;
  return new;
end $f$;
create trigger teste_falha_na_op before update on public.sf_ordens for each row execute function public.teste_falha_na_op();
do $$
declare v uuid := pg_temp.op('PMOE', '9100');
begin
  perform sf_ordem_regravar_trechos(v, '[{"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"A001","sn_fim":"A030"}]},{"seq":2,"postos":["Montagem PTH","Inspeção PTH"]},{"seq":3,"postos":["Teste","NQA","Almoxarifado"],"faixas":[{"sn_ini":"100","sn_fim":"105"}]}]',
    '{"cliente":"C","placas_por_painel":2}', '[{"posto":"Teste","pmo":"PMOZ"}]', '[{"posto":"NQA","tempo_min":60}]');
  perform pg_temp.recusa(v,
    '[{"seq":1,"postos":["SPI"],"sn_modo":"mesmo"},{"seq":2,"postos":["Inspeção AOI TOP","Montagem PTH","Inspeção PTH","Teste"],"sn_modo":"proprio","faixas":[{"sn_ini":"Q1","sn_fim":"Q9"}]},{"seq":3,"postos":["Embalagem","Almoxarifado"],"faixas":[{"sn_ini":"300","sn_fim":"309"}]}]',
    'FALHA_SIMULADA', '{"cliente":"FALHA","qtd":9,"placas_por_painel":2}', '[{"posto":"Embalagem","pmo":"PMOX"}]', '[{"posto":"Embalagem","tempo_min":5}]');
end $$;
drop trigger teste_falha_na_op on public.sf_ordens;
drop function public.teste_falha_na_op();

-- I) Almoxarifado: um só, e só no fim do trecho da PMO — também numa OP cuja rota gravada não o tinha
select sf_cadastrar_op($j${
  "ordem": {"pmo":"PMON","op":"9300","cliente":"C","qtd":5,"placas_por_painel":1},
  "trechos": [
    {"seq":1,"codigo":"PRTN","tipo":"prt","compels_op":"9301","postos":["SPI"],"faixas":[]},
    {"seq":2,"codigo":"PMON","tipo":"pmo","compels_op":"9300","postos":["Teste"],"faixas":[{"sn_ini":"1","sn_fim":"5"}]}
  ]}$j$::jsonb);
do $$
declare v uuid := pg_temp.op('PMON', '9300'); e uuid := pg_temp.op('PMOE', '9100');
  f text := '"faixas":[{"sn_ini":"1","sn_fim":"5"}]';
begin
  perform pg_temp.recusa(e, '[{"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"A001","sn_fim":"A030"}]},{"seq":2,"postos":["Montagem PTH","Inspeção PTH"]},{"seq":3,"postos":["Teste","NQA","Almox 2","Almoxarifado"],"faixas":[{"sn_ini":"100","sn_fim":"105"}]}]',
    'ALMOXARIFADO_REPETIDO', '{"cliente":"C","placas_por_painel":2}');
  perform pg_temp.recusa(v, format('[{"seq":1,"postos":["SPI","Almoxarifado"]},{"seq":2,"postos":["Teste"],%s}]', f), 'ALMOXARIFADO_FORA_DO_FIM');
  perform pg_temp.recusa(v, format('[{"seq":1,"postos":["SPI"]},{"seq":2,"postos":["Almox 2","Teste"],%s}]', f), 'ALMOXARIFADO_FORA_DO_FIM');
  perform pg_temp.rt(v, format('[{"seq":1,"postos":["SPI"]},{"seq":2,"postos":["Teste","Almox 2"],%s}]', f)::jsonb);
  -- agora a rota gravada tem o Almoxarifado: ele não sai
  perform pg_temp.recusa(v, format('[{"seq":1,"postos":["SPI"]},{"seq":2,"postos":["Teste"],%s}]', f), 'ALMOXARIFADO_FORA_DO_FIM');
end $$;

-- J) faixa da PRT com SN de verdade: o _norm perde zeros e maiúsculas, a conferência usa o SN cru
select sf_cadastrar_op($j${
  "ordem": {"pmo":"PMOL","op":"9500","cliente":"C","qtd":5,"placas_por_painel":1},
  "trechos": [
    {"seq":1,"codigo":"PRTL1","tipo":"prt","compels_op":"9502","sn_modo":"proprio","postos":["SPI","Inspeção AOI TOP"],"faixas":[{"sn_ini":"2511A001","sn_fim":"2511A099"}]},
    {"seq":2,"codigo":"PRTL2","tipo":"prt","compels_op":"9501","sn_modo":"proprio","postos":["Montagem PTH","Inspeção PTH"],"faixas":[{"sn_ini":"0845801001","sn_fim":"0845801099"}]},
    {"seq":3,"codigo":"PMOL","tipo":"pmo","compels_op":"9500","postos":["Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"5"}]}
  ]}$j$::jsonb);
-- numero_serie_norm como o app grava (normalizarSerie: sem zeros à esquerda, minúsculo)
insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values
  ('Inspeção AOI TOP', 'PMOL', '9500', 'Aprovado', '2511A005', '2511a005'),
  ('Inspeção PTH', 'PMOL', '9500', 'Aprovado', '0845801005', '845801005');
do $$
declare v uuid := pg_temp.op('PMOL', '9500');
  p3 text := '{"seq":3,"postos":["Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"5"}]}';
  t1 text := '{"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"%s","sn_fim":"%s"}]}';
  t2 text := '{"seq":2,"postos":["Montagem PTH","Inspeção PTH"],"sn_modo":"proprio","faixas":[{"sn_ini":"%s","sn_fim":"%s"}]}';
begin
  if (select count(*) from sf_estoque_envios where ordem_id = v and alvo in ('2511a005', '845801005')) <> 2 then raise exception 'caso J: a fila não guardou o _norm'; end if;
  -- as mesmas faixas: passa (antes: PRT_FAIXA_COM_HISTORICO)
  perform pg_temp.rt(v, format('[%s,%s,%s]', format(t1, '2511A001', '2511A099'), format(t2, '0845801001', '0845801099'), p3)::jsonb);
  -- faixas maiores, que cobrem os SNs usados: passa
  perform pg_temp.rt(v, format('[%s,%s,%s]', format(t1, '2511A001', '2511A199'), format(t2, '0845801001', '0845801200'), p3)::jsonb);
  -- faixas que deixam o SN usado de fora: recusa
  perform pg_temp.recusa(v, format('[%s,%s,%s]', format(t1, '2511A006', '2511A199'), format(t2, '0845801001', '0845801200'), p3), 'PRT_FAIXA_COM_HISTORICO:PRTL1');
  perform pg_temp.recusa(v, format('[%s,%s,%s]', format(t1, '2511A001', '2511A199'), format(t2, '0845801006', '0845801200'), p3), 'PRT_FAIXA_COM_HISTORICO:PRTL2');
  -- só confere quando a faixa muda: um SN que já estava fora não trava a OP enquanto a faixa fica igual
  insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values ('SPI', 'PMOL', '9500', 'Aprovado', '2511A500', '2511a500');
  perform pg_temp.rt(v, format('[%s,%s,%s]', format(t1, '2511A001', '2511A199'), format(t2, '0845801001', '0845801200'), p3)::jsonb);
  perform pg_temp.recusa(v, format('[%s,%s,%s]', format(t1, '2511A001', '2511A299'), format(t2, '0845801001', '0845801200'), p3), 'PRT_FAIXA_COM_HISTORICO:PRTL1');
end $$;

-- K) as travas contra o bipe estão no lugar
do $$
declare d text;
begin
  d := pg_get_functiondef('public.sf_ordem_regravar_trechos(uuid, jsonb, jsonb, jsonb, jsonb)'::regprocedure);
  if d not like '%pg_advisory_xact_lock(hashtext(v_pmo || ''/'' || v_op)::bigint)%' or d not like '%for update%'
     or strpos(d, 'pg_advisory_xact_lock') > strpos(d, 'for update') then
    raise exception 'caso K: sf_ordem_regravar_trechos sem as travas na ordem do sf_lancar';
  end if;
  foreach d in array array['public.sf_ordem_regravar_postos(uuid, text[])', 'public.sf_ordem_regravar_faixas(uuid, jsonb)'] loop
    if pg_get_functiondef(d::regprocedure) not like '%pg_advisory_xact_lock(hashtext(v_trava_pmo || ''/'' || v_trava_op)::bigint)%'
       or pg_get_functiondef(d::regprocedure) not like '%for update%' then
      raise exception 'caso K: % sem as travas', d;
    end if;
  end loop;
  foreach d in array array['public.sf_trecho_enfileirar()', 'public.sf_trecho_desfazer()'] loop
    if pg_get_functiondef(d::regprocedure) not like '%for key share of o%' then raise exception 'caso K: % sem a trava da OP', d; end if;
  end loop;
end $$;
\echo 'PROVA EDITAR OP TRECHOS OK'
