-- Testes das PEÇAS AVULSAS (0158/0159): OP INDIVIDUAL cujo posto anterior ao Almoxarifado não é NQA entra
-- peça por peça. sf_almox_pendencias devolve 1 linha tipo 'peca' (codigo 'AVULSAS') por OP elegível e
-- sf_almox_detalhe aceita p_codigo = 'AVULSAS'. Roda DEPOIS do almoxarifado_pendencias_test.sql, na mesma base
-- (reaproveita stubs, perfis, postos e os atalhos teste_reg/teste_caixa/teste_lote). Massa própria (PMOP*).
-- Runner: supabase/tests/rodar-almoxarifado-test.sh

select set_config('teste.perms',
  'recebimento.lancar,shopfloor.lancar,shopfloor.visualizar,lancar', false);

insert into public.sf_ordens (pmo, op, cliente, sn_ini, sn_fim, embalagem_individual, status, qtd) values
  ('PMOP01', '9501', 'Cliente P', '9000', '9100', true,  'EM PRODUCAO', 12),  -- individual, anterior = Embalagem
  ('PMOP02', '9502', 'Cliente P', '9100', '9200', true,  'EM PRODUCAO', 12),  -- individual, anterior com gate aprovado
  ('PMOP03', '9503', 'Cliente P', '9200', '9300', true,  'EM PRODUCAO', 12),  -- individual, anterior = NQA
  ('PMOP04', '9504', 'Cliente P', '9300', '9400', false, 'EM PRODUCAO', 12),  -- coletiva
  ('PMOP05', '9505', 'Cliente P', '9400', '9500', true,  'FINALIZADA',  12),  -- finalizada
  ('PMOP06', '9506', 'Cliente P', '9500', '9600', true,  'EM PRODUCAO', 12),  -- sem Almoxarifado na rota
  ('PMOP07', '9507', 'Cliente P', '9600', '9700', true,  'EM PRODUCAO', 12),  -- sem ninguém esperando
  ('PMOP08', '9508', 'Cliente P', '9700', '9800', true,  'EM PRODUCAO', 12);  -- Almoxarifado é o primeiro da rota
do $t$ begin
  perform public.teste_op_postos('PMOP01', '9501', array['Embalagem', 'Almoxarifado']);
  perform public.teste_op_postos('PMOP02', '9502', array['Embalagem', 'Inspeção Saída', 'Almoxarifado']);
  perform public.teste_op_postos('PMOP03', '9503', array['Embalagem', 'Inspeção NQA', 'Almoxarifado']);
  perform public.teste_op_postos('PMOP04', '9504', array['Embalagem', 'Almoxarifado']);
  perform public.teste_op_postos('PMOP05', '9505', array['Embalagem', 'Almoxarifado']);
  perform public.teste_op_postos('PMOP06', '9506', array['Embalagem', 'Inspeção Final']);
  perform public.teste_op_postos('PMOP07', '9507', array['Embalagem', 'Almoxarifado']);
  perform public.teste_op_postos('PMOP08', '9508', array['Almoxarifado', 'Embalagem']);
end $t$;

-- =============================================================
-- P1. OP individual, anterior Embalagem, 5 peças → 1 linha 'peca' (a); entrada de 2 → 3 (b)
-- =============================================================
do $t$
declare v record; n int; v_t timestamptz := now() - interval '4 hours'; v_max timestamptz;
begin
  perform teste_reg('PMOP01', '9501', 'Embalagem', s::text, '', '', v_t + (s - 9000) * interval '1 minute')
    from generate_series(9000, 9004) s;
  select max(data_hora) into v_max from sf_registros where pmo = 'PMOP01';

  select count(*) into n from sf_almox_pendencias() p where p.pmo = 'PMOP01';
  select * into v from sf_almox_pendencias() p where p.pmo = 'PMOP01';
  if n <> 1 or v.tipo <> 'peca' or v.codigo <> 'AVULSAS' or v.pecas <> 5 or v.op <> '9501'
     or v.seq is not null or v.lote_id is not null or v.amostra is not null or v.ja_lancadas <> 0
     or v.em is distinct from v_max then
    raise exception 'FALHOU (P1a): % linhas, %', n, row_to_json(v); end if;

  perform teste_reg('PMOP01', '9501', 'Almoxarifado', s::text, '') from generate_series(9000, 9001) s;
  select * into v from sf_almox_pendencias() p where p.pmo = 'PMOP01';
  if v.pecas <> 3 then raise exception 'FALHOU (P1b): esperava 3, veio %', row_to_json(v); end if;
  raise notice 'P1. OP individual sem NQA: 1 linha peca com 5 peças; depois de 2 entradas, 3: ok';
