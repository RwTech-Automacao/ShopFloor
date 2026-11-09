-- =============================================================
-- Reverte o 01-corrigir-487-para-572.sql: devolve a integração e os 3 registros ao estado de antes,
-- a partir das cópias correcao_8495_bkp_*. Aborta se as cópias não existirem ou se o 332007487 já
-- tiver sido lançado de novo (aí a reversão colidiria).
-- Rode com: psql ... -v ON_ERROR_STOP=1 -f <este arquivo>
-- =============================================================
\set ON_ERROR_STOP on
begin;

do $chk$
begin
  if to_regclass('public.correcao_8495_bkp_integracoes') is null or to_regclass('public.correcao_8495_bkp_registros') is null then
    raise exception 'ABORTADO: as cópias correcao_8495_bkp_* não existem; nada a reverter.';
  end if;
  if exists (select 1 from sf_registros where numero_serie_norm = '332007487') then
    raise exception 'ABORTADO: o 332007487 já tem registro de novo; reverter colidiria. Veja antes.';
  end if;
  if exists (select 1 from sf_integracoes where produto_sn_norm = '332007487') then
    raise exception 'ABORTADO: o 332007487 já foi integrado de novo; reverter colidiria. Veja antes.';
  end if;
end
$chk$;

update sf_integracoes i
   set produto_sn = b.produto_sn, produto_sn_norm = b.produto_sn_norm, observacao = b.observacao
  from correcao_8495_bkp_integracoes b where i.id = b.id;

update sf_registros r
   set numero_serie = b.numero_serie, numero_serie_norm = b.numero_serie_norm, observacao = b.observacao
  from correcao_8495_bkp_registros b where r.id = b.id;

do $chk$
begin
  if (select count(*) from sf_registros where numero_serie_norm = '332007487') <> 3
     or (select count(*) from sf_registros where numero_serie_norm = '332007572') <> 0 then
    raise exception 'ABORTADO: a reversão não bateu; nada foi gravado.';
  end if;
end
$chk$;

commit;
select numero_serie_norm as sn, posto, to_char(data_hora,'DD/MM HH24:MI:SS') as hora from sf_registros where numero_serie_norm in ('332007487','332007572') order by 1, 3;
