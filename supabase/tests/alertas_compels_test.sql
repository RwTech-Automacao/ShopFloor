-- Testes SQL da 0170 (tipo de regra 'compels': problemas no envio ao Compels). Rodar com
-- supabase/tests/rodar-alertas-test.sh, na mesma base, DEPOIS da 0167, com o esquema mínimo da fila
-- (alertas_compels_esquema.sql) e a 0170 aplicada duas vezes.
--
-- ⚠️ POR QUE ESTE ARQUIVO EXISTE: a 0170 recria o alerta_avaliar (roda de 5 em 5 min em produção) com
-- dois ramos novos. Os defeitos caros são SQL puro: inundar o responsável com o que NÃO é problema
-- (OP ainda não liberada, estorno manual, linha cancelada), manter ocorrência aberta para sempre por um
-- aviso permanente, ou avisar duas vezes o mesmo aviso.
--
-- O mapa dos testes:
--   T1  esquema: tipo aceito; limite_horas, janela e posto vazio recusados; UMA alerta_avaliar de 4
--       parâmetros; grants da função de leitura; BACKFILL das frases de espera esperada;
--   T2  ⚠️ NA PRIMEIRA FALHA: uma ocorrência (defeito = 'PMO/OP') e uma 'alerta' com o motivo e a OP;
--   T3  a mesma rodada de novo: nada novo;
--   T4  motivos AGRUPADOS por texto (3 linhas iguais = 1 item com linhas = 3 e peças somadas);
--   T5  ⚠️ armadilha 1: erro_esperado (OP não liberada / não configurada) NÃO abre nada, e as linhas
--       legadas do backfill também não;
--   T6  ⚠️ armadilha 2: estorno pendente NÃO abre nada;
--   T7  ⚠️ armadilha 3: linha cancelada NÃO abre nada;
--   T8  linha nunca tentada (sem erro) e linha enviada sem aviso NÃO abrem nada;
--   T9  lembrete só depois de lembrete_min; item novo entra na MESMA ocorrência, sem mensagem;
--   T10 desistiu (tentativas >= 5) vai marcado;
--   T11 resolve sozinha: erro some -> 'normalizou' (uma); outra OP segue aberta;
--   T12 posto fora da regra e PMO fora do filtro são ignorados;
--   T13 ⚠️ armadilha 4: aviso de linha ENVIADA = mensagem única, sem ocorrência; a mesma rodada de
--       novo não repete; antes do criado_em da regra, mais velho que 3 dias, aviso em branco, estorno
--       e posto fora NÃO avisam; mensagem sem botão;
--   T14 aviso sem ninguém alcançável NÃO grava a marca (avisa depois, quando alguém tiver conta);
--   T15 regra desativada encerra a ocorrência sem envio;
--   T16 os outros tipos seguem avaliando (chamada sem argumentos, como o app antigo).
-- (A idempotência da 0170 é do runner: ela é aplicada duas vezes.)

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.administrar,recebimento.administrar', false);

update public.alerta_regras set ativa = false where ativa;
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;

-- ---------- helpers ----------
create function public.teste_regra_compels(p_nome text, p_postos text[] default array['ALMOX'],
                                           p_pmos text[] default null,
                                           p_dest uuid[] default array['00000000-0000-0000-0000-0000000000c1']::uuid[])
returns uuid language sql as $f$
  insert into public.alerta_regras
    (nome, tipo, modulo, postos, pmos, janela_tipo, janela_valor, minimo_bipes, lembrete_min, canais,
     destinatarios, avisar_pessoas, avisar_canal, ativa, criado_por)
  values (p_nome, 'compels', 'shopfloor', p_postos, coalesce(p_pmos, '{}'::text[]), 'op', null, null, 60, array['telegram'],
          p_dest, true, false, true, '00000000-0000-0000-0000-000000000001')
  returning id
$f$;

-- Uma linha da fila. p_erro nulo = sem erro; p_ok = enviada.
create function public.teste_envio(p_op text, p_erro text, p_ok boolean default false,
                                   p_aviso text default null, p_pmo text default 'PMOC',
                                   p_posto text default 'ALMOX', p_operacao text default 'entrada',
                                   p_qtd int default 1, p_tent int default 1,
                                   p_esperado boolean default false)
