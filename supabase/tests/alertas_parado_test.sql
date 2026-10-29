-- Testes SQL da 0167 (tipo de regra 'parado': placas paradas antes do Almoxarifado). Rodar com
-- supabase/tests/rodar-alertas-test.sh: DEPOIS do teto de 3 dias pós-0151, na mesma base, com a
-- 0167 por cima de tudo.
--
-- ⚠️ POR QUE ESTE ARQUIVO EXISTE: a 0167 recria o alerta_avaliar (que roda de 5 em 5 minutos em
-- produção) com um SEXTO ramo no `union all` e MUDA a assinatura (4º parâmetro p_parados). Os
-- defeitos caros são SQL puro, invisíveis para o vitest: sobrar uma sobrecarga (chamada ambígua no
-- PostgREST), a ocorrência não ser uma por OP, a lista de itens não chegar na fila, e — o pior —
-- normalizar por engano uma OP quando o app não conseguiu ler as pendências.
--
-- Aqui o banco NÃO precisa de sf_registros: a conta de horário e a escolha dos itens moram no app
-- (domain/parados.ts); o teste monta p_parados à mão, no formato que o app manda:
--   {"<regra_id>": [{"pmo", "op", "posto", "mais_antiga_min", "itens": [{tipo, codigo, pecas, minutos}]}]}
--
-- O mapa dos testes:
--   T1  esquema: tipo aceito; limite_horas fora de 1–72 (e nulo) recusado; limite_horas em outro tipo
--       recusado; janela diferente de 'op' recusada; UMA alerta_avaliar, a de 4 parâmetros; grants;
--   T2  abre: uma ocorrência por OP (defeito = 'PMO/OP') e uma linha 'alerta' com os itens;
--   T3  a mesma rodada de novo: zero linhas novas;
--   T4  duas OPs no mesmo mapa: duas ocorrências, cada uma com os próprios itens;
--   T5  item novo entra na MESMA ocorrência, sem mensagem;
--   T6  lembrete com a lista atualizada;
--   T7  mapa com a regra e lista vazia: normaliza (uma 'normalizou' por OP);
--   T8  ⚠️ regra AUSENTE do mapa (ou mapa nulo, ou valor que não é lista) é PULADA: nada muda;
--   T9  resolvida continua resolvida dentro da carência; depois dos 60 min, reabre;
--   T10 posto fora da regra é ignorado;
--   T11 os outros tipos seguem avaliando na mesma rodada;
--   T12 regra desativada encerra a ocorrência viva sem envio;
--   T13 o app antigo (3 parâmetros nomeados, ou posicionais) chama sem ambiguidade.
-- (A idempotência da 0167 é do runner: ela é aplicada duas vezes.)

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.administrar,recebimento.administrar', false);

-- As regras dos testes anteriores saem do caminho e a fila antiga é dada por desistida.
update public.alerta_regras set ativa = false where ativa;
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;

-- ---------- helpers ----------
-- Carla administra SÓ o ShopFloor e tem conta no Telegram (vem do teste da 0149): uma linha de fila
-- por envio, o que deixa as contagens exatas.
-- ⚠️ `minimo_bipes` vai EXPLÍCITO e nulo (o default 20 da 0113 seria recusado pelo ramo 'parado').
create function public.teste_regra_parado(p_nome text, p_postos text[] default array['ALMOX'])
returns uuid language sql as $f$
  insert into public.alerta_regras
    (nome, tipo, modulo, postos, janela_tipo, janela_valor, minimo_bipes, limite_horas, canais,
     destinatarios, avisar_pessoas, avisar_canal, ativa, criado_por)
  values (p_nome, 'parado', 'shopfloor', p_postos, 'op', null, null, 2, array['telegram'],
          array['00000000-0000-0000-0000-0000000000c1']::uuid[], true, false, true,
          '00000000-0000-0000-0000-000000000001')
  returning id
$f$;

-- Uma OP parada como o app manda: p_n caixas, a mais antiga com p_min minutos.
create function public.teste_op_parada(p_pmo text, p_op text, p_min numeric, p_n int,
                                       p_posto text default 'ALMOX')
