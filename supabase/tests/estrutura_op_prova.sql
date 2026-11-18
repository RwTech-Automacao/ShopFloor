\set ON_ERROR_STOP on
-- OP 8498 (PMOC14) com 2 trechos: PRT410 fecha na AOI TOP (filha 8500), PRT420 na Inspeção PTH (filha 8499).
insert into sf_ordens (id, pmo, op, placas_por_painel) values ('00000000-0000-0000-0000-000000008498', 'PMOC14', '8498', 1);
insert into sf_ordens (id, pmo, op, placas_por_painel) values ('00000000-0000-0000-0000-000000009000', 'PMOX', '9000', 4);
insert into sf_ordem_trechos (ordem_id, seq, codigo, posto_conclui, sn_modo, estoque, compels_op) values
  ('00000000-0000-0000-0000-000000008498', 1, 'PRT410', 'Inspeção AOI TOP', 'mesmo', 'EINTER', '8500'),
  ('00000000-0000-0000-0000-000000008498', 2, 'PRT420', 'Inspeção PTH', 'mesmo', 'EINTER', '8499'),
  ('00000000-0000-0000-0000-000000009000', 1, 'PRT999', 'Inspeção PTH', 'mesmo', 'PA', null);

do $$
declare n int; n0 int; r record; e record;
begin
  -- 1) aprovado no posto que conclui → 1 linha da PRT410, op = filha, ordem_id preenchido, estoque do trecho
  insert into sf_registros (created_at, posto, pmo, op, status, numero_serie, numero_serie_norm) values (clock_timestamp(), 'Inspeção AOI TOP', 'PMOC14', '8498', 'Aprovado', '331001251', '331001251');
  select * into r from sf_estoque_envios where pmo = 'PRT410';
  if r is null or r.op <> '8500' or r.ordem_id <> '00000000-0000-0000-0000-000000008498' or r.quantidade <> 1
     or r.tipo <> 'serie' or r.estoque <> 'EINTER' or r.posto <> 'Inspeção AOI TOP' then
    raise exception 'caso 1 falhou: %', row_to_json(r);
  end if;
  -- a chave da PRT é própria (sf_trecho_chave): PRT/<ordem>/<codigo>/<posto>/<alvo>/E<n>
  if r.chave <> 'PRT/00000000-0000-0000-0000-000000008498/PRT410/Inspeção AOI TOP/331001251/E1' or r.seq_chave <> 1 then
    raise exception 'caso 1 falhou (chave %)', r.chave;
  end if;

  -- 2) reprova não enfileira; posto que não conclui trecho não enfileira; SN vazio não enfileira
  insert into sf_registros (created_at, posto, pmo, op, status, numero_serie, numero_serie_norm) values (clock_timestamp(), 'Inspeção PTH', 'PMOC14', '8498', 'Reprovado', '331001252', '331001252');
  insert into sf_registros (created_at, posto, pmo, op, status, numero_serie, numero_serie_norm) values (clock_timestamp(), 'Teste', 'PMOC14', '8498', 'Aprovado', '331001251', '331001251');
  insert into sf_registros (created_at, posto, pmo, op, status, numero_serie, numero_serie_norm) values (clock_timestamp(), 'Inspeção PTH', 'PMOC14', '8498', 'Aprovado', '', '');
  select count(*) into n from sf_estoque_envios;
  if n <> 1 then raise exception 'caso 2 falhou: % linhas', n; end if;

  -- 3) reaprovação da mesma peça no mesmo posto não duplica (D6)
  insert into sf_registros (created_at, posto, pmo, op, status, numero_serie, numero_serie_norm) values (clock_timestamp(), 'Inspeção AOI TOP', 'PMOC14', '8498', 'Aprovado', '331001251', '331001251');
  select count(*) into n from sf_estoque_envios where pmo = 'PRT410';
  if n <> 1 then raise exception 'caso 3 falhou: % linhas', n; end if;

  -- 4) painel: quantidade = pecas do registro; OP filha não casada → op ''
  insert into sf_registros (created_at, posto, pmo, op, status, numero_serie, numero_serie_norm, pecas) values (clock_timestamp(), 'Inspeção PTH', 'PMOX', '9000', '', 'PNL1', 'pnl1', 4);
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
  insert into sf_registros (created_at, posto, pmo, op, status, numero_serie, numero_serie_norm) values (clock_timestamp(), 'Inspeção AOI TOP', 'PMOC14', '8498', 'Aprovado', '331001251', '331001251');
  select count(*) into n from sf_estoque_envios where pmo = 'PRT410' and cancelado_em is null and operacao = 'entrada';
  if n <> 1 then raise exception 'caso 7 falhou'; end if;
  select * into r from sf_estoque_envios where pmo = 'PRT410' and cancelado_em is null and operacao = 'entrada';
  if r.chave not like 'PRT/%/E2' or r.seq_chave <> 2 then raise exception 'caso 7 falhou (chave %)', r.chave; end if;

  -- 8) linha JÁ ENVIADA e o registro sai → estorno com a mesma op/quantidade/estoque
  update sf_estoque_envios set ok = true, enviado_em = now() where pmo = 'PRT410' and cancelado_em is null;
  delete from sf_registros where posto = 'Inspeção AOI TOP';
  select * into r from sf_estoque_envios where pmo = 'PRT410' and operacao = 'estorno';
  if r is null or r.op <> '8500' or r.quantidade <> 1 or r.estoque <> 'EINTER' or r.ordem_id is null
     or r.chave not like 'PRT/%/S1' or r.ok then
    raise exception 'caso 8 falhou: %', row_to_json(r);
  end if;
  select * into e from sf_estoque_envios where id = r.entrada_id;
  if e.id is null or e.operacao <> 'entrada' or not e.ok or e.estornado <> e.quantidade then
    raise exception 'caso 8 falhou (entrada/saldo): %', row_to_json(e);
  end if;
  -- um só estorno; rebipe depois do estorno é nova entrada pendente (E3)
  select count(*) into n from sf_estoque_envios where pmo = 'PRT410' and operacao = 'estorno';
  if n <> 1 then raise exception 'caso 8 falhou (estornos: %)', n; end if;
  insert into sf_registros (created_at, posto, pmo, op, status, numero_serie, numero_serie_norm) values (clock_timestamp(), 'Inspeção AOI TOP', 'PMOC14', '8498', 'Aprovado', '331001251', '331001251');
  select * into r from sf_estoque_envios where pmo = 'PRT410' and operacao = 'entrada' and not ok and cancelado_em is null;
  if r.id is null or r.chave not like '%/E3' then raise exception 'caso 8 falhou (rebipe pós-estorno): %', row_to_json(r); end if;

  -- 9) OP sem trechos: nada acontece
  select count(*) into n0 from sf_estoque_envios;
  insert into sf_ordens (pmo, op) values ('PMOZ', '9100');
  insert into sf_registros (created_at, posto, pmo, op, status, numero_serie, numero_serie_norm) values (clock_timestamp(), 'Inspeção PTH', 'PMOZ', '9100', 'Aprovado', 'X1', 'x1');
  select count(*) into n from sf_estoque_envios;
  if n <> n0 then raise exception 'caso 9 falhou: % -> % linhas', n0, n; end if;

  -- 10) mesma SN em duas OPs com trechos: cada uma ganha a sua linha
  insert into sf_ordens (id, pmo, op) values ('00000000-0000-0000-0000-000000000a01', 'PMOA', '1001'), ('00000000-0000-0000-0000-000000000a02', 'PMOB', '1002');
  insert into sf_ordem_trechos (ordem_id, seq, codigo, posto_conclui, estoque, compels_op) values
    ('00000000-0000-0000-0000-000000000a01', 1, 'PRTA', 'Inspeção PTH', 'EINTER', '2001'),
    ('00000000-0000-0000-0000-000000000a02', 1, 'PRTB', 'Inspeção PTH', 'EINTER', '2002');
  insert into sf_registros (created_at, posto, pmo, op, status, numero_serie, numero_serie_norm) values (clock_timestamp(), 'Inspeção PTH', 'PMOA', '1001', 'Aprovado', 'DUP1', 'dup1');
  insert into sf_registros (created_at, posto, pmo, op, status, numero_serie, numero_serie_norm) values (clock_timestamp(), 'Inspeção PTH', 'PMOB', '1002', 'Aprovado', 'DUP1', 'dup1');
  select count(*) into n from sf_estoque_envios where serie_norm = 'dup1' and cancelado_em is null;
  if n <> 2 then raise exception 'caso 10 falhou: % linhas', n; end if;