returns uuid language sql as $f$
  insert into public.sf_estoque_envios
    (pmo, op, posto, operacao, quantidade, ok, erro, aviso, tentativas, enviado_em, erro_esperado)
  values (p_pmo, p_op, p_posto, p_operacao, p_qtd, p_ok, p_erro, p_aviso, p_tent,
          case when p_ok then now() end, p_esperado)
  returning id
$f$;

create function public.teste_avaliar_compels() returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  v := public.alerta_avaliar();
  if (v->>'ocupado')::boolean then raise exception 'avaliacao ocupada'; end if;
  return v;
end $f$;

create function public.teste_fila_compels(p_regra text, p_tipo text default null) returns int
language sql as $f$
  select count(*)::int from public.alerta_envios
   where dados->>'regra_nome' = p_regra and (p_tipo is null or tipo = p_tipo)
$f$;

create function public.teste_oc_compels(p_regra text, p_chave text) returns public.alerta_ocorrencias
language sql as $f$
  select oc.* from public.alerta_ocorrencias oc
    join public.alerta_regras rg on rg.id = oc.regra_id
   where rg.nome = p_regra and oc.defeito = p_chave
   order by oc.aberta_em desc, oc.id
   limit 1
$f$;

-- ---------- T1: esquema ----------
do $t$
declare v_id uuid; v_n int;
begin
  v_id := public.teste_regra_compels('Compels esquema');
  delete from public.alerta_regras where id = v_id;

  -- limite_horas é do parado: no compels é recusado.
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, janela_tipo, minimo_bipes, limite_horas, canais, destinatarios, ativa, criado_por)
    values ('Compels 2h', 'compels', 'shopfloor', array['ALMOX'], 'op', null, 2, array['telegram'],
            array['00000000-0000-0000-0000-0000000000c1']::uuid[], true,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'T1 FALHOU: limite_horas aceito no compels';
  exception when check_violation then null;
  end;
  -- janela diferente de 'op' recusada.
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, janela_tipo, janela_valor, minimo_bipes, canais, destinatarios, ativa, criado_por)
    values ('Compels janela', 'compels', 'shopfloor', array['ALMOX'], 'tempo', 60, null, array['telegram'],
            array['00000000-0000-0000-0000-0000000000c1']::uuid[], true,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'T1 FALHOU: janela tempo aceita no compels';
  exception when check_violation then null;
  end;
  -- posto vazio recusado.
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, janela_tipo, minimo_bipes, canais, destinatarios, ativa, criado_por)
    values ('Compels sem posto', 'compels', 'shopfloor', array[]::text[], 'op', null, array['telegram'],
            array['00000000-0000-0000-0000-0000000000c1']::uuid[], true,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'T1 FALHOU: compels sem posto aceito';
  exception when check_violation then null;
  end;
  -- no Recebimento não existe.
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, janela_tipo, minimo_bipes, canais, destinatarios, ativa, criado_por)
    values ('Compels rec', 'compels', 'recebimento', array['ALMOX'], 'op', null, array['telegram'],
            array['00000000-0000-0000-0000-0000000000c1']::uuid[], true,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'T1 FALHOU: compels aceito no recebimento';
  exception when check_violation then null;
  end;

  -- UMA alerta_avaliar (a de 4 parâmetros): nada de sobrecarga ambígua.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'alerta_avaliar';
  if v_n <> 1 then raise exception 'T1 FALHOU: % sobrecargas de alerta_avaliar', v_n; end if;

  -- A função de leitura é só do serviço.
  if has_function_privilege('anon', 'public.alerta_compels_problemas(text[], text[])', 'execute')
     or has_function_privilege('authenticated', 'public.alerta_compels_problemas(text[], text[])', 'execute') then
    raise exception 'T1 FALHOU: alerta_compels_problemas exposta a anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.alerta_compels_problemas(text[], text[])', 'execute') then
    raise exception 'T1 FALHOU: service_role sem execute';
  end if;

  -- BACKFILL: as três frases de espera esperada foram marcadas; a falha de verdade não.
  select count(*) into v_n from public.sf_estoque_envios where pmo = 'PMOLEG' and erro_esperado;
  if v_n <> 3 then raise exception 'T1 FALHOU: backfill marcou % linhas legadas (esperava 3)', v_n; end if;
  select count(*) into v_n from public.sf_estoque_envios where pmo = 'PMOLEG' and op = 'LEG4' and not erro_esperado;
  if v_n <> 1 then raise exception 'T1 FALHOU: o backfill marcou a falha de verdade'; end if;
