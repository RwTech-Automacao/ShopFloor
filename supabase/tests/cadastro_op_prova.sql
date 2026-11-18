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
-- H) privilégios: escrita só pelas funções; anon não executa nada; o cron (sincronizar) é só do service_role
do $$
begin
  if has_function_privilege('anon', 'public.sf_cadastrar_op(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.sf_ordem_regravar_postos(uuid, text[])', 'execute')
     or has_function_privilege('anon', 'public.sf_ordem_regravar_faixas(uuid, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.sf_ultima_op_da_pmo(text)', 'execute') then
    raise exception 'caso H falhou (anon executa função do cadastro)';
  end if;
  if not has_function_privilege('authenticated', 'public.sf_cadastrar_op(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.sf_ordem_regravar_postos(uuid, text[])', 'execute')
     or not has_function_privilege('authenticated', 'public.sf_ordem_regravar_faixas(uuid, jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.sf_ultima_op_da_pmo(text)', 'execute') then
    raise exception 'caso H falhou (authenticated sem execute no cadastro)';
  end if;
  if has_function_privilege('authenticated', 'public.sf_compels_ops_sincronizar(jsonb)', 'execute') then
    raise exception 'caso H falhou (authenticated executa sf_compels_ops_sincronizar)';
  end if;
  if has_table_privilege('authenticated', 'public.sf_compels_ops', 'insert') then
    raise exception 'caso H falhou (authenticated insere em sf_compels_ops)';
  end if;
end $$;

-- I) sincronizar: entrada que não é lista é recusada com LISTA_VAZIA (nunca o erro do jsonb_array_length)
do $$
declare v jsonb;
begin
  foreach v in array array['{}'::jsonb, '"x"'::jsonb, 'null'::jsonb, '[]'::jsonb] loop
    begin
      perform sf_compels_ops_sincronizar(v);
      raise exception 'caso I falhou (% passou)', v;
    exception when raise_exception then
      if sqlerrm <> 'LISTA_VAZIA' then raise exception 'caso I falhou (%: %)', v, sqlerrm; end if;
    end;
  end loop;
  begin
    perform sf_compels_ops_sincronizar(null);
    raise exception 'caso I falhou (null SQL passou)';
  exception when raise_exception then
    if sqlerrm <> 'LISTA_VAZIA' then raise exception 'caso I falhou (null SQL: %)', sqlerrm; end if;
  end;
end $$;
\echo 'PROVA CADASTRO OK'
