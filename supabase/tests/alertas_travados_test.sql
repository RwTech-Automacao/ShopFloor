-- Testes SQL da 0172 (tipo de regra 'parado' = "Parado ou travado na produção"). Rodar com
-- supabase/tests/rodar-alertas-test.sh, na mesma base, DEPOIS da 0170, com o esquema mínimo
-- (alertas_travados_esquema.sql) e a 0172 aplicada duas vezes.
--
-- ⚠️ POR QUE ESTE ARQUIVO EXISTE: a regra roda de 5 em 5 minutos sobre sf_registros e decide quem recebe
-- e-mail. Os defeitos caros são SQL puro: contar peça que JÁ TERMINOU, ou a que andou para outro posto
-- (o ÚLTIMO registro manda), ou OP finalizada quando a regra disse "só ativas", ou perder o limite de 720 h.
--
-- O mapa dos testes (alerta_travados lida direto, com massa montada à mão):
--   T1  esquema: colunas novas com default true; limite_horas 1..720 (721 e 0 recusados); a regra antiga é
--       convertida (feito no runner: ela entra desativada, com os defaults); UMA alerta_avaliar de 4 parâmetros;
--       grants da função de leitura;
--   T2  peça em cada posto: o último registro manda (quem andou deixa de contar no posto de trás);
--   T3  peça concluída (último posto, não reprovado) NÃO conta, nem com o posto da regra = o último;
--   T4  reprovada no último posto NÃO terminou; retrabalho depois de terminar continua concluída;
--   T5  Manutenção: incluir_manutencao liga/desliga a reprovada e a peça cujo último registro é no posto
--       Manutenção;
--   T6  OP finalizada: só_ativas liga/desliga (status com espaço/minúscula também é finalizada);
--   T7  corte: data_hora == corte conta; um segundo depois não;
--   T8  filtros de PMO e de posto; OP sem sf_ordens é ignorada; OP sem rota não conclui nada;
--   T9  peso do bipe (pecas) soma; SN vazio é ignorado; amostras = 3 SNs, do mais antigo;
--   T10 a regra completa: a mensagem sabe se foi em expediente (dados.expediente) e leva os itens.
-- (A idempotência da 0172 e a conversão da regra antiga são do runner: ela é aplicada duas vezes.)

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.administrar,recebimento.administrar', false);

update public.alerta_regras set ativa = false where ativa;
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;

-- ---------- helpers ----------
-- Uma OP com rota Inicial(1) > Teste(2) > Embalagem(3) > Almoxarifado(4). p_rota = false: sem rota nenhuma.
create function public.teste_trv_op(p_pmo text, p_op text, p_status text default 'ATIVA', p_rota boolean default true)
returns void language plpgsql as $f$
declare v_id uuid;
begin
  insert into public.sf_ordens (pmo, op, status) values (p_pmo, p_op, p_status) returning id into v_id;
  if p_rota then
    insert into public.sf_ordem_postos (ordem_id, posto, ordem)
    values (v_id, 'Inicial', 1), (v_id, 'Teste', 2), (v_id, 'Embalagem', 3), (v_id, 'Almoxarifado', 4);
  end if;
end $f$;

-- Um registro de uma peça, p_dias atrás (p_dias fracionário vale).
create function public.teste_trv_reg(p_pmo text, p_op text, p_sn text, p_posto text, p_status text,
                                      p_dias numeric, p_pecas int default 1) returns void language sql as $f$
  insert into public.sf_registros (pmo, op, numero_serie, numero_serie_norm, posto, status, data_hora, pecas)
  values (p_pmo, p_op, p_sn, upper(p_sn), p_posto, p_status, now() - make_interval(secs => (p_dias * 86400)::int), p_pecas)
$f$;

-- O que a regra enxerga: 'posto:peças:reprovada' ordenado, para comparar.
create function public.teste_trv_ler(p_pmo text, p_op text, p_postos text[], p_dias numeric default 7,
                                      p_ativas boolean default true, p_manut boolean default true,
                                      p_pmos text[] default '{}')