end $t$;
select 'T1 (esquema, grants, backfill): ok';

-- ---------- T2: na primeira falha ----------
select public.teste_regra_compels('Compels A');
-- A linha legada LEG4 ('Aguardando requisição…', não marcada) é problema de verdade e abre também.
select public.teste_envio('8001', 'Aguardando requisição no Compels: falta empenho do componente X');
do $t$
declare v jsonb; oc public.alerta_ocorrencias; v_n int; d jsonb;
begin
  v := public.teste_avaliar_compels();
  oc := public.teste_oc_compels('Compels A', 'PMOC/8001');
  if oc.id is null or oc.estado <> 'aberta' then raise exception 'T2 FALHOU: ocorrência da 8001 não abriu'; end if;
  if oc.pmo <> 'PMOC' or oc.op <> '8001' or oc.posto <> 'ALMOX' then
    raise exception 'T2 FALHOU: ocorrência com pmo/op/posto errados: %', to_jsonb(oc);
  end if;
  select count(*) into v_n from public.alerta_envios where ocorrencia_id = oc.id and tipo = 'alerta';
  if v_n <> 1 then raise exception 'T2 FALHOU: % linhas alerta (esperava 1)', v_n; end if;
  select e.dados into d from public.alerta_envios e where e.ocorrencia_id = oc.id and e.tipo = 'alerta';
  if d->>'regra_tipo' <> 'compels' or d->>'op' <> '8001' or d->>'pmo' <> 'PMOC' then
    raise exception 'T2 FALHOU: dados sem tipo/OP: %', d;
  end if;
  if d->'itens'->0->>'motivo' <> 'Aguardando requisição no Compels: falta empenho do componente X'
     or (d->'itens'->0->>'linhas')::int <> 1 or (d->'itens'->0->>'desistiu')::boolean then
    raise exception 'T2 FALHOU: itens errados: %', d->'itens';
  end if;
  if (d->>'linhas')::int <> 1 then raise exception 'T2 FALHOU: linhas = %', d->>'linhas'; end if;
  if not exists (select 1 from public.alerta_envios e where e.ocorrencia_id = oc.id and e.com_botao) then
    raise exception 'T2 FALHOU: a ocorrência não tem botão Resolvido';
  end if;
  -- A LEG4 (legada, falha real) também abriu.
  if (public.teste_oc_compels('Compels A', 'PMOLEG/LEG4')).id is null then
    raise exception 'T2 FALHOU: a falha real legada não abriu';
  end if;
end $t$;
select 'T2 (primeira falha abre, com motivo e OP): ok';

-- ---------- T3: idempotência da rodada ----------
do $t$
declare antes int; depois int;
begin
  select count(*) into antes from public.alerta_envios where dados->>'regra_nome' = 'Compels A';
  perform public.teste_avaliar_compels();
  select count(*) into depois from public.alerta_envios where dados->>'regra_nome' = 'Compels A';
  if antes <> depois then raise exception 'T3 FALHOU: a mesma rodada enfileirou % linhas novas', depois - antes; end if;
end $t$;
select 'T3 (mesma rodada: nada novo): ok';