end $$;

-- 13) linha PENDENTE mas TOCADA (a regra v_tocada da sf_estoque_reverter, 0132): não cancela, estorna o saldo
do $$
declare o uuid := '00000000-0000-0000-0000-000000000c01'; ent record; est record; n int;
begin
  insert into sf_ordens (id, pmo, op) values (o, 'PMOT', '5000');
  insert into sf_ordem_trechos (ordem_id, seq, codigo, posto_conclui, estoque, compels_op) values (o, 1, 'PRTT', 'Inspeção PTH', 'EINTER', '5001');
  -- 13a) tentativas = 1 (a reserva já mandou uma vez: o ERP pode ter recebido)
  insert into sf_registros (created_at, posto, pmo, op, status, numero_serie, numero_serie_norm) values (clock_timestamp(), 'Inspeção PTH', 'PMOT', '5000', 'Aprovado', 'T1', 't1');
  update sf_estoque_envios set tentativas = 1, erro = 'resposta perdida' where ordem_id = o and alvo = 't1';
  delete from sf_registros where pmo = 'PMOT' and numero_serie_norm = 't1';
  select * into ent from sf_estoque_envios where ordem_id = o and alvo = 't1' and operacao = 'entrada';
  if ent.cancelado_em is not null or ent.estornado <> ent.quantidade then
    raise exception 'caso 13a falhou (entrada tocada foi cancelada ou não debitada): %', row_to_json(ent);
  end if;
  select * into est from sf_estoque_envios where ordem_id = o and alvo = 't1' and operacao = 'estorno';
  if est.id is null or est.entrada_id <> ent.id or est.ordem_id <> o or est.quantidade <> 1 or est.op <> '5001'
     or est.estoque <> 'EINTER' or est.chave not like 'PRT/%/S1' or est.ok then
    raise exception 'caso 13a falhou (estorno): %', row_to_json(est);
  end if;
  -- rebipe depois da reversão da tocada: a E1 está sem saldo, então a peça ganha entrada nova (E2)
  insert into sf_registros (created_at, posto, pmo, op, status, numero_serie, numero_serie_norm) values (clock_timestamp(), 'Inspeção PTH', 'PMOT', '5000', 'Aprovado', 'T1', 't1');
  select count(*) into n from sf_estoque_envios where ordem_id = o and alvo = 't1' and operacao = 'entrada' and chave like 'PRT/%/E2' and not ok and cancelado_em is null;
  if n <> 1 then raise exception 'caso 13a falhou (rebipe pós-estorno da tocada: % E2)', n; end if;
  -- 13b) reserva VIVA (reservado_em há menos de 15 min, sem tentativa) também é tocada
  insert into sf_registros (created_at, posto, pmo, op, status, numero_serie, numero_serie_norm) values (clock_timestamp(), 'Inspeção PTH', 'PMOT', '5000', 'Aprovado', 'T2', 't2');
  update sf_estoque_envios set reservado_em = now() - interval '1 minute' where ordem_id = o and alvo = 't2';
  delete from sf_registros where pmo = 'PMOT' and numero_serie_norm = 't2';
  select count(*) into n from sf_estoque_envios where ordem_id = o and alvo = 't2' and operacao = 'estorno';
  if n <> 1 then raise exception 'caso 13b falhou (reserva viva: % estornos)', n; end if;
  select count(*) into n from sf_estoque_envios where ordem_id = o and alvo = 't2' and cancelado_em is not null;
  if n <> 0 then raise exception 'caso 13b falhou (reserva viva cancelada)'; end if;
  -- 13c) reserva VENCIDA e sem tentativa: intocada → cancela, sem estorno
  insert into sf_registros (created_at, posto, pmo, op, status, numero_serie, numero_serie_norm) values (clock_timestamp(), 'Inspeção PTH', 'PMOT', '5000', 'Aprovado', 'T3', 't3');
  update sf_estoque_envios set reservado_em = now() - interval '20 minutes' where ordem_id = o and alvo = 't3';
  delete from sf_registros where pmo = 'PMOT' and numero_serie_norm = 't3';
  select count(*) into n from sf_estoque_envios where ordem_id = o and alvo = 't3' and operacao = 'estorno';
  if n <> 0 then raise exception 'caso 13c falhou (estorno indevido)'; end if;
  select count(*) into n from sf_estoque_envios where ordem_id = o and alvo = 't3' and cancelado_em is not null;
  if n <> 1 then raise exception 'caso 13c falhou (não cancelou)'; end if;
