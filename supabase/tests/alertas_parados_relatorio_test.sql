-- Testes SQL da 0177 (relatório "Peças paradas" de uma regra). Rodar com supabase/tests/rodar-alertas-test.sh,
-- DEPOIS da foto (alertas_parados_relatorio_foto.sql, tirada com a alerta_travados da 0172) e da 0177 aplicada
-- duas vezes.
--
--   R1  a alerta_travados reescrita (agrupamento da alerta_travados_sns) devolve EXATAMENTE a foto da 0172,
--       na grade inteira (cortes x postos x pmos x só ativas x Manutenção), inclusive as amostras;
--   R2  alerta_travados_sns: uma linha por SN; somar por grupo dá a alerta_travados; grants (só service_role);
--   R3  alerta_parado_regra: sem permissão é ERRO; regra inexistente/excluída/de outro tipo = ok:false; devolve
--       nome, limite, postos, pmos, opções e os turnos em ordem;
--   R4  alerta_parado_sns: lê postos/pmos/opções DA REGRA (pmos com btrim; opções da regra valem), SN a SN, da
--       mais antiga para a mais nova; sem permissão é ERRO; grants (authenticated sim, anon não).

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.administrar,recebimento.administrar', false);

-- ---------- R1: mesma saída da 0172 ----------
do $t$
declare v_dif bigint;
begin
  with novo as (
    select c.corte, p.id as postos_id, m.id as pmos_id, a.so_ativas, b.manut, t.*
      from public.teste_foto_cortes c
     cross join public.teste_foto_postos p
     cross join public.teste_foto_pmos m
     cross join (values (true), (false)) a(so_ativas)
     cross join (values (true), (false)) b(manut)
     cross join lateral public.alerta_travados(p.postos, m.pmos, c.corte, a.so_ativas, b.manut) t
  )
  select count(*) into v_dif from (
    (select * from novo except all select * from public.teste_foto_travados)
    union all
    (select * from public.teste_foto_travados except all select * from novo)
  ) d;
  if v_dif <> 0 then
    raise exception 'R1 FALHOU: a alerta_travados da 0177 difere da 0172 em % linha(s)', v_dif;
  end if;
  raise notice 'R1 ok (% linhas iguais)', (select count(*) from public.teste_foto_travados);
end $t$;

-- ---------- R2: o miolo SN a SN ----------
do $t$
declare v_sns text;
begin
  select string_agg(t.numero_serie || ':' || t.posto || ':' || t.pecas || ':' || case when t.reprovada then 'R' else 'n' end,
                    ' ' order by t.numero_serie)
    into v_sns
    from public.alerta_travados_sns(array['Inicial', 'Teste', 'Embalagem', 'Almoxarifado', 'Manutenção'], '{}',
                                    now() - interval '7 days', true, true) t
   where t.pmo = 'PMOT' and t.op = 'A';
  if v_sns is distinct from 'a1:Teste:1:n a2:Embalagem:1:n a4:Almoxarifado:1:R a5:Teste:1:R a7:Manutenção:1:n b1:Teste:4:n' then
    raise exception 'R2 FALHOU: SNs da OP A = [%]', v_sns;
  end if;
  if not has_function_privilege('service_role', 'public.alerta_travados_sns(text[],text[],timestamptz,boolean,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.alerta_travados_sns(text[],text[],timestamptz,boolean,boolean)', 'execute')
     or has_function_privilege('anon', 'public.alerta_travados_sns(text[],text[],timestamptz,boolean,boolean)', 'execute') then
    raise exception 'R2 FALHOU: grants de alerta_travados_sns (só service_role)';
  end if;
  if not has_function_privilege('service_role', 'public.alerta_travados(text[],text[],timestamptz,boolean,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.alerta_travados(text[],text[],timestamptz,boolean,boolean)', 'execute') then
    raise exception 'R2 FALHOU: grants de alerta_travados mudaram';
  end if;
  raise notice 'R2 ok';
end $t$;

-- ---------- R3 e R4: as leituras da tela ----------
do $t$
declare
  v_id uuid; v_outra uuid; v_excl uuid; v_r jsonb; v_sns text; v_n int;