-- ---------- T4: motivos agrupados ----------
select public.teste_envio('8002', 'ERP fora do ar', false, null, 'PMOC', 'ALMOX', 'entrada', 10);
select public.teste_envio('8002', 'ERP fora do ar', false, null, 'PMOC', 'ALMOX', 'entrada', 5);
select public.teste_envio('8002', 'ERP fora do ar', false, null, 'PMOC', 'ALMOX', 'entrada', 1);
select public.teste_envio('8002', 'Saldo de componente insuficiente');
do $t$
declare d jsonb; oc public.alerta_ocorrencias;
begin
  perform public.teste_avaliar_compels();
  oc := public.teste_oc_compels('Compels A', 'PMOC/8002');
  select e.dados into d from public.alerta_envios e where e.ocorrencia_id = oc.id and e.tipo = 'alerta';
  if jsonb_array_length(d->'itens') <> 2 then raise exception 'T4 FALHOU: % itens (esperava 2)', jsonb_array_length(d->'itens'); end if;
  if d->'itens'->0->>'motivo' <> 'ERP fora do ar' or (d->'itens'->0->>'linhas')::int <> 3
     or (d->'itens'->0->>'pecas')::int <> 16 then
    raise exception 'T4 FALHOU: agrupamento errado: %', d->'itens';
  end if;
  if (d->>'linhas')::int <> 4 then raise exception 'T4 FALHOU: total de linhas = %', d->>'linhas'; end if;
end $t$;
select 'T4 (motivos agrupados por texto): ok';

-- ---------- T5/T6/T7/T8: o que NÃO é problema ----------
select public.teste_envio('8101', 'OP 8101 ainda não está liberada para a integração com o Compels. Faça a entrada à mão no ERP, ou libere a OP.', false, null, 'PMOC', 'ALMOX', 'entrada', 1, 0, true);
select public.teste_envio('8102', 'Integração com o Compels não configurada neste ambiente. x', false, null, 'PMOC', 'ALMOX', 'entrada', 1, 0, true);
select public.teste_envio('8103', 'O estorno no Compels ainda é manual: estorne tudo', false, null, 'PMOC', 'ALMOX', 'estorno');
select public.teste_envio('8103', 'erro qualquer de estorno', false, null, 'PMOC', 'ALMOX', 'estorno');
do $t$
declare id1 uuid;
begin
  id1 := public.teste_envio('8104', 'Aguardando requisição…');
  update public.sf_estoque_envios set cancelado_em = now() where id = id1;       -- cancelada
  perform public.teste_envio('8105', null);                                       -- nunca tentada (sem erro)
  perform public.teste_envio('8106', null, true);                                 -- enviada sem aviso
  perform public.teste_envio('8107', '   ');                                      -- erro só de espaços
end $t$;
do $t$
declare v_op text; v_n int;
begin
  perform public.teste_avaliar_compels();
  foreach v_op in array array['8101','8102','8103','8104','8105','8106','8107'] loop
    select count(*) into v_n from public.alerta_ocorrencias oc join public.alerta_regras rg on rg.id = oc.regra_id
     where rg.nome = 'Compels A' and oc.op = v_op;
    if v_n <> 0 then raise exception 'T5-8 FALHOU: a OP % abriu ocorrência (nao e problema)', v_op; end if;
  end loop;
  -- as linhas legadas marcadas pelo backfill também não abriram
  select count(*) into v_n from public.alerta_ocorrencias oc join public.alerta_regras rg on rg.id = oc.regra_id
   where rg.nome = 'Compels A' and oc.op in ('LEG1', 'LEG2', 'LEG3');
  if v_n <> 0 then raise exception 'T5 FALHOU: linha legada de espera esperada abriu ocorrência'; end if;
  -- só as duas OPs de verdade (8001, 8002) + a legada real LEG4
  select count(*) into v_n from public.alerta_ocorrencias oc join public.alerta_regras rg on rg.id = oc.regra_id
   where rg.nome = 'Compels A';
  if v_n <> 3 then raise exception 'T5-8 FALHOU: % ocorrências (esperava 3)', v_n; end if;
end $t$;
select 'T5-T8 (OP nao liberada, nao configurada, estorno, cancelada, sem erro, enviada: nada): ok';

