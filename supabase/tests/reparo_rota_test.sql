-- Prova a 0174. Roda depois dela, sobre reparo_rota_esquema.sql.
\set ON_ERROR_STOP on

-- Reparo de uma peça (1 conserto + 1 defeito constatado) e devolve o `posto_retorno` gravado (null = volta direto).
create or replace function pg_temp.reparar(p_pmo text, p_op text, p_sn text, p_origem text) returns text
language plpgsql as $f$
declare r jsonb; v text;
begin
  r := public.sf_registrar_reparo('Teste', p_pmo, p_op, 'RW', p_sn, lower(p_sn), '1002', 'C1', 'SMD', p_origem, now(),
         '[{"descricao":"trocou","posicao":"C1"}]'::jsonb, '["1002"]'::jsonb);
  if (r->>'ok')::boolean is not true then raise exception 'FALHOU: reparo recusado %', r; end if;
  select posto_retorno into v from public.sf_registros
   where pmo = p_pmo and op = p_op and numero_serie_norm = lower(p_sn) and posto = 'Manutenção'
   order by data_hora desc, created_at desc limit 1;
  return v;
end $f$;

do $t$
declare v text;
begin
  -- T1: a OP TEM a Inspeção PTH: a rota fica como sempre foi (passa pela inspeção e volta pro Teste).
  v := pg_temp.reparar('PMOA', '1001', 'SN-A1', 'Teste');
  if v is distinct from 'Inspeção PTH,Teste' then raise exception 'FALHOU T1: esperava Inspeção PTH,Teste, veio %', v; end if;
  raise notice 'T1 OP com a inspeção mantém a rota: ok';

  -- T2: a OP NÃO tem a Inspeção PTH (o bug): volta direto pro Teste, sem dívida de posto inexistente.
  v := pg_temp.reparar('PMOB', '2002', 'SN-B1', 'Teste');
  if v is not null then raise exception 'FALHOU T2: OP sem Inspeção PTH ficou devendo % (peça presa)', v; end if;
  raise notice 'T2 OP sem a inspeção volta direto: ok';

  -- T3: lista de dois postos e a OP tem só o segundo: fica só ele, depois o posto de origem.
  v := pg_temp.reparar('PMOC', '3003', 'SN-C1', 'Teste Final');
  if v is distinct from 'Inspeção Final,Teste Final' then raise exception 'FALHOU T3: veio %', v; end if;
  raise notice 'T3 lista parcial: ok';

  -- T4: posto sem configuração: volta direto, como sempre.
  v := pg_temp.reparar('PMOA', '1001', 'SN-A2', 'Integração');
  if v is not null then raise exception 'FALHOU T4: posto sem configuração gravou rota %', v; end if;
  raise notice 'T4 sem configuração: ok';

  -- T5: a peça JÁ estava presa (devendo 'Inspeção PTH,Teste' numa OP sem a inspeção) e volta à Manutenção: solta.
  insert into public.sf_registros (posto, pmo, op, numero_serie, numero_serie_norm, posto_origem, posto_retorno, data_hora)
  values ('Manutenção', 'PMOB', '2002', 'SN-B2', 'sn-b2', 'Teste', 'Inspeção PTH,Teste', now() - interval '1 hour');
  v := pg_temp.reparar('PMOB', '2002', 'SN-B2', 'Teste');
  if v is not null then raise exception 'FALHOU T5: peça presa continuou presa (%).', v; end if;
  raise notice 'T5 peça presa se solta no próximo reparo: ok';

  -- T6: a dívida legítima numa OP COM a inspeção é PRESERVADA (reprovou no meio da rota).
  insert into public.sf_registros (posto, pmo, op, numero_serie, numero_serie_norm, posto_origem, posto_retorno, data_hora)
  values ('Manutenção', 'PMOA', '1001', 'SN-A3', 'sn-a3', 'Teste', 'Inspeção PTH,Teste', now() - interval '1 hour');
  v := pg_temp.reparar('PMOA', '1001', 'SN-A3', 'Inspeção PTH');
  if v is distinct from 'Inspeção PTH,Teste' then raise exception 'FALHOU T6: dívida legítima mudou (%)', v; end if;
  raise notice 'T6 dívida legítima preservada: ok';
end $t$;

do $t$
begin
  -- T7: o filtro em si: ordem da lista, espaços aparados, vazios ignorados, OP inexistente e lista nula = null.
  if public.sf_filtrar_rota_pela_op('PMOC', '3003', ' Inspeção Final , Teste Final ,, X') is distinct from 'Inspeção Final,Teste Final' then
    raise exception 'FALHOU T7a: ordem/espaços'; end if;
  if public.sf_filtrar_rota_pela_op('PMOB', '2002', 'Inspeção PTH') is not null then raise exception 'FALHOU T7b'; end if;
  if public.sf_filtrar_rota_pela_op('NAO', 'EXISTE', 'Teste') is not null then raise exception 'FALHOU T7c: OP inexistente'; end if;
  if public.sf_filtrar_rota_pela_op('PMOA', '1001', null) is not null then raise exception 'FALHOU T7d: lista nula'; end if;
  raise notice 'T7 filtro: ok';

  -- T8: nem o público nem o anon/authenticated executam o filtro (é interno).
  if has_function_privilege('anon', 'public.sf_filtrar_rota_pela_op(text,text,text)', 'execute') then
    raise exception 'FALHOU T8: anon executa o filtro'; end if;
  raise notice 'T8 grants: ok';
end $t$;
