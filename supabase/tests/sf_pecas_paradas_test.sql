-- Testes SQL da 0180 (tela "Peças paradas" sem regra). Rodar com supabase/tests/rodar-alertas-test.sh, depois da
-- 0177 (usa a massa do alertas_travados_test.sql).
--
--   P1  sem permissão é ERRO SEM_PERMISSAO; situação desconhecida é ERRO SITUACAO_INVALIDA; corte nulo = vazio;
--   P2  'ativas': todos os postos (inclusive Almoxarifado e Manutenção) e as reprovadas, só OPs não finalizadas;
--   P3  'finalizadas': só as OPs finalizadas (status com espaço/caixa diferente também), marcadas finalizada;
--   P4  'todas' = ativas + finalizadas;
--   P5  p_pmos filtra (com btrim); vazio = todas;
--   P6  grants (authenticated sim, anon não).

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);

do $t$
declare v_sns text; v_at int; v_fin int; v_tod int;
begin
  -- P1
  perform set_config('teste.perms', 'recebimento.visualizar', false);
  begin
    perform * from public.sf_pecas_paradas(now(), 'ativas', null);
    raise exception 'P1 FALHOU: sem permissão não deu erro';
  exception when raise_exception then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  perform set_config('teste.perms', 'shopfloor.visualizar', false);
  begin
    perform * from public.sf_pecas_paradas(now(), 'outra', null);
    raise exception 'P1 FALHOU: situação desconhecida não deu erro';
  exception when raise_exception then
    if sqlerrm <> 'SITUACAO_INVALIDA' then raise; end if;
  end;
  if exists (select 1 from public.sf_pecas_paradas(null, 'todas', null)) then
    raise exception 'P1 FALHOU: corte nulo deveria vir vazio';
  end if;

  -- P2
  select string_agg(s.numero_serie || ':' || s.posto || ':' || s.pecas || ':' || case when s.reprovada then 'R' else 'n' end,
                    ' ' order by s.numero_serie)
    into v_sns
    from public.sf_pecas_paradas(now() - interval '7 days', 'ativas', null) s
   where s.pmo = 'PMOT' and s.op = 'A';
  if v_sns is distinct from 'a1:Teste:1:n a2:Embalagem:1:n a4:Almoxarifado:1:R a5:Teste:1:R a7:Manutenção:1:n b1:Teste:4:n' then
    raise exception 'P2 FALHOU: OP A = [%]', v_sns;
  end if;
  if exists (select 1 from public.sf_pecas_paradas(now() - interval '7 days', 'ativas', null) s
              where s.finalizada or s.op in ('F', 'F2', 'ORFA')) then
    raise exception 'P2 FALHOU: veio OP finalizada (ou órfã) em ativas';
  end if;
  if (select array_agg(s.em) from public.sf_pecas_paradas(now() - interval '7 days', 'ativas', null) s)
     <> (select array_agg(s.em order by s.em) from public.sf_pecas_paradas(now() - interval '7 days', 'ativas', null) s) then
    raise exception 'P2 FALHOU: a saída não vem da mais antiga para a mais nova';
  end if;

  -- P3
  select string_agg(s.op || '/' || s.numero_serie, ' ' order by s.op) into v_sns
    from public.sf_pecas_paradas(now() - interval '7 days', 'finalizadas', null) s;
  if v_sns is distinct from 'F/f1 F2/f2' then
    raise exception 'P3 FALHOU: finalizadas = [%]', v_sns;
  end if;
  if exists (select 1 from public.sf_pecas_paradas(now() - interval '7 days', 'finalizadas', null) s where not s.finalizada) then
    raise exception 'P3 FALHOU: finalizada=false em finalizadas';
  end if;

  -- P4
  select count(*) into v_at from public.sf_pecas_paradas(now() - interval '7 days', 'ativas', null);
  select count(*) into v_fin from public.sf_pecas_paradas(now() - interval '7 days', 'finalizadas', null);
  select count(*) into v_tod from public.sf_pecas_paradas(now() - interval '7 days', 'todas', null);
  if v_tod <> v_at + v_fin or v_at = 0 then
    raise exception 'P4 FALHOU: todas=% ativas=% finalizadas=%', v_tod, v_at, v_fin;
  end if;
  if (select count(*) from public.sf_pecas_paradas(now() - interval '7 days', null, null)) <> v_at then
    raise exception 'P4 FALHOU: situação nula deveria valer ativas';
  end if;

  -- P5
  if exists (select 1 from public.sf_pecas_paradas(now() - interval '7 days', 'todas', array[' PMOZ ']) s where s.pmo <> 'PMOZ')
     or not exists (select 1 from public.sf_pecas_paradas(now() - interval '7 days', 'todas', array[' PMOZ ']) s where s.op = 'B')
     or (select count(*) from public.sf_pecas_paradas(now() - interval '7 days', 'todas', '{}')) <> v_tod then
    raise exception 'P5 FALHOU: filtro de PMO';
  end if;

  -- P6
  if not has_function_privilege('authenticated', 'public.sf_pecas_paradas(timestamptz,text,text[])', 'execute')
     or has_function_privilege('anon', 'public.sf_pecas_paradas(timestamptz,text,text[])', 'execute') then
    raise exception 'P6 FALHOU: grants (authenticated sim, anon não)';
  end if;

  perform set_config('teste.perms', 'shopfloor.administrar,recebimento.administrar', false);
  raise notice 'P1-P6 ok';
end $t$;

select 'sf_pecas_paradas_test ok' as resultado;