-- ---------- T9: lembrete e item novo ----------
do $t$
declare v_antes int; v_depois int;
begin
  -- item novo na 8001 entra na MESMA ocorrência, sem mensagem
  perform public.teste_envio('8001', 'Outro motivo');
  select count(*) into v_antes from public.alerta_envios where dados->>'regra_nome' = 'Compels A';
  perform public.teste_avaliar_compels();
  select count(*) into v_depois from public.alerta_envios where dados->>'regra_nome' = 'Compels A';
  if v_antes <> v_depois then raise exception 'T9 FALHOU: item novo gerou mensagem (% -> %)', v_antes, v_depois; end if;
  if (select count(*) from public.alerta_ocorrencias oc join public.alerta_regras rg on rg.id = oc.regra_id
       where rg.nome = 'Compels A' and oc.op = '8001' and oc.estado in ('aberta','resolvida')) <> 1 then
    raise exception 'T9 FALHOU: mais de uma ocorrência viva da 8001';
  end if;
  -- lembrete: só depois do lembrete_min (60)
  update public.alerta_ocorrencias set ultimo_envio_em = now() - interval '59 minutes'
   where id = (public.teste_oc_compels('Compels A', 'PMOC/8001')).id;
  perform public.teste_avaliar_compels();
  if public.teste_fila_compels('Compels A', 'lembrete') <> 0 then raise exception 'T9 FALHOU: lembrete antes da hora'; end if;
  update public.alerta_ocorrencias set ultimo_envio_em = now() - interval '61 minutes'
   where id = (public.teste_oc_compels('Compels A', 'PMOC/8001')).id;
  perform public.teste_avaliar_compels();
  if (select count(*) from public.alerta_envios e
        where e.dados->>'regra_nome' = 'Compels A' and e.tipo = 'lembrete' and e.dados->>'op' = '8001') <> 1 then
    raise exception 'T9 FALHOU: o lembrete de 61 min não saiu (ou saiu mais de um)';
  end if;
  -- e o lembrete leva a lista ATUALIZADA (2 motivos)
  if (select jsonb_array_length(e.dados->'itens') from public.alerta_envios e
       where e.tipo = 'lembrete' and e.dados->>'op' = '8001') <> 2 then
    raise exception 'T9 FALHOU: lembrete sem a lista atualizada';
  end if;
end $t$;
select 'T9 (item novo sem mensagem, lembrete na hora): ok';

-- ---------- T10: desistiu ----------
select public.teste_envio('8003', 'Erro que persistiu', false, null, 'PMOC', 'ALMOX', 'entrada', 1, 5);
do $t$
declare d jsonb;
begin
  perform public.teste_avaliar_compels();
  select e.dados into d from public.alerta_envios e where e.tipo = 'alerta' and e.dados->>'op' = '8003' and e.dados->>'regra_nome' = 'Compels A';
  if not (d->'itens'->0->>'desistiu')::boolean then raise exception 'T10 FALHOU: desistiu não marcado: %', d; end if;
end $t$;
select 'T10 (desistiu marcado): ok';

-- ---------- T11: resolve sozinha ----------
do $t$
declare v_antes int; oc public.alerta_ocorrencias;
begin
  -- a 8003 é enviada com sucesso: a linha deixa de ter problema
  update public.sf_estoque_envios set ok = true, enviado_em = now(), erro = null where op = '8003';
  perform public.teste_avaliar_compels();
  oc := public.teste_oc_compels('Compels A', 'PMOC/8003');
  if oc.estado <> 'normalizada' then raise exception 'T11 FALHOU: 8003 não normalizou (%).', oc.estado; end if;
  if (select count(*) from public.alerta_envios e where e.ocorrencia_id = oc.id and e.tipo = 'normalizou') <> 1 then
    raise exception 'T11 FALHOU: mensagem de normalização ausente ou repetida';
  end if;
  -- outra rodada: não repete
  v_antes := public.teste_fila_compels('Compels A');
  perform public.teste_avaliar_compels();
  if public.teste_fila_compels('Compels A') <> v_antes then raise exception 'T11 FALHOU: normalização repetida'; end if;
  -- a 8002 segue aberta
  if (public.teste_oc_compels('Compels A', 'PMOC/8002')).estado <> 'aberta' then raise exception 'T11 FALHOU: 8002 fechou por engano'; end if;
end $t$;
select 'T11 (normaliza sozinha, uma OP por vez): ok';