end $$;

-- 14) a chave da PRT não depende da op da linha: troca de filha + cancelamento + rebipe não colide
do $$
declare o uuid := '00000000-0000-0000-0000-000000000d01'; n int; r record;
begin
  insert into sf_ordens (id, pmo, op) values (o, 'PMOK', '6000');
  insert into sf_ordem_trechos (ordem_id, seq, codigo, posto_conclui, estoque, compels_op) values (o, 1, 'PRTK', 'Inspeção PTH', 'EINTER', null);
  insert into sf_registros (created_at, posto, pmo, op, status, numero_serie, numero_serie_norm) values (clock_timestamp(), 'Inspeção PTH', 'PMOK', '6000', 'Aprovado', 'K1', 'k1');
  -- gravarFilhas acha a filha 6001 e reaponta a pendente; depois a peça é cancelada
  update sf_ordem_trechos set compels_op = '6001' where ordem_id = o;
  update sf_estoque_envios set op = '6001' where ordem_id = o and alvo = 'k1';
  delete from sf_registros where pmo = 'PMOK';
  -- limparFilhas (a OP mudou de número): a filha volta a vazio; rebipe
  update sf_ordem_trechos set compels_op = null where ordem_id = o;
  insert into sf_registros (created_at, posto, pmo, op, status, numero_serie, numero_serie_norm) values (clock_timestamp(), 'Inspeção PTH', 'PMOK', '6000', 'Aprovado', 'K1', 'k1');
  select * into r from sf_estoque_envios where ordem_id = o and alvo = 'k1' and cancelado_em is null;
  if r.id is null or r.chave not like 'PRT/%/E2' or r.op <> '' then raise exception 'caso 14 falhou: %', row_to_json(r); end if;
  select count(distinct chave) into n from sf_estoque_envios where ordem_id = o;
  if n <> 2 then raise exception 'caso 14 falhou (chaves distintas: %)', n; end if;