returns jsonb language sql as $f$
  select jsonb_build_object(
           'pmo', p_pmo, 'op', p_op, 'posto', p_posto, 'mais_antiga_min', p_min,
           'itens', (select jsonb_agg(jsonb_build_object(
                                        'tipo', 'caixa',
                                        'codigo', 'CX[' || i || '][10]' || p_op || '-' || p_pmo,
                                        'pecas', 10, 'minutos', p_min - (i - 1))
                                      order by i)
                       from generate_series(1, p_n) i))
$f$;

-- O mapa p_parados com a chave da regra (uuid em texto, como o PostgREST entrega ao app).
create function public.teste_mapa(p_regra text, p_ops jsonb) returns jsonb language sql as $f$
  select jsonb_build_object(
           (select id::text from public.alerta_regras where nome = p_regra and excluida_em is null),
           p_ops)
$f$;

-- Linhas de fila desta regra, deste tipo de envio, desta OP.
create function public.teste_fila_parado(p_regra text, p_tipo text, p_op text) returns int
language sql as $f$
  select count(*)::int from public.alerta_envios
   where dados->>'regra_nome' = p_regra and tipo = p_tipo and dados->>'op' = p_op
$f$;

-- Todas as linhas de fila desta regra (para "nada novo saiu").
create function public.teste_fila_regra(p_regra text) returns int language sql as $f$
  select count(*)::int from public.alerta_envios where dados->>'regra_nome' = p_regra
$f$;

-- A ocorrência mais recente desta regra com esta chave PMO/OP.
create function public.teste_oc_parado(p_regra text, p_chave text) returns public.alerta_ocorrencias
language sql as $f$
  select oc.* from public.alerta_ocorrencias oc
    join public.alerta_regras rg on rg.id = oc.regra_id
   where rg.nome = p_regra and oc.defeito = p_chave
   order by oc.aberta_em desc, oc.id
   limit 1
$f$;

-- Roda uma avaliação como o cron roda (como service_role, com o mapa do app).
create function public.teste_avaliar_parado(p jsonb) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  v := public.alerta_avaliar(p_parados => p);
  if (v->>'ocupado')::boolean then raise exception 'avaliacao ocupada'; end if;
  return v;
end $f$;