end $t$;

-- =============================================================
-- P2. anterior com gate 'aprovado': só conta Aprovado (c)
-- =============================================================
do $t$
declare v record;
begin
  perform teste_reg('PMOP02', '9502', 'Inspeção Saída', '9100', 'Aprovado');
  perform teste_reg('PMOP02', '9502', 'Inspeção Saída', '9101', 'Reprovado');
  perform teste_reg('PMOP02', '9502', 'Inspeção Saída', '9102', 'Aprovado');
  -- reprovou e depois aprovou: conta (existe registro Aprovado)
  perform teste_reg('PMOP02', '9502', 'Inspeção Saída', '9103', 'Reprovado', '', now() - interval '2 hours');
  perform teste_reg('PMOP02', '9502', 'Inspeção Saída', '9103', 'Aprovado',  '', now() - interval '1 hour');
  select * into v from sf_almox_pendencias() p where p.pmo = 'PMOP02';
  if v.tipo <> 'peca' or v.pecas <> 3 then
    raise exception 'FALHOU (P2c): esperava 3 aprovadas, veio %', row_to_json(v); end if;
  raise notice 'P2. gate aprovado: só as peças com registro Aprovado esperam: ok';
end $t$;

-- =============================================================
-- P3. NQA continua LOTE, coletiva continua CAIXA, finalizada / sem Almoxarifado / zero / primeiro posto: nada (d,e,f,g)
-- =============================================================
do $t$
declare v record; n int; v_lote uuid;
begin
  perform teste_reg('PMOP03', '9503', 'Embalagem', s::text, '', s::text) from generate_series(9200, 9204) s;
  v_lote := teste_lote('PMOP03', '9503', array['9200','9201','9202','9203','9204'], 'Aprovado');
  select count(*) into n from sf_almox_pendencias() p where p.pmo = 'PMOP03' and p.tipo = 'peca';
  if n <> 0 then raise exception 'FALHOU (P3d): OP com NQA anterior gerou peca'; end if;
  select * into v from sf_almox_pendencias() p where p.pmo = 'PMOP03';
  if v.tipo <> 'lote' or v.lote_id <> v_lote then raise exception 'FALHOU (P3d): lote sumiu: %', row_to_json(v); end if;

  perform teste_caixa('PMOP04', '9504', 1, 9300, 4);
  select * into v from sf_almox_pendencias() p where p.pmo = 'PMOP04';
  select count(*) into n from sf_almox_pendencias() p where p.pmo = 'PMOP04' and p.tipo = 'peca';
  if v.tipo <> 'caixa' or n <> 0 then raise exception 'FALHOU (P3e): coletiva: %', row_to_json(v); end if;

  perform teste_reg('PMOP05', '9505', 'Embalagem', '9400', '');
  perform teste_reg('PMOP06', '9506', 'Embalagem', '9500', '');
  perform teste_reg('PMOP08', '9508', 'Embalagem', '9700', '');
  -- PMOP07: tudo que passou na Embalagem já está no Almoxarifado → pecas = 0
  perform teste_reg('PMOP07', '9507', 'Embalagem', '9600', '');
  perform teste_reg('PMOP07', '9507', 'Almoxarifado', '9600', '');
  select count(*) into n from sf_almox_pendencias() p where p.pmo in ('PMOP05', 'PMOP06', 'PMOP07', 'PMOP08');
  if n <> 0 then raise exception 'FALHOU (P3f/g): finalizada/sem Almox/zero/primeiro posto geraram % linhas', n; end if;
  raise notice 'P3. NQA segue lote, coletiva segue caixa; finalizada, sem Almoxarifado, zero e primeiro posto não geram linha: ok';
end $t$;