end $$;

-- 15) sf_resumo_trechos_op: por trecho, apontadas (entradas ok − estornos ok), na fila (pendentes vivas) e o motivo da mais antiga
do $$
declare o uuid := '00000000-0000-0000-0000-000000000e01'; ent uuid; r record; n int;
begin
  insert into sf_ordens (id, pmo, op) values (o, 'PMOF', '7000');
  insert into sf_ordem_trechos (ordem_id, seq, codigo, posto_conclui, estoque, compels_op) values
    (o, 2, 'PRTF2', 'Inspeção PTH', 'EINTER', null),
    (o, 1, 'PRTF1', 'Inspeção AOI TOP', 'EINTER', '7001');
  insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, serie_norm, quantidade, ordem_id, estoque, ok, enviado_em)
    values ('F/OK', 'PRTF1', '7001', 'Inspeção AOI TOP', 'serie', 'f1', 'f1', 3, o, 'EINTER', true, now()) returning id into ent;
  insert into sf_estoque_envios (chave, operacao, entrada_id, pmo, op, posto, tipo, bipe, serie_norm, quantidade, ordem_id, estoque, ok, enviado_em)
    values ('F/EST', 'estorno', ent, 'PRTF1', '7001', 'Inspeção AOI TOP', 'serie', 'f1', 'f1', 1, o, 'EINTER', true, now());
  insert into sf_estoque_envios (chave, operacao, entrada_id, pmo, op, posto, tipo, bipe, serie_norm, quantidade, ordem_id, estoque)
    values ('F/EST2', 'estorno', ent, 'PRTF1', '7001', 'Inspeção AOI TOP', 'serie', 'f1', 'f1', 1, o, 'EINTER');
  insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, serie_norm, quantidade, ordem_id, estoque, erro, criado_em)
    values ('F/P1', 'PRTF1', '7001', 'Inspeção AOI TOP', 'serie', 'f2', 'f2', 2, o, 'EINTER', 'E-velho', now() - interval '1 hour'),
           ('F/P2', 'PRTF1', '7001', 'Inspeção AOI TOP', 'serie', 'f3', 'f3', 1, o, 'EINTER', 'E-novo', now());
  insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, serie_norm, quantidade, ordem_id, estoque, cancelado_em, criado_em)
    values ('F/C', 'PRTF1', '7001', 'Inspeção AOI TOP', 'serie', 'f4', 'f4', 5, o, 'EINTER', now(), now() - interval '2 hours');
  select count(*) into n from sf_resumo_trechos_op('PMOF', '7000');
  if n <> 2 then raise exception 'caso 15 falhou (% trechos)', n; end if;
  select * into r from sf_resumo_trechos_op('PMOF', '7000') limit 1;
  if r.codigo <> 'PRTF1' or r.posto <> 'Inspeção AOI TOP' or r.compels_op <> '7001' or r.apontadas <> 2 or r.na_fila <> 3 or r.motivo <> 'E-velho' then
    raise exception 'caso 15 falhou (PRTF1): %', row_to_json(r);
  end if;
  select * into r from sf_resumo_trechos_op('PMOF', '7000') offset 1;
  if r.codigo <> 'PRTF2' or r.compels_op is not null or r.apontadas <> 0 or r.na_fila <> 0 or r.motivo is not null then
    raise exception 'caso 15 falhou (PRTF2): %', row_to_json(r);
  end if;
  select count(*) into n from sf_resumo_trechos_op('PMOF', '9999');
  if n <> 0 then raise exception 'caso 15 falhou (OP inexistente: %)', n; end if;
end $$;

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

-- 17) a reserva da 0132 segura o estorno da linha tocada até a entrada dele estar ok
do $$
declare o uuid := '00000000-0000-0000-0000-000000000c01'; ent uuid; est uuid; n int;
begin
  select entrada_id, id into ent, est from sf_estoque_envios where ordem_id = o and alvo = 't1' and operacao = 'estorno';
  select count(*) into n from sf_estoque_reservar(100) x where x.id = est;
  if n <> 0 then raise exception 'caso 17 falhou (estorno reservado com a entrada pendente)'; end if;
  update sf_estoque_envios set ok = true, enviado_em = now(), reservado_em = null where id = ent;
  select count(*) into n from sf_estoque_reservar(100) x where x.id = est;
  if n <> 1 then raise exception 'caso 17 falhou (estorno não liberado com a entrada ok)'; end if;
end $$;
-- 18) o trecho da PMO (tipo 'pmo') NÃO enfileira nem aparece no resumo: a PMO segue pelo Almoxarifado de sempre
do $$
declare o uuid := '00000000-0000-0000-0000-000000000f01'; n int;
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

\echo 'PROVA ESTRUTURA OK'