-- ---------- T1: esquema ----------
do $t$
declare v_id uuid;
begin
  -- Tipo aceito (e sai em seguida: não tem ocorrência, a FK não segura).
  v_id := public.teste_regra_parado('Parado esquema');
  delete from public.alerta_regras where id = v_id;

  -- limite_horas fora de 1–72, e nulo, recusados.
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, janela_tipo, minimo_bipes, limite_horas, canais, destinatarios,
       ativa, criado_por)
    values ('Parado 0h', 'parado', 'shopfloor', array['ALMOX'], 'op', null, 0, array['telegram'],
            array['00000000-0000-0000-0000-0000000000c1']::uuid[], true,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'T1 FALHOU: limite_horas = 0 aceito';
  exception when check_violation then null;
  end;
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, janela_tipo, minimo_bipes, limite_horas, canais, destinatarios,
       ativa, criado_por)
    values ('Parado 73h', 'parado', 'shopfloor', array['ALMOX'], 'op', null, 73, array['telegram'],
            array['00000000-0000-0000-0000-0000000000c1']::uuid[], true,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'T1 FALHOU: limite_horas = 73 aceito';
  exception when check_violation then null;
  end;
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, janela_tipo, minimo_bipes, limite_horas, canais, destinatarios,
       ativa, criado_por)
    values ('Parado sem limite', 'parado', 'shopfloor', array['ALMOX'], 'op', null, null,
            array['telegram'], array['00000000-0000-0000-0000-0000000000c1']::uuid[], true,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'T1 FALHOU: regra parado sem limite_horas aceita (o check com NULL passa)';
  exception when check_violation then null;
  end;
  -- limite_horas em regra de outro tipo.
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
       limite_horas, canais, destinatarios, ativa, criado_por)
    values ('Aprov com horas', 'aprovacao', 'shopfloor', array['Teste'], 90, 'tempo', 60, 5, 2,
            array['telegram'], array['00000000-0000-0000-0000-000000000001']::uuid[], true,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'T1 FALHOU: limite_horas em regra de aprovacao aceito';
  exception when check_violation then null;
  end;
  -- Janela diferente de 'op'.
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, janela_tipo, janela_valor, minimo_bipes, limite_horas, canais,
       destinatarios, ativa, criado_por)
    values ('Parado janela tempo', 'parado', 'shopfloor', array['ALMOX'], 'tempo', 60, null, 2,
            array['telegram'], array['00000000-0000-0000-0000-0000000000c1']::uuid[], true,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'T1 FALHOU: regra parado com janela tempo aceita';
  exception when check_violation then null;
  end;
  -- Sem posto (o Almoxarifado é o posto da regra).
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, janela_tipo, minimo_bipes, limite_horas, canais, destinatarios,
       ativa, criado_por)
    values ('Parado sem posto', 'parado', 'shopfloor', '{}'::text[], 'op', null, 2,
            array['telegram'], array['00000000-0000-0000-0000-0000000000c1']::uuid[], true,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'T1 FALHOU: regra parado sem posto aceita';
  exception when check_violation then null;
  end;
  -- O Recebimento não tem o tipo.
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, janela_tipo, minimo_bipes, limite_horas, canais, destinatarios,
       ativa, criado_por)
    values ('Parado no Recebimento', 'parado', 'recebimento', array['ALMOX'], 'op', null, 2,
            array['telegram'], array['00000000-0000-0000-0000-0000000000b1']::uuid[], true,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'T1 FALHOU: regra parado no modulo recebimento aceita';
  exception when check_violation then null;
  end;

  -- UMA alerta_avaliar só, e é a de 4 parâmetros: sobrando a de 3, a chamada do PostgREST com
  -- 3 argumentos nomeados ficaria ambígua.
  if (select count(*) from pg_proc
       where proname = 'alerta_avaliar' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'T1 FALHOU: % sobrecargas de alerta_avaliar',
      (select count(*) from pg_proc
        where proname = 'alerta_avaliar' and pronamespace = 'public'::regnamespace);
  end if;
  if (select pronargs from pg_proc
       where proname = 'alerta_avaliar' and pronamespace = 'public'::regnamespace) <> 4 then
    raise exception 'T1 FALHOU: alerta_avaliar nao tem 4 parametros';
  end if;
  if not has_function_privilege('service_role', 'public.alerta_avaliar(text, jsonb, jsonb, jsonb)', 'execute') then
    raise exception 'T1 FALHOU: service_role nao executa alerta_avaliar';
  end if;
  if has_function_privilege('anon', 'public.alerta_avaliar(text, jsonb, jsonb, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.alerta_avaliar(text, jsonb, jsonb, jsonb)', 'execute') then
    raise exception 'T1 FALHOU: anon/authenticated executam alerta_avaliar';
  end if;
end $t$;
\echo 'T1 (esquema do parado): ok'

-- ---------- T2: abre uma ocorrência por OP, com os itens na fila ----------
select public.teste_regra_parado('Parado A');
do $t$
declare o public.alerta_ocorrencias; v_dados jsonb; v_res jsonb;
begin
  set local role service_role;
  v_res := public.teste_avaliar_parado(public.teste_mapa('Parado A',
             jsonb_build_array(public.teste_op_parada('PRT797', '8563', 150, 2))));
  reset role;
  if (select count(*) from public.alerta_ocorrencias oc join public.alerta_regras rg on rg.id = oc.regra_id
       where rg.nome = 'Parado A' and oc.estado in ('aberta', 'resolvida')) <> 1 then
    raise exception 'T2 FALHOU: esperava 1 ocorrencia viva';
  end if;
  o := public.teste_oc_parado('Parado A', 'PRT797/8563');
  if o.id is null or o.estado <> 'aberta' or o.pmo <> 'PRT797' or o.op <> '8563' or o.posto <> 'ALMOX'
     or o.valor_abertura <> 150 or o.amostras <> 2 then
    raise exception 'T2 FALHOU: ocorrencia %', row_to_json(o);
  end if;
  if public.teste_fila_parado('Parado A', 'alerta', '8563') <> 1 then
    raise exception 'T2 FALHOU: esperava 1 linha alerta, achei %',
      public.teste_fila_parado('Parado A', 'alerta', '8563');
  end if;
  select dados into v_dados from public.alerta_envios
   where dados->>'regra_nome' = 'Parado A' and tipo = 'alerta' and com_botao and ocorrencia_id = o.id;
  if v_dados is null then raise exception 'T2 FALHOU: linha alerta sem botao ou sem ocorrencia'; end if;
  if v_dados->>'regra_tipo' <> 'parado' or v_dados->>'pmo' <> 'PRT797' or v_dados->>'op' <> '8563'
     or v_dados->>'posto' <> 'ALMOX' or v_dados->>'janela_tipo' <> 'op'
     or v_dados->'limite_horas' <> '2'::jsonb or (v_dados->>'mais_antiga_min')::numeric <> 150
     or jsonb_typeof(v_dados->'itens') <> 'array' or jsonb_array_length(v_dados->'itens') <> 2
     or v_dados->'itens'->0->>'codigo' <> 'CX[1][10]8563-PRT797'
     or v_dados->'ops' <> '[{"pmo": "PRT797", "op": "8563"}]'::jsonb
     or v_dados->>'aberta_em' is null or v_dados->>'agora' is null then
    raise exception 'T2 FALHOU: dados %', v_dados;
  end if;
  if (v_res->>'avaliadas')::int <> 1 then
    raise exception 'T2 FALHOU: avaliadas = % (esperava 1, a OP)', v_res->>'avaliadas';
  end if;
end $t$;
\echo 'T2 (abre uma ocorrencia por OP, com os itens): ok'

-- ---------- T3: a mesma rodada de novo não manda nada ----------
do $t$
declare v_antes int; v_oc uuid;
begin
  v_antes := public.teste_fila_regra('Parado A');
  v_oc := (public.teste_oc_parado('Parado A', 'PRT797/8563')).id;
  set local role service_role;
  perform public.teste_avaliar_parado(public.teste_mapa('Parado A',
            jsonb_build_array(public.teste_op_parada('PRT797', '8563', 150, 2))));
  perform public.teste_avaliar_parado(public.teste_mapa('Parado A',
            jsonb_build_array(public.teste_op_parada('PRT797', '8563', 150, 2))));
  reset role;
  if public.teste_fila_regra('Parado A') <> v_antes then
    raise exception 'T3 FALHOU: % -> % linhas de fila', v_antes, public.teste_fila_regra('Parado A');
  end if;
  if (public.teste_oc_parado('Parado A', 'PRT797/8563')).id <> v_oc
     or (public.teste_oc_parado('Parado A', 'PRT797/8563')).estado <> 'aberta' then
    raise exception 'T3 FALHOU: a ocorrencia mudou';
  end if;
end $t$;
\echo 'T3 (idempotencia da rodada): ok'

-- ---------- T4: duas OPs, duas ocorrências ----------
do $t$
declare v_dados jsonb;
begin
  set local role service_role;
  perform public.teste_avaliar_parado(public.teste_mapa('Parado A', jsonb_build_array(
            public.teste_op_parada('PRT797', '8563', 155, 2),
            public.teste_op_parada('PRT797', '8564', 130, 1))));
  reset role;
  if (select count(*) from public.alerta_ocorrencias oc join public.alerta_regras rg on rg.id = oc.regra_id
       where rg.nome = 'Parado A' and oc.estado = 'aberta') <> 2 then
    raise exception 'T4 FALHOU: esperava 2 ocorrencias abertas';
  end if;
  if (public.teste_oc_parado('Parado A', 'PRT797/8564')).op is distinct from '8564' then
    raise exception 'T4 FALHOU: a ocorrencia da 8564 nao abriu';
  end if;
  if public.teste_fila_parado('Parado A', 'alerta', '8564') <> 1
     or public.teste_fila_parado('Parado A', 'alerta', '8563') <> 1 then
    raise exception 'T4 FALHOU: fila 8563=% 8564=%', public.teste_fila_parado('Parado A', 'alerta', '8563'),
      public.teste_fila_parado('Parado A', 'alerta', '8564');
  end if;
  select dados into v_dados from public.alerta_envios
   where dados->>'regra_nome' = 'Parado A' and tipo = 'alerta' and dados->>'op' = '8564';
  if jsonb_array_length(v_dados->'itens') <> 1
     or v_dados->'itens'->0->>'codigo' <> 'CX[1][10]8564-PRT797' then
    raise exception 'T4 FALHOU: itens da 8564 = %', v_dados->'itens';
  end if;
end $t$;
\echo 'T4 (uma ocorrencia por OP, cada uma com os proprios itens): ok'

-- ---------- T5: terceira caixa entra na mesma ocorrência, sem mensagem ----------
do $t$
declare v_antes int; o public.alerta_ocorrencias; v_id uuid;
begin
  v_antes := public.teste_fila_regra('Parado A');
  v_id := (public.teste_oc_parado('Parado A', 'PRT797/8563')).id;
  set local role service_role;
  perform public.teste_avaliar_parado(public.teste_mapa('Parado A', jsonb_build_array(
            public.teste_op_parada('PRT797', '8563', 160, 3),
            public.teste_op_parada('PRT797', '8564', 135, 1))));
  reset role;
  o := public.teste_oc_parado('Parado A', 'PRT797/8563');
  if o.id <> v_id or o.estado <> 'aberta' or o.amostras <> 3 or o.valor_ultimo <> 160
     or o.valor_abertura <> 150 then
    raise exception 'T5 FALHOU: ocorrencia %', row_to_json(o);
  end if;
  if public.teste_fila_regra('Parado A') <> v_antes then
    raise exception 'T5 FALHOU: item novo mandou mensagem (% -> %)', v_antes, public.teste_fila_regra('Parado A');
  end if;
end $t$;
\echo 'T5 (item novo entra na mesma ocorrencia, sem mensagem): ok'

-- ---------- T6: lembrete com a lista atualizada ----------
update public.alerta_regras set lembrete_min = 30 where nome = 'Parado A';
update public.alerta_ocorrencias set ultimo_envio_em = now() - interval '31 minutes'
 where id = (public.teste_oc_parado('Parado A', 'PRT797/8563')).id;
do $t$
declare v_dados jsonb;
begin
  set local role service_role;
  perform public.teste_avaliar_parado(public.teste_mapa('Parado A', jsonb_build_array(
            public.teste_op_parada('PRT797', '8563', 191, 3),
            public.teste_op_parada('PRT797', '8564', 166, 1))));
  reset role;
  if public.teste_fila_parado('Parado A', 'lembrete', '8563') <> 1 then
    raise exception 'T6 FALHOU: esperava 1 lembrete da 8563, achei %',
      public.teste_fila_parado('Parado A', 'lembrete', '8563');
  end if;
  if public.teste_fila_parado('Parado A', 'lembrete', '8564') <> 0 then
    raise exception 'T6 FALHOU: a 8564 (aviso recente) mandou lembrete';
  end if;
  select dados into v_dados from public.alerta_envios
   where dados->>'regra_nome' = 'Parado A' and tipo = 'lembrete' and dados->>'op' = '8563';
  if jsonb_array_length(v_dados->'itens') <> 3 or (v_dados->>'mais_antiga_min')::numeric <> 191 then
    raise exception 'T6 FALHOU: lembrete sem a lista atualizada: %', v_dados;
  end if;
end $t$;
update public.alerta_regras set lembrete_min = null where nome = 'Parado A';
\echo 'T6 (lembrete com a lista atualizada): ok'

-- ---------- T7: lista vazia normaliza ----------
do $t$
declare v_res jsonb; v_dados jsonb;
begin
  set local role service_role;
  v_res := public.teste_avaliar_parado(public.teste_mapa('Parado A', '[]'::jsonb));
  reset role;
  if (public.teste_oc_parado('Parado A', 'PRT797/8563')).estado <> 'normalizada'
     or (public.teste_oc_parado('Parado A', 'PRT797/8564')).estado <> 'normalizada' then
    raise exception 'T7 FALHOU: nao normalizou';
  end if;
  if public.teste_fila_parado('Parado A', 'normalizou', '8563') <> 1
     or public.teste_fila_parado('Parado A', 'normalizou', '8564') <> 1 then
    raise exception 'T7 FALHOU: esperava 1 normalizou por OP';
  end if;
  if jsonb_array_length(v_res->'normalizadas') <> 2 then
    raise exception 'T7 FALHOU: normalizadas = %', v_res->'normalizadas';
  end if;
  select dados into v_dados from public.alerta_envios
   where dados->>'regra_nome' = 'Parado A' and tipo = 'normalizou' and dados->>'op' = '8563';
  if v_dados->'itens' <> '[]'::jsonb or v_dados->>'pmo' <> 'PRT797' then
    raise exception 'T7 FALHOU: dados da normalizacao %', v_dados;
  end if;
end $t$;
\echo 'T7 (lista vazia normaliza): ok'

-- ---------- T8: regra ausente do mapa é pulada ----------
do $t$
declare v_antes int; v_id uuid;
begin
  set local role service_role;
  perform public.teste_avaliar_parado(public.teste_mapa('Parado A',
            jsonb_build_array(public.teste_op_parada('PRT797', '8563', 200, 3))));
  reset role;
  v_id := (public.teste_oc_parado('Parado A', 'PRT797/8563')).id;
  if (public.teste_oc_parado('Parado A', 'PRT797/8563')).estado <> 'aberta' then
    raise exception 'T8 FALHOU: a ocorrencia nao reabriu como nova';
  end if;
  v_antes := public.teste_fila_regra('Parado A');
  set local role service_role;
  perform public.teste_avaliar_parado(null);                                   -- app antigo / sem leitura
  perform public.teste_avaliar_parado('{}'::jsonb);                            -- mapa sem a regra
  perform public.teste_avaliar_parado(jsonb_build_object(gen_random_uuid()::text, '[]'::jsonb));
  perform public.teste_avaliar_parado(public.teste_mapa('Parado A', 'null'::jsonb));  -- não é lista
  perform public.teste_avaliar_parado(public.teste_mapa('Parado A', '{}'::jsonb));    -- não é lista
  reset role;
  if (public.teste_oc_parado('Parado A', 'PRT797/8563')).estado <> 'aberta'
     or (public.teste_oc_parado('Parado A', 'PRT797/8563')).id <> v_id then
    raise exception 'T8 FALHOU: regra fora do mapa mexeu na ocorrencia (%)',
      (public.teste_oc_parado('Parado A', 'PRT797/8563')).estado;
  end if;
  if public.teste_fila_regra('Parado A') <> v_antes then
    raise exception 'T8 FALHOU: regra fora do mapa enfileirou';
  end if;
end $t$;
\echo 'T8 (regra ausente do mapa e pulada): ok'

-- ---------- T9: resolvida fica resolvida na carência; depois reabre ----------
do $t$
declare v_oc uuid; v_alertas int; v_dados jsonb;
begin
  v_oc := (public.teste_oc_parado('Parado A', 'PRT797/8563')).id;
  -- Interna (sem grant): quem a chama em produção são as funções do botão. Aqui, como dona.
  perform public.alerta_resolver_interno(v_oc, '00000000-0000-0000-0000-0000000000c1', true);
  if (select estado from public.alerta_ocorrencias where id = v_oc) <> 'resolvida' then
    raise exception 'T9 FALHOU: nao resolveu';
  end if;
  v_alertas := public.teste_fila_parado('Parado A', 'alerta', '8563');

  set local role service_role;
  perform public.teste_avaliar_parado(public.teste_mapa('Parado A',
            jsonb_build_array(public.teste_op_parada('PRT797', '8563', 210, 3))));
  reset role;
  if (select estado from public.alerta_ocorrencias where id = v_oc) <> 'resolvida'
     or public.teste_fila_parado('Parado A', 'alerta', '8563') <> v_alertas then
    raise exception 'T9 FALHOU: reabriu dentro da carencia';
  end if;

  update public.alerta_ocorrencias set resolvida_em = now() - interval '61 minutes' where id = v_oc;
  set local role service_role;
  perform public.teste_avaliar_parado(public.teste_mapa('Parado A',
            jsonb_build_array(public.teste_op_parada('PRT797', '8563', 271, 3))));
  reset role;
  if (select estado from public.alerta_ocorrencias where id = v_oc) <> 'aberta'
     or public.teste_fila_parado('Parado A', 'alerta', '8563') <> v_alertas + 1 then
    raise exception 'T9 FALHOU: nao reabriu depois da carencia';
  end if;
  select dados into v_dados from public.alerta_envios
   where ocorrencia_id = v_oc and tipo = 'alerta' and (dados->>'reabertura')::boolean;
  if v_dados is null or jsonb_array_length(v_dados->'itens') <> 3
     or v_dados->>'resolvida_por_nome' <> 'Carla ShopFloor' then
    raise exception 'T9 FALHOU: dados da reabertura %', v_dados;
  end if;
end $t$;
\echo 'T9 (resolvida + reabertura depois da carencia): ok'

-- ---------- T10: posto fora da regra é ignorado ----------
do $t$
begin
  set local role service_role;
  perform public.teste_avaliar_parado(public.teste_mapa('Parado A', jsonb_build_array(
            public.teste_op_parada('PRT797', '8563', 280, 3),
            public.teste_op_parada('PRT797', '8570', 500, 2, 'OUTRO ALMOX'))));
  reset role;
  if exists (select 1 from public.alerta_ocorrencias where defeito = 'PRT797/8570') then
    raise exception 'T10 FALHOU: posto fora da regra abriu ocorrencia';
  end if;
  if public.teste_fila_parado('Parado A', 'alerta', '8570') <> 0 then
    raise exception 'T10 FALHOU: posto fora da regra enfileirou';
  end if;
  if (public.teste_oc_parado('Parado A', 'PRT797/8563')).estado <> 'aberta' then
    raise exception 'T10 FALHOU: a OP do posto certo saiu do caminho';
  end if;
end $t$;
\echo 'T10 (posto fora da regra e ignorado): ok'

-- ---------- T11: os outros tipos seguem na mesma rodada ----------
insert into public.alerta_regras
  (nome, tipo, modulo, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
   canais, destinatarios, ativa, criado_por)
values ('Aprov junto do parado', 'aprovacao', 'shopfloor', array['TesteParado'], 90, 'tempo', 60, 5,
        array['telegram'], array['00000000-0000-0000-0000-0000000000c1']::uuid[], true,
        '00000000-0000-0000-0000-000000000001');
insert into public.sf_registros (data_hora, posto, pmo, op, status)
select now() - interval '1 minute', 'TesteParado', 'PMOP', '7000', 'reprovado'
  from generate_series(1, 10);
do $t$
declare v_res jsonb;
begin
  set local role service_role;
  v_res := public.teste_avaliar_parado(public.teste_mapa('Parado A',
             jsonb_build_array(public.teste_op_parada('PRT797', '8563', 285, 3))));
  reset role;
  if (v_res->>'avaliadas')::int < 2 then
    raise exception 'T11 FALHOU: avaliadas = % (esperava a OP parada + o posto da aprovacao)',
      v_res->>'avaliadas';
  end if;
  if not exists (select 1 from public.alerta_ocorrencias oc join public.alerta_regras rg on rg.id = oc.regra_id
                  where rg.nome = 'Aprov junto do parado' and oc.estado = 'aberta') then
    raise exception 'T11 FALHOU: a regra de aprovacao nao abriu na mesma rodada';
  end if;
end $t$;
update public.alerta_regras set ativa = false where nome = 'Aprov junto do parado';
\echo 'T11 (os outros tipos seguem): ok'

-- ---------- T12: regra desativada encerra a ocorrência viva, sem envio ----------
do $t$
declare v_antes int; v_oc uuid;
begin
  v_oc := (public.teste_oc_parado('Parado A', 'PRT797/8563')).id;
  v_antes := public.teste_fila_regra('Parado A');
  update public.alerta_regras set ativa = false where nome = 'Parado A';
  set local role service_role;
  perform public.teste_avaliar_parado(public.teste_mapa('Parado A',
            jsonb_build_array(public.teste_op_parada('PRT797', '8563', 290, 3))));
  reset role;
  if (select estado from public.alerta_ocorrencias where id = v_oc) <> 'normalizada' then
    raise exception 'T12 FALHOU: regra desativada deixou a ocorrencia viva';
  end if;
  if public.teste_fila_regra('Parado A') <> v_antes then
    raise exception 'T12 FALHOU: encerrar por desativacao enfileirou';
  end if;
end $t$;
\echo 'T12 (regra desativada encerra sem envio): ok'

-- ---------- T13: o app antigo continua chamando ----------
do $t$
declare v jsonb;
begin
  set local role service_role;
  v := public.alerta_avaliar(p_canal_discord => null, p_blocos => null, p_resumos => null);
  if (v->>'ocupado')::boolean is distinct from false then raise exception 'T13 FALHOU: %', v; end if;
  v := public.alerta_avaliar(null, null, null);
  v := public.alerta_avaliar();
  reset role;
end $t$;
\echo 'T13 (3 parametros nomeados, posicionais e nenhum: sem ambiguidade): ok'

drop function public.teste_regra_parado(text, text[]);
drop function public.teste_op_parada(text, text, numeric, int, text);
drop function public.teste_mapa(text, jsonb);
drop function public.teste_fila_parado(text, text, text);
drop function public.teste_fila_regra(text);
drop function public.teste_oc_parado(text, text);
drop function public.teste_avaliar_parado(jsonb);
\echo '0167 (parado no Almoxarifado): ok'
