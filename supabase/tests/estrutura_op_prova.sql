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
  if r.chave not like '%/E2' then raise exception 'caso 7 falhou (chave %)', r.chave; end if;

  -- 8) linha JÁ ENVIADA e o registro sai → estorno com a mesma op/quantidade/estoque
  update sf_estoque_envios set ok = true, enviado_em = now() where pmo = 'PRT410' and cancelado_em is null;
  delete from sf_registros where posto = 'Inspeção AOI TOP';
  select * into r from sf_estoque_envios where pmo = 'PRT410' and operacao = 'estorno';
  if r is null or r.op <> '8500' or r.quantidade <> 1 or r.estoque <> 'EINTER' or r.ordem_id is null
     or r.chave not like '%/S1' or r.ok then
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
\echo 'PROVA ESTRUTURA OK'
