-- Testes SQL da 0179 (lista das regras "Parado ou travado" para o seletor da aba "Peças paradas"). Rodar com
-- supabase/tests/rodar-alertas-test.sh, depois da 0179 aplicada duas vezes.
--
--   L1  sem shopfloor.visualizar é ERRO SEM_PERMISSAO (nunca lista vazia);
--   L2  só regras do tipo 'parado', ATIVAS e não excluídas; só id e nome; ordem alfabética sem caixa;
--   L3  grants: authenticated e service_role sim, anon não.

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.administrar,recebimento.administrar', false);

do $t$
declare
  v_a uuid; v_b uuid; v_off uuid; v_excl uuid; v_nomes text; v_cols int;
begin
  insert into public.alerta_regras
    (nome, tipo, modulo, postos, janela_tipo, minimo_bipes, limite_horas, canais, destinatarios, ativa, criado_por)
  values ('LST beta', 'parado', 'shopfloor', array['Teste'], 'op', null, 24, array['telegram'],
          array['00000000-0000-0000-0000-0000000000c1']::uuid[], true, '00000000-0000-0000-0000-000000000001')
  returning id into v_b;
  insert into public.alerta_regras
    (nome, tipo, modulo, postos, janela_tipo, minimo_bipes, limite_horas, canais, destinatarios, ativa, criado_por)
  values ('LST Alfa', 'parado', 'shopfloor', array['Teste'], 'op', null, 24, array['telegram'],
          array['00000000-0000-0000-0000-0000000000c1']::uuid[], true, '00000000-0000-0000-0000-000000000001')
  returning id into v_a;
  insert into public.alerta_regras
    (nome, tipo, modulo, postos, janela_tipo, minimo_bipes, limite_horas, canais, destinatarios, ativa, criado_por)
  values ('LST desativada', 'parado', 'shopfloor', array['Teste'], 'op', null, 24, array['telegram'],
          array['00000000-0000-0000-0000-0000000000c1']::uuid[], false, '00000000-0000-0000-0000-000000000001')
  returning id into v_off;
  insert into public.alerta_regras
    (nome, tipo, modulo, postos, janela_tipo, minimo_bipes, limite_horas, canais, destinatarios, ativa, criado_por, excluida_em)
  values ('LST excluída', 'parado', 'shopfloor', array['Teste'], 'op', null, 24, array['telegram'],
          array['00000000-0000-0000-0000-0000000000c1']::uuid[], false, '00000000-0000-0000-0000-000000000001', now())
  returning id into v_excl;

  -- L1
  perform set_config('teste.perms', 'recebimento.visualizar', false);
  begin
    perform * from public.alerta_parado_regras_lista();
    raise exception 'L1 FALHOU: sem permissão não deu erro';
  exception when raise_exception then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;

  -- L2: quem só VISUALIZA o ShopFloor lê a lista (a RLS de alerta_regras não deixaria).
  perform set_config('teste.perms', 'shopfloor.visualizar', false);
  select string_agg(l.nome, '|' order by ord) into v_nomes
    from public.alerta_parado_regras_lista() with ordinality as l(id, nome, ord)
   where l.nome like 'LST %';
  if v_nomes is distinct from 'LST Alfa|LST beta' then
    raise exception 'L2 FALHOU: [%]', v_nomes;
  end if;
  if not exists (select 1 from public.alerta_parado_regras_lista() l where l.id = v_a and l.nome = 'LST Alfa') then
    raise exception 'L2 FALHOU: id não confere';
  end if;
  -- Nenhuma regra de outro tipo, mesmo ativa.
  if exists (select 1 from public.alerta_parado_regras_lista() l
               join public.alerta_regras r on r.id = l.id
              where r.tipo <> 'parado' or not r.ativa or r.excluida_em is not null) then
    raise exception 'L2 FALHOU: veio regra de outro tipo, desativada ou excluída';
  end if;
  select count(*) into v_cols
    from information_schema.routines rt
    join information_schema.parameters p on p.specific_name = rt.specific_name
   where rt.routine_schema = 'public' and rt.routine_name = 'alerta_parado_regras_lista' and p.parameter_mode = 'OUT';
  if v_cols <> 2 then
    raise exception 'L2 FALHOU: a função devolve % colunas (esperado 2: id e nome)', v_cols;
  end if;

  -- L3
  if not has_function_privilege('authenticated', 'public.alerta_parado_regras_lista()', 'execute')
     or not has_function_privilege('service_role', 'public.alerta_parado_regras_lista()', 'execute')
     or has_function_privilege('anon', 'public.alerta_parado_regras_lista()', 'execute') then
    raise exception 'L3 FALHOU: grants (authenticated sim, anon não)';
  end if;

  perform set_config('teste.perms', 'shopfloor.administrar,recebimento.administrar', false);
  delete from public.alerta_regras where id in (v_a, v_b, v_off, v_excl);
  raise notice 'L1 ok';
  raise notice 'L2 ok';
  raise notice 'L3 ok';
end $t$;

select 'alertas_parado_regras_lista_test ok' as resultado;
