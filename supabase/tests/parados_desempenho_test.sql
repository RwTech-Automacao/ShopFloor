-- Prova da 0193 (peças paradas: desempenho) no runner de alertas (rodar-alertas-test.sh), DEPOIS do teste da 0188.
-- Roda numa transação só (now() fixo): tira a FOTO da alerta_travados_sns e da sf_pecas_paradas da 0188/0180 em
-- todas as combinações sobre a massa que os testes anteriores deixaram, aplica a 0193 (\i) e exige saída idêntica.
-- Depois confere a sf_pecas_paradas_json (mesmas linhas, mesma ordem, permissão e erros da sf_pecas_paradas).
--
--   D1  alerta_travados_sns: mesmas linhas (cortes, ativas/todas, com/sem Manutenção, com/sem PMOs, postos);
--   D2  sf_pecas_paradas: mesmas linhas E mesma ordem nas três situações e com PMOs;
--   D3  sf_pecas_paradas_json = sf_pecas_paradas (to_jsonb de cada linha, na ordem), vazio = [];
--   D4  sf_pecas_paradas_json: sem permissão = SEM_PERMISSAO; situação inválida = SITUACAO_INVALIDA;
--   D5  grants: authenticated executa a _json; anon não; alerta_travados_sns continua só do service_role.
\set ON_ERROR_STOP on
begin;
select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', true);
select set_config('teste.perms', 'shopfloor.visualizar', true);

create temp table d_postos as
select array_agg(distinct p) as todos from (select posto as p from public.sf_registros union select 'Manutenção') x;

create temp table d_casos (k text, corte timestamptz, ativas boolean, man boolean, pmos text[], postos text[]);
insert into d_casos
select c || '/' || a || '/' || m || '/' || coalesce(array_to_string(pm, ','), '-') || '/' || ps,
       now() - make_interval(hours => h), a, m, pm,
       case ps when 'todos' then (select todos from d_postos) else array['Teste', 'Almoxarifado'] end
  from (values ('agora', 0), ('1d', 24), ('7d', 168)) cc(c, h)
 cross join (values (true), (false)) aa(a)
 cross join (values (true), (false)) mm(m)
 cross join (values (null::text[]), ('{}'::text[]), (array['PMOT', 'PPEND'])) pp(pm)
 cross join (values ('todos'), ('dois')) pss(ps);

create temp table d_tela (k text, corte timestamptz, sit text, pmos text[]);
insert into d_tela
select s || '/' || h || '/' || coalesce(array_to_string(pm, ','), '-'), now() - make_interval(hours => h), s, pm
  from (values ('ativas'), ('todas'), ('finalizadas')) ss(s)
 cross join (values (0), (24), (168)) hh(h)
 cross join (values (null::text[]), (array[' PMOT ', 'PPEND'])) pp(pm);

create temp table d_antes_sns as
select c.k, t::text as linha from d_casos c
 cross join lateral public.alerta_travados_sns(c.postos, c.pmos, c.corte, c.ativas, c.man) t;
create temp table d_antes_tela as
select c.k, n, t::text as linha from d_tela c
 cross join lateral public.sf_pecas_paradas(c.corte, c.sit, c.pmos) with ordinality t(pmo, op, posto, reprovada, numero_serie, pecas, em, finalizada, n);

do $t$ begin
  if (select count(*) from d_antes_sns) < 20 or (select count(*) from d_antes_tela) < 20 then
    raise exception 'FOTO vazia demais (sns=%, tela=%): a prova não prova nada',
      (select count(*) from d_antes_sns), (select count(*) from d_antes_tela);
  end if;
end $t$;

\i /tmp/0193.sql

do $t$
declare v int;
begin
  -- D1
  select count(*) into v from (
    (select k, linha from d_antes_sns except all
     select c.k, t::text from d_casos c cross join lateral public.alerta_travados_sns(c.postos, c.pmos, c.corte, c.ativas, c.man) t)
    union all
    (select c.k, t::text from d_casos c cross join lateral public.alerta_travados_sns(c.postos, c.pmos, c.corte, c.ativas, c.man) t
     except all select k, linha from d_antes_sns)) x;
  if v <> 0 then raise exception 'D1 FALHOU: alerta_travados_sns difere em % linha(s)', v; end if;

  -- D2 (com a posição: a ordem também é a mesma; empates de (em, pmo, op, sn) não existem na massa)
  select count(*) into v from (
    (select k, n, linha from d_antes_tela except all
     select c.k, n, t::text from d_tela c cross join lateral public.sf_pecas_paradas(c.corte, c.sit, c.pmos)
            with ordinality t(pmo, op, posto, reprovada, numero_serie, pecas, em, finalizada, n))
    union all
    (select c.k, n, t::text from d_tela c cross join lateral public.sf_pecas_paradas(c.corte, c.sit, c.pmos)
            with ordinality t(pmo, op, posto, reprovada, numero_serie, pecas, em, finalizada, n)
     except all select k, n, linha from d_antes_tela)) x;
  if v <> 0 then raise exception 'D2 FALHOU: sf_pecas_paradas difere em % linha(s)', v; end if;

  -- D3
  select count(*) into v from d_tela c
   where public.sf_pecas_paradas_json(c.corte, c.sit, c.pmos) is distinct from
         (select coalesce(jsonb_agg(to_jsonb(y) - 'n' order by y.n), '[]'::jsonb)
            from public.sf_pecas_paradas(c.corte, c.sit, c.pmos)
                 with ordinality y(pmo, op, posto, reprovada, numero_serie, pecas, em, finalizada, n));
  if v <> 0 then raise exception 'D3 FALHOU: sf_pecas_paradas_json difere em % caso(s)', v; end if;
  if public.sf_pecas_paradas_json(null, 'ativas', null) <> '[]'::jsonb then
    raise exception 'D3 FALHOU: corte nulo deveria ser []';
  end if;

  -- D4
  perform set_config('teste.perms', 'recebimento.visualizar', true);
  begin
    perform public.sf_pecas_paradas_json(now(), 'ativas', null);
    raise exception 'D4 FALHOU: sem permissão não deu erro';
  exception when raise_exception then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  perform set_config('teste.perms', 'shopfloor.visualizar', true);
  begin
    perform public.sf_pecas_paradas_json(now(), 'outra', null);
    raise exception 'D4 FALHOU: situação inválida não deu erro';
  exception when raise_exception then
    if sqlerrm <> 'SITUACAO_INVALIDA' then raise; end if;
  end;

  -- D5
  if not has_function_privilege('authenticated', 'public.sf_pecas_paradas_json(timestamptz, text, text[])', 'execute')
     or has_function_privilege('anon', 'public.sf_pecas_paradas_json(timestamptz, text, text[])', 'execute')
     or has_function_privilege('authenticated', 'public.alerta_travados_sns(text[], text[], timestamptz, boolean, boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.alerta_travados_sns(text[], text[], timestamptz, boolean, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.sf_pecas_paradas(timestamptz, text, text[])', 'execute') then
    raise exception 'D5 FALHOU: grants';
  end if;
  raise notice '0193: % linhas (sns) e % (tela) idênticas antes e depois', (select count(*) from d_antes_sns),
    (select count(*) from d_antes_tela);
end $t$;
commit;