-- ---------- T12: posto fora da regra e filtro de PMO ----------
select public.teste_regra_compels('Compels PMO', array['ALMOX'], array['PMOZ']);
select public.teste_envio('8201', 'erro em PMOZ', false, null, 'PMOZ');
select public.teste_envio('8202', 'erro em PMOC fora do filtro', false, null, 'PMOC');
select public.teste_envio('8203', 'erro em outro posto', false, null, 'PMOZ', 'OUTRO');
do $t$
begin
  perform public.teste_avaliar_compels();
  if (public.teste_oc_compels('Compels PMO', 'PMOZ/8201')).id is null then raise exception 'T12 FALHOU: filtro de PMO não abriu a PMOZ'; end if;
  if (public.teste_oc_compels('Compels PMO', 'PMOC/8202')).id is not null then raise exception 'T12 FALHOU: PMO fora do filtro abriu'; end if;
  if (public.teste_oc_compels('Compels PMO', 'PMOZ/8203')).id is not null then raise exception 'T12 FALHOU: posto fora da regra abriu'; end if;
  if (public.teste_oc_compels('Compels A', 'PMOZ/8203')).id is not null then raise exception 'T12 FALHOU: posto OUTRO abriu na regra A'; end if;
end $t$;
select 'T12 (posto e PMO fora do escopo ignorados): ok';

-- ---------- T13: avisos de gravação ----------
-- A regra nasce AGORA: o piso do aviso é o criado_em dela.
select public.teste_regra_compels('Compels aviso', array['ALMOX'], array['PMOA']);
do $t$
declare v_id uuid;
begin
  -- 1) aviso novo (enviado agora): avisa
  perform public.teste_envio('8301', null, true, 'quantidade inesperada no Compels: apontado 40, esperado 30', 'PMOA');
  -- 2) mais velho que o piso e que o teto
  v_id := public.teste_envio('8302', null, true, 'aviso antigo', 'PMOA');
  update public.sf_estoque_envios set enviado_em = now() - interval '5 days' where id = v_id;
  -- 3) aviso em branco
  perform public.teste_envio('8303', null, true, '   ', 'PMOA');
  -- 4) estorno com aviso
  perform public.teste_envio('8304', null, true, 'aviso de estorno', 'PMOA', 'ALMOX', 'estorno');
  -- 5) posto fora
  perform public.teste_envio('8305', null, true, 'aviso em outro posto', 'PMOA', 'OUTRO');
  -- 6) enviado ANTES de a regra existir (dentro do teto, mas antes do piso)
  v_id := public.teste_envio('8306', null, true, 'aviso de antes da regra', 'PMOA');
  update public.sf_estoque_envios set enviado_em = (select criado_em from public.alerta_regras where nome = 'Compels aviso') - interval '1 hour'
   where id = v_id;