returns text language sql as $f$
  select coalesce(string_agg(t.posto || ':' || t.pecas || ':' || case when t.reprovada then 'R' else 'n' end,
                             ' ' order by t.posto, t.reprovada), '')
    from public.alerta_travados(p_postos, p_pmos, now() - make_interval(secs => (p_dias * 86400)::int),
                                p_ativas, p_manut) t
   where t.pmo = p_pmo and t.op = p_op
$f$;

create function public.teste_trv_igual(p_nome text, p_obtido text, p_esperado text) returns void language plpgsql as $f$
begin
  if p_obtido is distinct from p_esperado then
    raise exception '% FALHOU: esperado [%], obtido [%]', p_nome, p_esperado, p_obtido;
  end if;
end $f$;

-- ---------- T1: esquema ----------
do $t$
declare v_id uuid;
begin
  insert into public.alerta_regras
    (nome, tipo, modulo, postos, janela_tipo, minimo_bipes, limite_horas, canais, destinatarios, ativa, criado_por)
  values ('TRV esquema', 'parado', 'shopfloor', array['Teste'], 'op', null, 720, array['telegram'],
          array['00000000-0000-0000-0000-0000000000c1']::uuid[], true, '00000000-0000-0000-0000-000000000001')
  returning id into v_id;
  if not (select so_ops_ativas and incluir_manutencao from public.alerta_regras where id = v_id) then
    raise exception 'T1 FALHOU: as duas opções não nascem true';
  end if;
  delete from public.alerta_regras where id = v_id;

  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, janela_tipo, minimo_bipes, limite_horas, canais, destinatarios, ativa, criado_por)
    values ('TRV 721h', 'parado', 'shopfloor', array['Teste'], 'op', null, 721, array['telegram'],
            array['00000000-0000-0000-0000-0000000000c1']::uuid[], true, '00000000-0000-0000-0000-000000000001');
    raise exception 'T1 FALHOU: limite_horas = 721 aceito';
  exception when check_violation then null;
  end;
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, janela_tipo, minimo_bipes, limite_horas, canais, destinatarios, ativa, criado_por)
    values ('TRV 0h', 'parado', 'shopfloor', array['Teste'], 'op', null, 0, array['telegram'],
            array['00000000-0000-0000-0000-0000000000c1']::uuid[], true, '00000000-0000-0000-0000-000000000001');
    raise exception 'T1 FALHOU: limite_horas = 0 aceito';
  exception when check_violation then null;
  end;
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, janela_tipo, minimo_bipes, limite_horas, canais, destinatarios, ativa, criado_por)
    values ('TRV sem limite', 'parado', 'shopfloor', array['Teste'], 'op', null, null, array['telegram'],
            array['00000000-0000-0000-0000-0000000000c1']::uuid[], true, '00000000-0000-0000-0000-000000000001');
    raise exception 'T1 FALHOU: regra parado sem limite aceita';
  exception when check_violation then null;
  end;
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes, limite_horas, canais,
       destinatarios, ativa, criado_por)
    values ('TRV aprov com horas', 'aprovacao', 'shopfloor', array['Teste'], 90, 'tempo', 60, 5, 100,
            array['telegram'], array['00000000-0000-0000-0000-0000000000c1']::uuid[], true,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'T1 FALHOU: limite_horas em regra de aprovacao aceito';
  exception when check_violation then null;
  end;

  if (select count(*) from pg_proc where proname = 'alerta_avaliar' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'T1 FALHOU: sobrou sobrecarga de alerta_avaliar';
  end if;
  if not has_function_privilege('service_role', 'public.alerta_travados(text[],text[],timestamptz,boolean,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.alerta_travados(text[],text[],timestamptz,boolean,boolean)', 'execute')
     or has_function_privilege('anon', 'public.alerta_travados(text[],text[],timestamptz,boolean,boolean)', 'execute') then
    raise exception 'T1 FALHOU: grants de alerta_travados (service_role sim; authenticated e anon não)';
  end if;
  -- As funções do Almoxarifado que a tela usa NÃO foram removidas (só o alerta deixou de usá-las).
  if to_regprocedure('public.sf_almox_pendencias_base()') is null then
    -- Esta base não tem a 0167 das _base com tabelas, mas a função existe (plpgsql).
    raise exception 'T1 FALHOU: sf_almox_pendencias_base sumiu';
  end if;
  raise notice 'T1 ok';
end $t$;

-- ---------- massa ----------
\o /dev/null
select public.teste_trv_op('PMOT', 'A');           -- ativa, com rota
select public.teste_trv_op('PMOT', 'F', 'FINALIZADA');
select public.teste_trv_op('PMOT', 'F2', '  finalizada ');
select public.teste_trv_op('PMOT', 'SR', 'ATIVA', false);   -- sem rota
select public.teste_trv_op('PMOZ', 'B');           -- outra PMO

-- OP A
select public.teste_trv_reg('PMOT', 'A', 'a1', 'Teste', 'Aprovado', 10);                 -- parada em Teste
select public.teste_trv_reg('PMOT', 'A', 'a2', 'Inicial', '', 20);                       -- andou: Inicial > Teste > Embalagem
select public.teste_trv_reg('PMOT', 'A', 'a2', 'Teste', 'Aprovado', 15);
select public.teste_trv_reg('PMOT', 'A', 'a2', 'Embalagem', '', 10);                     -- o último manda: Embalagem
select public.teste_trv_reg('PMOT', 'A', 'a3', 'Almoxarifado', '', 10);                  -- concluída
select public.teste_trv_reg('PMOT', 'A', 'a4', 'Almoxarifado', 'Reprovado', 10);         -- reprovada no último posto
select public.teste_trv_reg('PMOT', 'A', 'a5', 'Teste', 'Reprovado', 9);                 -- reprovada no Teste
select public.teste_trv_reg('PMOT', 'A', 'a6', 'Teste', 'Aprovado', 0.04);               -- recente: abaixo do corte
select public.teste_trv_reg('PMOT', 'A', 'a7', 'Teste', 'Aprovado', 9);                  -- Teste > Manutenção
select public.teste_trv_reg('PMOT', 'A', 'a7', 'Manutenção', '', 8);
select public.teste_trv_reg('PMOT', 'A', 'a8', 'Almoxarifado', '', 12);                  -- terminou e depois voltou ao Teste
select public.teste_trv_reg('PMOT', 'A', 'a8', 'Teste', 'Reprovado', 9);                 --   (retrabalho): continua concluída
select public.teste_trv_reg('PMOT', 'A', 'b1', 'Teste', 'Aprovado', 11, 4);              -- painel de 4 placas
select public.teste_trv_reg('PMOT', 'A', '',   'Teste', 'Aprovado', 11);                 -- SN vazio: ignorado
-- OP F e F2 (finalizadas), SR (sem rota), B (outra PMO)
select public.teste_trv_reg('PMOT', 'F',  'f1', 'Teste', 'Aprovado', 10);
select public.teste_trv_reg('PMOT', 'F2', 'f2', 'Teste', 'Aprovado', 10);
select public.teste_trv_reg('PMOT', 'SR', 's1', 'Teste', 'Aprovado', 10);
select public.teste_trv_reg('PMOT', 'SR', 's2', 'Almoxarifado', '', 10);                 -- sem rota nada conclui
select public.teste_trv_reg('PMOZ', 'B',  'z1', 'Teste', 'Aprovado', 10);
-- OP sem linha em sf_ordens
select public.teste_trv_reg('PMOT', 'ORFA', 'o1', 'Teste', 'Aprovado', 10);

-- OP C (fronteira do corte) e OP AM (amostras)
select public.teste_trv_op('PMOT', 'C');
insert into public.sf_registros (pmo, op, numero_serie, numero_serie_norm, posto, status, data_hora)
values ('PMOT', 'C', 'c1', 'C1', 'Teste', 'Aprovado', '2026-01-01 12:00:00+00');
select public.teste_trv_op('PMOT', 'AM');
select public.teste_trv_reg('PMOT', 'AM', 'm3', 'Teste', '', 8);
select public.teste_trv_reg('PMOT', 'AM', 'm1', 'Teste', '', 10);
select public.teste_trv_reg('PMOT', 'AM', 'm5', 'Teste', '', 7.2);
select public.teste_trv_reg('PMOT', 'AM', 'm2', 'Teste', '', 9);
select public.teste_trv_reg('PMOT', 'AM', 'm4', 'Teste', '', 7.5);

\o

do $t$
declare
  v_todos text[] := array['Inicial', 'Teste', 'Embalagem', 'Almoxarifado', 'Manutenção'];
begin
  -- T2: peça em cada posto; o último registro manda (a2 NÃO conta no Inicial nem no Teste).
  perform public.teste_trv_igual('T2 todos', public.teste_trv_ler('PMOT', 'A', v_todos),
    'Almoxarifado:1:R Embalagem:1:n Manutenção:1:n Teste:5:n Teste:1:R');
  perform public.teste_trv_igual('T2 só Teste (a1 + painel de 4 = 5 placas; a5 reprovada à parte)',
    public.teste_trv_ler('PMOT', 'A', array['Teste']), 'Teste:5:n Teste:1:R');
  perform public.teste_trv_igual('T2 a2 andou: Inicial vazio', public.teste_trv_ler('PMOT', 'A', array['Inicial']), '');
  perform public.teste_trv_igual('T2 a2 está na Embalagem', public.teste_trv_ler('PMOT', 'A', array['Embalagem']), 'Embalagem:1:n');

  -- T3 e T4: a3 terminou (não conta, mesmo com o posto da regra = o último); a4 reprovada no último posto NÃO
  -- terminou; a8 terminou e voltou ao Teste reprovada (retrabalho): continua concluída, não aparece no Teste.
  perform public.teste_trv_igual('T3/T4 Almoxarifado', public.teste_trv_ler('PMOT', 'A', array['Almoxarifado']), 'Almoxarifado:1:R');

  -- T5: sem Manutenção somem as reprovadas (a4, a5) e a peça cujo último registro é no posto Manutenção (a7).
  perform public.teste_trv_igual('T5 sem Manutenção', public.teste_trv_ler('PMOT', 'A', v_todos, 7, true, false),
    'Embalagem:1:n Teste:5:n');

  -- T6: OP finalizada só entra com so_ativas = false (o status é comparado sem maiúsculas e sem espaços).
  perform public.teste_trv_igual('T6 F ativas', public.teste_trv_ler('PMOT', 'F', array['Teste']), '');
  perform public.teste_trv_igual('T6 F todas', public.teste_trv_ler('PMOT', 'F', array['Teste'], 7, false), 'Teste:1:n');
  perform public.teste_trv_igual('T6 F2 (status minúsculo e com espaço) ativas', public.teste_trv_ler('PMOT', 'F2', array['Teste']), '');
  perform public.teste_trv_igual('T6 F2 todas', public.teste_trv_ler('PMOT', 'F2', array['Teste'], 7, false), 'Teste:1:n');

  -- T7: o corte é inclusivo (data_hora <= corte) e exato.
  if not exists (select 1 from public.alerta_travados(array['Teste'], '{}'::text[], '2026-01-01 12:00:00+00', true, true) where op = 'C') then
    raise exception 'T7 FALHOU: peça com data_hora igual ao corte não contou';
  end if;
  if exists (select 1 from public.alerta_travados(array['Teste'], '{}'::text[], '2026-01-01 11:59:59+00', true, true) where op = 'C') then
    raise exception 'T7 FALHOU: peça um segundo mais nova que o corte contou';
  end if;
  -- e o limite de 720 h (30 dias) funciona como qualquer outro: nada de A passa de 30 dias
  perform public.teste_trv_igual('T7 30 dias', public.teste_trv_ler('PMOT', 'A', v_todos, 30), '');

  -- T8: filtros de PMO e de posto; OP sem sf_ordens é ignorada; OP sem rota não conclui nada.
  perform public.teste_trv_igual('T8 pmo fora do filtro', public.teste_trv_ler('PMOZ', 'B', array['Teste'], 7, true, true, array['PMOT']), '');
  perform public.teste_trv_igual('T8 pmo no filtro', public.teste_trv_ler('PMOZ', 'B', array['Teste'], 7, true, true, array['PMOZ']), 'Teste:1:n');
  perform public.teste_trv_igual('T8 sem filtro de pmo', public.teste_trv_ler('PMOZ', 'B', array['Teste']), 'Teste:1:n');
  perform public.teste_trv_igual('T8 OP sem sf_ordens', public.teste_trv_ler('PMOT', 'ORFA', array['Teste']), '');
  perform public.teste_trv_igual('T8 OP sem rota: nada conclui', public.teste_trv_ler('PMOT', 'SR', array['Teste', 'Almoxarifado']),
    'Almoxarifado:1:n Teste:1:n');
  perform public.teste_trv_igual('T8 sem posto nenhum', public.teste_trv_ler('PMOT', 'A', '{}'::text[]), '');

  -- T9: SN vazio ignorado (a conta do Teste acima já mostra 5, não 6); amostras = 3 SNs do mais antigo.
  if (select amostras from public.alerta_travados(array['Teste'], '{}'::text[], now() - interval '7 days', true, true)
       where op = 'AM') is distinct from array['m1', 'm2', 'm3'] then
    raise exception 'T9 FALHOU: amostras = %', (select amostras from public.alerta_travados(array['Teste'], '{}'::text[], now() - interval '7 days', true, true) where op = 'AM');
  end if;
  if (select pecas from public.alerta_travados(array['Teste'], '{}'::text[], now() - interval '7 days', true, true) where op = 'AM') <> 5 then
    raise exception 'T9 FALHOU: peças de AM';
  end if;
  raise notice 'T2-T9 ok';
end $t$;

-- ---------- T10: a regra completa (RELATÓRIO ÚNICO) ----------
-- O app monta p_parados (a conta de horário mora no TS) com UM item por regra (pmo 'TODAS', op '—'; as OPs
-- vão dentro de `itens`) e a alerta_avaliar abre UMA ocorrência por REGRA; a mensagem precisa saber se a
-- conta foi em expediente. O banco só repassa `itens` ao `dados` do envio.
create function public.teste_trv_regra(p_nome text) returns uuid language sql as $f$
  insert into public.alerta_regras
    (nome, tipo, modulo, postos, janela_tipo, janela_valor, minimo_bipes, limite_horas, canais,
     destinatarios, avisar_pessoas, avisar_canal, ativa, criado_por, lembrete_min)
  values (p_nome, 'parado', 'shopfloor', array['Teste', 'Embalagem'], 'op', null, null, 168, array['telegram'],
          array['00000000-0000-0000-0000-0000000000c1']::uuid[], true, false, true,
          '00000000-0000-0000-0000-000000000001', 1440)
  returning id
$f$;

do $t$
declare
  v_id uuid := public.teste_trv_regra('TRV completa');
  v_mapa jsonb;
  v_dados jsonb;
begin
  -- Duas OPs paradas: UM item da regra.
  v_mapa := jsonb_build_object(v_id::text, jsonb_build_array(
    jsonb_build_object('pmo', 'TODAS', 'op', '—', 'posto', 'Teste', 'mais_antiga_min', 14400, 'expediente', true,
      'itens', jsonb_build_array(
        jsonb_build_object('pmo', 'PMOT', 'op', 'A', 'mais_antiga_min', 14400, 'itens', jsonb_build_array(
          jsonb_build_object('tipo', 'posto', 'codigo', 'Teste', 'pecas', 5, 'minutos', 14400),
          jsonb_build_object('tipo', 'conserto', 'codigo', 'Teste', 'pecas', 1, 'minutos', 12960))),
        jsonb_build_object('pmo', 'PMOT', 'op', 'B', 'mais_antiga_min', 12000, 'itens', jsonb_build_array(
          jsonb_build_object('tipo', 'posto', 'codigo', 'Embalagem', 'pecas', 2, 'minutos', 12000)))))));
  perform public.alerta_avaliar(p_parados => v_mapa);
  select dados into v_dados from public.alerta_envios
   where dados->>'regra_nome' = 'TRV completa' and tipo = 'alerta' order by criado_em desc limit 1;
  if v_dados is null then raise exception 'T10 FALHOU: nenhum alerta enfileirado'; end if;
  if (v_dados->>'expediente')::boolean is not true then raise exception 'T10 FALHOU: dados.expediente = %', v_dados->>'expediente'; end if;
  if (v_dados->>'limite_horas')::int <> 168 then raise exception 'T10 FALHOU: limite_horas = %', v_dados->>'limite_horas'; end if;
  if jsonb_array_length(v_dados->'itens') <> 2 or v_dados->'itens'->0->>'op' <> 'A'
     or jsonb_array_length(v_dados->'itens'->0->'itens') <> 2
     or v_dados->'itens'->0->'itens'->1->>'tipo' <> 'conserto' then
    raise exception 'T10 FALHOU: itens = %', v_dados->'itens';
  end if;
  -- UMA ocorrência por regra, com a chave TODAS/— e o posto fixo da regra.
  if (select count(*) from public.alerta_ocorrencias oc join public.alerta_regras rg on rg.id = oc.regra_id
       where rg.nome = 'TRV completa' and oc.defeito = 'TODAS/—' and oc.posto = 'Teste') <> 1
     or (select count(*) from public.alerta_ocorrencias where regra_id = v_id) <> 1 then
    raise exception 'T10 FALHOU: ocorrência única por regra';
  end if;
  -- Uma rodada logo em seguida (mesma lista) não repete a mensagem.
  perform public.alerta_avaliar(p_parados => v_mapa);
  if (select count(*) from public.alerta_envios where dados->>'regra_nome' = 'TRV completa') <> 1 then
    raise exception 'T10 FALHOU: repetiu o alerta antes do lembrete';
  end if;

  -- 24 h depois: UM lembrete, com a lista NOVA (só a OP B) e sem a chave `expediente` (relógio corrido).
  update public.alerta_ocorrencias set ultimo_envio_em = now() - interval '25 hours'
   where regra_id = v_id;
  v_mapa := jsonb_build_object(v_id::text, jsonb_build_array(
    jsonb_build_object('pmo', 'TODAS', 'op', '—', 'posto', 'Teste', 'mais_antiga_min', 12100,
      'itens', jsonb_build_array(
        jsonb_build_object('pmo', 'PMOT', 'op', 'B', 'mais_antiga_min', 12100, 'itens', jsonb_build_array(
          jsonb_build_object('tipo', 'posto', 'codigo', 'Embalagem', 'pecas', 2, 'minutos', 12100)))))));
  perform public.alerta_avaliar(p_parados => v_mapa);
  select dados into v_dados from public.alerta_envios
   where dados->>'regra_nome' = 'TRV completa' and tipo = 'lembrete' order by criado_em desc limit 1;
  if v_dados is null then raise exception 'T10 FALHOU: lembrete de 24 h não saiu'; end if;
  if (select count(*) from public.alerta_envios where dados->>'regra_nome' = 'TRV completa' and tipo = 'lembrete') <> 1 then
    raise exception 'T10 FALHOU: mais de um lembrete na rodada';
  end if;
  if (v_dados->>'expediente')::boolean is not false then raise exception 'T10 FALHOU: expediente deveria ser false, é %', v_dados->>'expediente'; end if;
  if jsonb_array_length(v_dados->'itens') <> 1 or v_dados->'itens'->0->>'op' <> 'B' then
    raise exception 'T10 FALHOU: o lembrete deveria ter só a OP B: %', v_dados->'itens';
  end if;

  -- Nada parado: a chave vem com lista vazia e a ocorrência normaliza.
  perform public.alerta_avaliar(p_parados => jsonb_build_object(v_id::text, '[]'::jsonb));
  if not exists (select 1 from public.alerta_envios where dados->>'regra_nome' = 'TRV completa' and tipo = 'normalizou') then
    raise exception 'T10 FALHOU: não normalizou';
  end if;
  update public.alerta_regras set ativa = false where id = v_id;
  raise notice 'T10 ok';
end $t$;

select 'alertas_travados_test ok' as resultado;