begin
  insert into public.alerta_regras
    (nome, tipo, modulo, postos, pmos, janela_tipo, minimo_bipes, limite_horas, canais, destinatarios, ativa, criado_por,
     so_ops_ativas, incluir_manutencao)
  values ('REL parados', 'parado', 'shopfloor', array['Teste', 'Embalagem', 'Manutenção'], array['PMOT'], 'op', null, 168,
          array['telegram'], array['00000000-0000-0000-0000-0000000000c1']::uuid[], false,
          '00000000-0000-0000-0000-000000000001', true, false)
  returning id into v_id;
  insert into public.alerta_regra_intervalos (regra_id, inicio, fim)
  values (v_id, '13:30', '17:30'), (v_id, '07:00', '12:00');
  insert into public.alerta_regras
    (nome, tipo, modulo, postos, janela_tipo, minimo_bipes, limite_horas, canais, destinatarios, ativa, criado_por, excluida_em)
  values ('REL excluída', 'parado', 'shopfloor', array['Teste'], 'op', null, 24, array['telegram'],
          array['00000000-0000-0000-0000-0000000000c1']::uuid[], false, '00000000-0000-0000-0000-000000000001', now())
  returning id into v_excl;
  select id into v_outra from public.alerta_regras where tipo <> 'parado' limit 1;

  -- Sem permissão: ERRO nas duas.
  perform set_config('teste.perms', 'recebimento.visualizar', false);
  begin
    perform public.alerta_parado_regra(v_id);
    raise exception 'R3 FALHOU: alerta_parado_regra sem permissão não deu erro';
  exception when raise_exception then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  begin
    perform * from public.alerta_parado_sns(v_id, now());
    raise exception 'R4 FALHOU: alerta_parado_sns sem permissão não deu erro';
  exception when raise_exception then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;

  perform set_config('teste.perms', 'shopfloor.visualizar', false);

  -- R3
  v_r := public.alerta_parado_regra(v_id);
  if (v_r->>'ok')::boolean is not true
     or v_r->'regra'->>'nome' <> 'REL parados'
     or (v_r->'regra'->>'limite_horas')::int <> 168
     or v_r->'regra'->'postos' <> '["Teste", "Embalagem", "Manutenção"]'::jsonb
     or v_r->'regra'->'pmos' <> '["PMOT"]'::jsonb
     or (v_r->'regra'->>'incluir_manutencao')::boolean is not false
     or (v_r->'regra'->>'ativa')::boolean is not false
     or v_r->'turnos' <> '[{"inicio": "07:00:00", "fim": "12:00:00"}, {"inicio": "13:30:00", "fim": "17:30:00"}]'::jsonb then
    raise exception 'R3 FALHOU: %', v_r;
  end if;
  if public.alerta_parado_regra(v_excl)->>'motivo' is distinct from 'regra_inexistente'
     or public.alerta_parado_regra(gen_random_uuid())->>'motivo' is distinct from 'regra_inexistente'
     or (v_outra is not null and public.alerta_parado_regra(v_outra)->>'motivo' is distinct from 'regra_inexistente') then
    raise exception 'R3 FALHOU: regra excluída/inexistente/de outro tipo deveria ser regra_inexistente';
  end if;

  -- R4: postos da regra (Teste, Embalagem, Manutenção), só PMOT, só ativas, SEM Manutenção (a5 reprovada e a7 na
  -- Manutenção saem; PMOZ/B, F, F2 e a OP órfã também).
  select string_agg(s.op || '/' || s.numero_serie || ':' || s.posto || ':' || s.pecas, ' ' order by s.op, s.numero_serie),
         count(*)
    into v_sns, v_n
    from public.alerta_parado_sns(v_id, now() - interval '7 days') s
   where s.op in ('A', 'SR', 'B', 'F');
  if v_sns is distinct from 'A/a1:Teste:1 A/a2:Embalagem:1 A/b1:Teste:4 SR/s1:Teste:1' then
    raise exception 'R4 FALHOU: [%]', v_sns;
  end if;
  -- A ordem que a função devolve já é a da tela (mais antiga primeiro).
  if (select array_agg(s.em) from public.alerta_parado_sns(v_id, now() - interval '7 days') s)
     <> (select array_agg(s.em order by s.em) from public.alerta_parado_sns(v_id, now() - interval '7 days') s) then
    raise exception 'R4 FALHOU: a saída não vem da mais antiga para a mais nova';
  end if;
  -- Mesma coisa que o avaliador vê pela alerta_travados com os mesmos parâmetros.
  if (select sum(s.pecas) from public.alerta_parado_sns(v_id, now() - interval '7 days') s)
     <> (select sum(t.pecas) from public.alerta_travados(array['Teste', 'Embalagem', 'Manutenção'], array['PMOT'],
                                                         now() - interval '7 days', true, false) t) then
    raise exception 'R4 FALHOU: soma de peças difere da alerta_travados';
  end if;
  -- Regra excluída, inexistente ou corte nulo: nenhuma linha.
  if exists (select 1 from public.alerta_parado_sns(v_excl, now()))
     or exists (select 1 from public.alerta_parado_sns(gen_random_uuid(), now()))
     or exists (select 1 from public.alerta_parado_sns(v_id, null)) then
    raise exception 'R4 FALHOU: regra excluída/inexistente/corte nulo deveria vir vazio';
  end if;

  if not has_function_privilege('authenticated', 'public.alerta_parado_regra(uuid)', 'execute')
     or has_function_privilege('anon', 'public.alerta_parado_regra(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.alerta_parado_sns(uuid,timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.alerta_parado_sns(uuid,timestamptz)', 'execute') then
    raise exception 'R3/R4 FALHOU: grants (authenticated sim, anon não)';
  end if;

  perform set_config('teste.perms', 'shopfloor.administrar,recebimento.administrar', false);
  delete from public.alerta_regras where id in (v_id, v_excl);
  raise notice 'R3 ok';
  raise notice 'R4 ok';
end $t$;

select 'alertas_parados_relatorio_test ok' as resultado;
