-- =============================================================
-- Reverte o 03: devolve a placa 2684950498 à integração do 332007487 (e tira a 984). Estado resultante =
-- o ORIGINAL de antes do 01 (487 <-> 498). Aborta se as cópias correcao_8495_bkp2_* não existirem ou se a
-- placa 498 já foi integrada de novo (aí a reversão colidiria).
-- Rode com: psql ... -v ON_ERROR_STOP=1 -f <este arquivo>
-- =============================================================
\set ON_ERROR_STOP on
begin;
do $chk$
begin
  if to_regclass('public.correcao_8495_bkp2_itens') is null or to_regclass('public.correcao_8495_bkp2_registro_placa') is null
     or to_regclass('public.correcao_8495_bkp2_integracao') is null then
    raise exception 'ABORTADO: as cópias correcao_8495_bkp2_* não existem; nada a reverter.';
  end if;
  if exists (select 1 from sf_integracao_itens it join sf_integracoes i on i.id = it.integracao_id
              where i.status = 'ATIVA' and it.placa_sn_norm = '2684950498') then
    raise exception 'ABORTADO: a placa 2684950498 já está numa integração ativa; reverter colidiria. Veja antes.';
  end if;
  if exists (select 1 from sf_registros where numero_serie_norm = '2684950498' and posto = 'Integração') then
    raise exception 'ABORTADO: a placa 2684950498 já tem registro de Integração; reverter colidiria. Veja antes.';
  end if;
end
$chk$;
update sf_integracao_itens it set placa_sn = b.placa_sn, placa_sn_norm = b.placa_sn_norm from correcao_8495_bkp2_itens b where it.id = b.id;
update sf_registros r set numero_serie = b.numero_serie, numero_serie_norm = b.numero_serie_norm, observacao = b.observacao from correcao_8495_bkp2_registro_placa b where r.id = b.id;
update sf_integracoes i set observacao = b.observacao from correcao_8495_bkp2_integracao b where i.id = b.id;
do $chk$
begin
  if (select count(*) from sf_integracao_itens it join sf_integracoes i on i.id = it.integracao_id where i.codigo = 'INT-20261001-192937-6B2E' and it.placa_sn_norm = '2684950498') <> 1
     or (select count(*) from sf_registros where numero_serie_norm = '2684950498' and posto = 'Integração') <> 1 then
    raise exception 'ABORTADO: a reversão não bateu; nada foi gravado.';
  end if;
end
$chk$;
commit;
select i.codigo, i.produto_sn, (select string_agg(it.placa_sn, ',') from sf_integracao_itens it where it.integracao_id = i.id) as placa from sf_integracoes i where i.codigo = 'INT-20261001-192937-6B2E';