-- =============================================================
-- P4. sf_almox_detalhe(..., 'AVULSAS') (h) e sem permissão (i)
-- =============================================================
do $t$
declare r jsonb; v_max timestamptz;
begin
  r := sf_almox_detalhe('PMOP01', '9501', 'AVULSAS', null);
  select max(data_hora) into v_max from sf_registros where pmo = 'PMOP01' and posto = 'Embalagem';
  if r->>'ok' <> 'true' or r->>'tipo' <> 'peca' or (r->>'pecas')::int <> 3
     or (r->>'recebidas_op')::int <> 2 or (r->>'qtd_op')::int <> 12
     or r->'posto_anterior'->>'posto' <> 'Embalagem'
     or (r->>'em')::timestamptz is distinct from v_max
     or coalesce(r->'sns', '[]'::jsonb) <> '[]'::jsonb then
    raise exception 'FALHOU (P4h): detalhe: %', r; end if;

  r := sf_almox_detalhe('PMOP07', '9507', 'AVULSAS', null);
  if r <> '{"ok": false, "motivo": "item_inexistente"}'::jsonb then raise exception 'FALHOU (P4h) zero: %', r; end if;
  r := sf_almox_detalhe('PMOP03', '9503', 'AVULSAS', null);  -- NQA: não é elegível
  if r <> '{"ok": false, "motivo": "item_inexistente"}'::jsonb then raise exception 'FALHOU (P4h) nqa: %', r; end if;
  r := sf_almox_detalhe('PMOP04', '9504', 'AVULSAS', null);  -- coletiva: caixa inexistente
  if r <> '{"ok": false, "motivo": "item_inexistente"}'::jsonb then raise exception 'FALHOU (P4h) coletiva: %', r; end if;
  r := sf_almox_detalhe('PMOP06', '9506', 'AVULSAS', null);
  if r <> '{"ok": false, "motivo": "sem_almoxarifado"}'::jsonb then raise exception 'FALHOU (P4h) sem almox: %', r; end if;
  r := sf_almox_detalhe('PMOP08', '9508', 'AVULSAS', null);  -- sem anterior
  if r <> '{"ok": false, "motivo": "item_inexistente"}'::jsonb then raise exception 'FALHOU (P4h) 1o posto: %', r; end if;

  perform set_config('teste.perms', 'shopfloor.visualizar', false);
  begin
    perform sf_almox_detalhe('PMOP01', '9501', 'AVULSAS', null);
    raise exception 'FALHOU (P4i): detalhe sem permissão não deu erro';
  exception when others then if sqlerrm <> 'SEM_PERMISSAO' then raise; end if; end;
  begin
    perform * from sf_almox_pendencias();
    raise exception 'FALHOU (P4i): pendencias sem permissão não deu erro';
  exception when others then if sqlerrm <> 'SEM_PERMISSAO' then raise; end if; end;
  perform set_config('teste.perms', 'recebimento.lancar,shopfloor.lancar,shopfloor.visualizar,lancar', false);
  raise notice 'P4. detalhe AVULSAS: pecas/recebidas_op/posto_anterior; falhas como dado; sem permissão = erro: ok';
end $t$;

-- =============================================================
-- P5. DESEMPENHO: OP individual NOVA e grande (1.250 peças x 8 postos), SEM analyze depois do insert.
-- Lição do incidente de 22/10: consulta que depende de estatística do planejador levou 37 s numa OP nova.
-- =============================================================
create index if not exists sf_registros_posto_data on public.sf_registros (pmo, op, posto, data_hora desc, id desc);
alter table public.sf_registros set (autovacuum_enabled = false);
insert into public.sf_ordens (pmo, op, cliente, sn_ini, sn_fim, embalagem_individual, status, qtd)
values ('PMOP90', '9590', 'Cliente P', '100000', '101250', true, 'EM PRODUCAO', 1250);
do $t$ begin
  perform public.teste_op_postos('PMOP90', '9590', array['Embalagem', 'Almoxarifado']);
end $t$;
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, status, numero_serie, numero_serie_norm, data_hora)
select 'Massa', p, 'PMOP90', '9590', 'Cliente P', '', s::text, s::text, now() - interval '1 day' + s * interval '1 second'
  from generate_series(100000, 101249) s,
       unnest(array['Posto A','Posto B','Posto C','Posto D','Posto E','Posto F','Inspeção Final','Embalagem']) p;
-- 400 peças já no Almoxarifado
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, status, numero_serie, numero_serie_norm)
select 'Massa', 'Almoxarifado', 'PMOP90', '9590', 'Cliente P', '', s::text, s::text from generate_series(100000, 100399) s;
do $t$
declare v record; t0 timestamptz; ms numeric;
begin
  t0 := clock_timestamp();
  select * into v from sf_almox_pendencias() p where p.pmo = 'PMOP90';
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice 'P5. sf_almox_pendencias na OP grande sem analyze: % ms', round(ms);
  if v.tipo <> 'peca' or v.pecas <> 850 then raise exception 'FALHOU (P5): linha errada %', row_to_json(v); end if;
  if ms > 2000 then raise exception 'FALHOU (P5): % ms (limite 2000)', round(ms); end if;
  t0 := clock_timestamp();
  perform sf_almox_detalhe('PMOP90', '9590', 'AVULSAS', null);
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice 'P5. sf_almox_detalhe AVULSAS na OP grande: % ms', round(ms);
  if ms > 2000 then raise exception 'FALHOU (P5): detalhe % ms', round(ms); end if;
end $t$;
alter table public.sf_registros reset (autovacuum_enabled);