end $t$;
do $t$
declare d jsonb; v_antes int;
begin
  perform public.teste_avaliar_compels();
  if public.teste_fila_compels('Compels aviso', 'compels_aviso') <> 1 then
    raise exception 'T13 FALHOU: % mensagens de aviso (esperava 1)', public.teste_fila_compels('Compels aviso', 'compels_aviso');
  end if;
  select e.dados into d from public.alerta_envios e where e.dados->>'regra_nome' = 'Compels aviso' and e.tipo = 'compels_aviso';
  if jsonb_array_length(d->'avisos') <> 1 or d->'avisos'->0->>'op' <> '8301'
     or d->'avisos'->0->>'aviso' not like 'quantidade inesperada%' or (d->'avisos'->0->>'quantidade')::int <> 1 then
    raise exception 'T13 FALHOU: aviso errado: %', d;
  end if;
  if exists (select 1 from public.alerta_envios e where e.dados->>'regra_nome' = 'Compels aviso' and e.tipo = 'compels_aviso' and (e.com_botao or e.ocorrencia_id is not null)) then
    raise exception 'T13 FALHOU: o aviso nasceu com botão ou ocorrência';
  end if;
  -- aviso de gravação NÃO abre ocorrência
  if exists (select 1 from public.alerta_ocorrencias oc join public.alerta_regras rg on rg.id = oc.regra_id where rg.nome = 'Compels aviso') then
    raise exception 'T13 FALHOU: aviso de gravação abriu ocorrência';
  end if;
  -- a marca foi gravada
  if (select count(*) from public.alerta_compels_avisados a join public.alerta_regras rg on rg.id = a.regra_id where rg.nome = 'Compels aviso') <> 1 then
    raise exception 'T13 FALHOU: marca de já avisei ausente';
  end if;
  -- de novo: nada
  v_antes := public.teste_fila_compels('Compels aviso');
  perform public.teste_avaliar_compels();
  perform public.teste_avaliar_compels();
  if public.teste_fila_compels('Compels aviso') <> v_antes then raise exception 'T13 FALHOU: o aviso saiu duas vezes'; end if;
  -- aviso novo depois: sai de novo (só ele)
  perform public.teste_envio('8307', null, true, 'empenho insuficiente', 'PMOA');
  perform public.teste_avaliar_compels();
  if public.teste_fila_compels('Compels aviso', 'compels_aviso') <> 2 then raise exception 'T13 FALHOU: o aviso novo não saiu'; end if;
  -- cada aviso saiu numa mensagem só dele: a do 8307 não leva o 8301 de volta
  select e.dados into d from public.alerta_envios e
   where e.dados->>'regra_nome' = 'Compels aviso' and e.tipo = 'compels_aviso' and e.dados->'avisos'->0->>'op' = '8307';
  if d is null or jsonb_array_length(d->'avisos') <> 1 then raise exception 'T13 FALHOU: reenviou aviso velho junto: %', d; end if;
  if (select count(*) from public.alerta_envios e
       where e.dados->>'regra_nome' = 'Compels aviso' and e.tipo = 'compels_aviso' and e.dados->'avisos'->0->>'op' = '8301') <> 1 then
    raise exception 'T13 FALHOU: o aviso da 8301 saiu mais de uma vez';
  end if;
end $t$;
select 'T13 (aviso de gravacao: unico, sem botao, sem ocorrencia, com piso e teto): ok';

-- ---------- T14: ninguém alcançável não grava a marca ----------
select public.teste_regra_compels('Compels sem ninguem', array['ALMOX'], array['PMOQ'],
                                  array['00000000-0000-0000-0000-0000000000dd']::uuid[]);
select public.teste_envio('8401', null, true, 'aviso sem destinatario', 'PMOQ');
do $t$
begin
  perform public.teste_avaliar_compels();
  if public.teste_fila_compels('Compels sem ninguem') <> 0 then raise exception 'T14 FALHOU: enfileirou sem destinatário alcançável'; end if;
  if exists (select 1 from public.alerta_compels_avisados a join public.alerta_regras rg on rg.id = a.regra_id where rg.nome = 'Compels sem ninguem') then
    raise exception 'T14 FALHOU: gravou a marca sem enviar';
  end if;
end $t$;
select 'T14 (sem ninguem alcancavel: sem marca): ok';

-- ---------- T15: regra desativada encerra sem envio ----------
do $t$
declare v_antes int;
begin
  v_antes := public.teste_fila_compels('Compels A');
  update public.alerta_regras set ativa = false where nome = 'Compels A';
  perform public.teste_avaliar_compels();
  if (public.teste_oc_compels('Compels A', 'PMOC/8002')).estado <> 'normalizada' then raise exception 'T15 FALHOU: não encerrou'; end if;
  if public.teste_fila_compels('Compels A') <> v_antes then raise exception 'T15 FALHOU: encerrar enviou mensagem'; end if;
end $t$;
select 'T15 (desativada encerra sem envio): ok';

-- ---------- T16: o app antigo (sem argumentos) e os outros tipos ----------
do $t$
declare v jsonb;
begin
  v := public.alerta_avaliar();
  if v->>'ocupado' <> 'false' then raise exception 'T16 FALHOU: %', v; end if;
  v := public.alerta_avaliar(p_canal_discord => null, p_blocos => null, p_resumos => null);
  if v->>'ocupado' <> 'false' then raise exception 'T16 FALHOU (3 nomeados): %', v; end if;
end $t$;
select 'T16 (chamadas antigas sem ambiguidade): ok';
