-- Teste do rollback da 0198 (docs/operacao/sat-ordem-servico/rollback-0198.sql). Roda no fim, na mesma base.
-- Depois do rollback: sat_registrar_nf funciona e NÃO cria OS; reaplicar a 0198 restaura os 4 gatilhos.
select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);

create temp table trg as select tgname from pg_trigger
 where not tgisinternal and tgname in ('sat_entradas_ordem', 'sat_entradas_ticket', 'sat_nfs_ordem', 'sat_os_garantia');
do $t$ begin
  if (select count(*) from trg) <> 4 then raise exception 'FALHOU: antes do rollback devia haver 4 gatilhos'; end if;
end $t$;

\i /tmp/rollback-0198.sql
\i /tmp/rollback-0198.sql

do $t$
declare r jsonb; v_os int := (select count(*) from sat_ordens); v_ent int := (select count(*) from sat_entradas);
begin
  if exists (select 1 from pg_trigger where not tgisinternal
              and tgname in ('sat_entradas_ordem', 'sat_entradas_ticket', 'sat_nfs_ordem', 'sat_os_garantia')) then
    raise exception 'FALHOU: rollback não removeu os gatilhos';
  end if;
  set local role authenticated;
  perform set_config('teste.perms', 'sat.visualizar,sat.registrar_entrada', false);
  r := sat_registrar_nf(jsonb_build_object('numero', 'NF-RB-1', 'cnpj', '12345678000190', 'empresa', 'Cliente RB',
         'situacao', 'aprovada', 'relogios', jsonb_build_array(
           jsonb_build_object('ns', '620-1', 'modelo', '620', 'sequencia', '1', 'produto', 'PMOC31'))));
  reset role;
  if (select count(*) from sat_entradas) <> v_ent + 1 then raise exception 'FALHOU: sat_registrar_nf não gravou após rollback'; end if;
  if (select count(*) from sat_ordens) <> v_os then raise exception 'FALHOU: criou OS após o rollback'; end if;
  raise notice 'rollback da 0198: ok';
end $t$;

\i /tmp/0198.sql
do $t$ begin
  if (select count(*) from pg_trigger where not tgisinternal
       and tgname in ('sat_entradas_ordem', 'sat_entradas_ticket', 'sat_nfs_ordem', 'sat_os_garantia')) <> 4 then
    raise exception 'FALHOU: reaplicar a 0198 não restaurou os 4 gatilhos';
  end if;
  -- o backfill da reaplicação numera a entrada que ficou sem OS
  if exists (select 1 from sat_entradas e where not exists (select 1 from sat_ordens o where o.entrada_id = e.id)) then
    raise exception 'FALHOU: entrada sem OS após reaplicar';
  end if;
  raise notice 'reaplicar a 0198 restaura gatilhos e OS: ok';
end $t$;
