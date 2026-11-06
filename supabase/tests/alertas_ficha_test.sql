-- Testes SQL da 0173 (tipo de regra 'ficha': ficha de apontamento quando uma caixa ou um lote vira necessidade
-- no Almoxarifado). Rodar com supabase/tests/rodar-alertas-test.sh, na mesma base, DEPOIS da 0172, com o esquema
-- mínimo do chão de fábrica (alertas_ficha_esquema.sql, com as funções-base do Almoxarifado como STUBS) e a 0173
-- aplicada duas vezes.
--
-- ⚠️ POR QUE ESTE ARQUIVO EXISTE: a 0173 recria o alerta_avaliar (roda de 5 em 5 min em produção) com um ramo
-- novo. Os defeitos caros são SQL puro: despejar o passado quando a regra é ligada, mandar a mesma ficha de 5 em
-- 5 minutos, avisar OP finalizada ou peça avulsa, ou marcar como avisada uma ficha que ninguém recebeu.
--
-- O mapa dos testes:
--   F1  esquema: tipo aceito; postos VAZIO aceito só na ficha (os outros tipos seguem exigindo posto); lembrete,
--       janela e limite recusados; tipo de envio 'ficha'; UMA alerta_avaliar de 4 parâmetros; grants;
--   F2  ⚠️ CAIXA NOVA avisa: uma mensagem por destinatário/canal, com TODOS os campos da ficha, sem botão e sem
--       ocorrência, e a marca gravada;
--   F3  a mesma caixa NÃO é reavisada (várias rodadas);
--   F4  RESPONSÁVEL da caixa = o colaborador do ÚLTIMO bipe da caixa no posto onde ela foi fechada (o mesmo da
--       tela do Almoxarifado); outro posto e bipes mais antigos não contam; sem bipe = vazio;
--   F5  ⚠️ LOTE NOVO avisa (rótulo LOTE[..][n], data = aprovação, responsável = último registro do NQA);
--   F6  ⚠️ PISO: caixa/lote anterior ao criado_em da regra NÃO avisa e NÃO é marcado;
--   F7  ⚠️ TETO de 3 dias: mais velho não avisa e NÃO é marcado; mais novo avisa;
--   F8  ⚠️ sem ninguém alcançável NÃO grava a marca; quando há alguém, a ficha sai e a marca grava;
--   F9  ⚠️ OP FINALIZADA não avisa (com maiúsculas/espaços);
--   F10 ⚠️ PEÇA AVULSA não avisa (OP individual sem lote do NQA); OP sem Almoxarifado na rota também não;
--   F11 filtro de PMO;
--   F12 ⚠️ no máximo 30 por rodada, as mais antigas primeiro; o resto sai na rodada seguinte;
--   F13 a marca impede o reaviso quando a caixa confirmada volta à lista (cancelamento);
--   F14 canal do Discord: ficha no canal (sem usuário), e regra só-canal sem canal configurado não marca;
--   F15 regra desativada não avisa; a ficha não abre ocorrência nem mexe nas outras regras;
--   F16 alerta_ficha_novas sem regra (simulação) ignora a marca; o responsável é uma função isolada.
-- (A idempotência da 0173 é do runner: ela é aplicada duas vezes.)

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.administrar,recebimento.administrar', false);

update public.alerta_regras set ativa = false where ativa;
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;

-- ---------- helpers ----------
create function public.teste_regra_ficha(p_nome text, p_pmos text[] default null,
                                         p_dest uuid[] default array['00000000-0000-0000-0000-0000000000c1']::uuid[],
                                         p_pessoas boolean default true, p_canal boolean default false)
returns uuid language sql as $f$
  insert into public.alerta_regras
    (nome, tipo, modulo, postos, pmos, janela_tipo, janela_valor, minimo_bipes, lembrete_min, canais,
     destinatarios, avisar_pessoas, avisar_canal, ativa, criado_por)
  values (p_nome, 'ficha', 'shopfloor', array[]::text[], coalesce(p_pmos, '{}'::text[]), 'op', null, null, null,
          array['telegram'], p_dest, p_pessoas, p_canal, true, '00000000-0000-0000-0000-000000000001')
  returning id
$f$;

-- Uma OP com a rota EMB -> ALMOX (ALMOX é de perfil almoxarifado). p_rota_almox false = sem o Almoxarifado.
create function public.teste_op_ficha(p_pmo text, p_op text, p_status text default 'EM PRODUCAO',
                                      p_individual boolean default false, p_desc text default 'PLACA TESTE 12V',
                                      p_qtd int default 800, p_rota_almox boolean default true)
returns void language plpgsql as $f$
declare v_id uuid;
begin
  insert into public.sf_ordens (pmo, op, status, descricao, qtd, embalagem_individual)
  values (p_pmo, p_op, p_status, p_desc, p_qtd, p_individual) returning id into v_id;
  insert into public.sf_ordem_postos (ordem_id, posto, ordem) values (v_id, 'EMB', 1);
  if p_rota_almox then insert into public.sf_ordem_postos (ordem_id, posto, ordem) values (v_id, 'ALMOX', 2); end if;
end $f$;

-- Uma caixa fechada, com o bipe (colaborador) de cada peça. p_fechada_em nulo = agora.
create function public.teste_caixa_ficha(p_pmo text, p_op text, p_seq int, p_qtd int,
                                         p_quem text default 'Ana', p_fechada_em timestamptz default null,
                                         p_posto text default 'EMB')
returns text language plpgsql as $f$
declare v_cod text := 'CX[' || p_seq || '][' || p_qtd || ']' || p_op || '-' || p_pmo;
begin
  insert into public.sf_caixas (pmo, op, posto, seq, codigo, qtd, fechada, revisao, fechada_em)
  values (p_pmo, p_op, p_posto, p_seq, v_cod, p_qtd, true, 0, coalesce(p_fechada_em, now()));
  insert into public.sf_registros (pmo, op, posto, numero_caixa, colaborador, data_hora, numero_serie, numero_serie_norm)
  values (p_pmo, p_op, p_posto, v_cod, p_quem, coalesce(p_fechada_em, now()), v_cod || '-1', v_cod || '-1');
  return v_cod;
end $f$;

-- Um lote do NQA (n linhas), cada linha com o colaborador e a hora dadas.
create function public.teste_lote_ficha(p_pmo text, p_op text, p_n int, p_quem text, p_em timestamptz default null)
returns uuid language plpgsql as $f$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.sf_registros (pmo, op, posto, nqa_lote_id, colaborador, data_hora, status, numero_serie, numero_serie_norm)
  select p_pmo, p_op, 'NQA', v_id, p_quem, coalesce(p_em, now()), 'Aprovado',
         'S' || v_id || '-' || g, 'S' || v_id || '-' || g
    from generate_series(1, p_n) g;
  return v_id;
end $f$;

create function public.teste_avaliar_ficha(p_canal text default null) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  v := public.alerta_avaliar(p_canal);
  if (v->>'ocupado')::boolean then raise exception 'avaliacao ocupada'; end if;
  return v;
end $f$;

create function public.teste_fila_ficha(p_regra text, p_canal text default null) returns int
language sql as $f$
  select count(*)::int from public.alerta_envios
   where tipo = 'ficha' and dados->>'regra_nome' = p_regra and (p_canal is null or canal = p_canal)
$f$;

create function public.teste_marcas_ficha(p_regra text) returns int
language sql as $f$
  select count(*)::int from public.alerta_ficha_avisadas a join public.alerta_regras rg on rg.id = a.regra_id
   where rg.nome = p_regra
$f$;

create function public.teste_dados_ficha(p_regra text, p_op text) returns jsonb
language sql as $f$
  select e.dados from public.alerta_envios e
   where e.tipo = 'ficha' and e.dados->>'regra_nome' = p_regra and e.dados->>'op' = p_op
   order by e.criado_em, e.id limit 1
$f$;

-- ---------- F1: esquema ----------
do $t$
declare v_id uuid;
begin
  v_id := public.teste_regra_ficha('Ficha esquema');
  delete from public.alerta_regras where id = v_id;

  -- ficha com posto: recusada (o Almoxarifado é o da rota de cada OP).
  begin
    insert into public.alerta_regras (nome, tipo, modulo, postos, janela_tipo, canais, destinatarios, ativa, criado_por)
    values ('Ficha com posto', 'ficha', 'shopfloor', array['ALMOX'], 'op', array['telegram'],
            array['00000000-0000-0000-0000-0000000000c1']::uuid[], true, '00000000-0000-0000-0000-000000000001');
    raise exception 'F1 FALHOU: ficha com posto aceita';
  exception when check_violation then null;
  end;
  -- lembrete recusado (é uma mensagem única).
  begin
    insert into public.alerta_regras (nome, tipo, modulo, postos, janela_tipo, lembrete_min, canais, destinatarios, ativa, criado_por)
    values ('Ficha lembrete', 'ficha', 'shopfloor', array[]::text[], 'op', 60, array['telegram'],
            array['00000000-0000-0000-0000-0000000000c1']::uuid[], true, '00000000-0000-0000-0000-000000000001');
    raise exception 'F1 FALHOU: lembrete aceito na ficha';
  exception when check_violation then null;
  end;
  -- janela diferente de 'op' recusada.
  begin
    insert into public.alerta_regras (nome, tipo, modulo, postos, janela_tipo, janela_valor, canais, destinatarios, ativa, criado_por)
    values ('Ficha janela', 'ficha', 'shopfloor', array[]::text[], 'tempo', 60, array['telegram'],
            array['00000000-0000-0000-0000-0000000000c1']::uuid[], true, '00000000-0000-0000-0000-000000000001');
    raise exception 'F1 FALHOU: janela tempo aceita na ficha';
  exception when check_violation then null;
  end;
  -- limite_horas é do parado.
  begin
    insert into public.alerta_regras (nome, tipo, modulo, postos, janela_tipo, limite_horas, canais, destinatarios, ativa, criado_por)
    values ('Ficha limite', 'ficha', 'shopfloor', array[]::text[], 'op', 2, array['telegram'],
            array['00000000-0000-0000-0000-0000000000c1']::uuid[], true, '00000000-0000-0000-0000-000000000001');
    raise exception 'F1 FALHOU: limite_horas aceito na ficha';
  exception when check_violation then null;
  end;
  -- no Recebimento: recusada.
  begin
    insert into public.alerta_regras (nome, tipo, modulo, postos, janela_tipo, canais, destinatarios, ativa, criado_por)
    values ('Ficha recebimento', 'ficha', 'recebimento', array[]::text[], 'op', array['telegram'],
            array['00000000-0000-0000-0000-0000000000c1']::uuid[], true, '00000000-0000-0000-0000-000000000001');
    raise exception 'F1 FALHOU: ficha aceita no Recebimento';
  exception when check_violation then null;
  end;
  -- ⚠️ o check `postos vazio` NÃO afrouxou para os outros tipos: compels e parado sem posto seguem recusados.
  begin
    insert into public.alerta_regras (nome, tipo, modulo, postos, janela_tipo, canais, destinatarios, ativa, criado_por)
    values ('Compels sem posto', 'compels', 'shopfloor', array[]::text[], 'op', array['telegram'],
            array['00000000-0000-0000-0000-0000000000c1']::uuid[], true, '00000000-0000-0000-0000-000000000001');
    raise exception 'F1 FALHOU: compels sem posto aceito';
  exception when check_violation then null;
  end;
  -- tipo de envio 'ficha' aceito.
  insert into public.alerta_envios (usuario_id, canal, tipo, dados)
  values ('00000000-0000-0000-0000-000000000001', 'telegram', 'ficha', '{}'::jsonb);
  delete from public.alerta_envios where tipo = 'ficha' and dados = '{}'::jsonb;

  if (select count(*) from pg_proc where proname = 'alerta_avaliar' and pronamespace = 'public'::regnamespace) <> 1
     or to_regprocedure('public.alerta_avaliar(text,jsonb,jsonb,jsonb)') is null then
    raise exception 'F1 FALHOU: deveria existir UMA alerta_avaliar de 4 parametros';
  end if;
  if has_function_privilege('anon', 'public.alerta_ficha_novas(uuid,text[],timestamptz,int)', 'execute')
     or has_function_privilege('authenticated', 'public.alerta_ficha_novas(uuid,text[],timestamptz,int)', 'execute')
     or not has_function_privilege('service_role', 'public.alerta_ficha_novas(uuid,text[],timestamptz,int)', 'execute') then
    raise exception 'F1 FALHOU: grants de alerta_ficha_novas';
  end if;
  if has_function_privilege('anon', 'public.alerta_ficha_responsavel(text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.alerta_ficha_responsavel(text,text,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.alerta_ficha_responsavel(text,text,text,text)', 'execute') then
    raise exception 'F1 FALHOU: grants de alerta_ficha_responsavel';
  end if;
  if has_table_privilege('anon', 'public.alerta_ficha_avisadas', 'select')
     or has_table_privilege('authenticated', 'public.alerta_ficha_avisadas', 'insert') then
    raise exception 'F1 FALHOU: grants de alerta_ficha_avisadas';
  end if;
end $t$;
select 'F1 (esquema, checks, grants): ok';

-- ---------- F2/F3/F4: caixa nova ----------
-- A regra nasce AGORA (piso = criado_em dela); avisa a pessoa (telegram, c1).
select public.teste_regra_ficha('Ficha caixa', array['PMOA']);
select public.teste_op_ficha('PMOA', '9101', 'EM PRODUCAO', false, 'PLACA CONTROLADORA 24V', 800);
-- Duas caixas: a 1 fechada por quem fez o último bipe (Bia), depois do bipe da Ana (mais antigo);
-- bipe em OUTRO posto não conta.
select public.teste_caixa_ficha('PMOA', '9101', 1, 160, 'Ana');
do $t$
declare v_cod text := 'CX[1][160]9101-PMOA';
begin
  insert into public.sf_registros (pmo, op, posto, numero_caixa, colaborador, data_hora, numero_serie, numero_serie_norm)
  values ('PMOA', '9101', 'EMB', v_cod, 'Bia', now() + interval '1 minute', 'x2', 'X2'),
         ('PMOA', '9101', 'EMB', v_cod, 'Ana', now() - interval '1 hour', 'x3', 'X3'),
         ('PMOA', '9101', 'NQA', v_cod, 'Carlos', now() + interval '2 minutes', 'x4', 'X4');
end $t$;
do $t$
declare d jsonb; v_env record;
begin
  perform public.teste_avaliar_ficha();
  if public.teste_fila_ficha('Ficha caixa') <> 1 then
    raise exception 'F2 FALHOU: % fichas (esperava 1)', public.teste_fila_ficha('Ficha caixa');
  end if;
  select e.* into v_env from public.alerta_envios e where e.tipo = 'ficha' and e.dados->>'regra_nome' = 'Ficha caixa';
  if v_env.com_botao or v_env.ocorrencia_id is not null or v_env.canal <> 'telegram'
     or v_env.destino_tipo <> 'usuario' or v_env.usuario_id <> '00000000-0000-0000-0000-0000000000c1' then
    raise exception 'F2 FALHOU: envio com botao/ocorrencia/destino errado: %', to_jsonb(v_env);
  end if;
  d := v_env.dados;
  if d->>'unidade' <> 'caixa' or d->>'qr' <> 'CX[1][160]9101-PMOA' or d->>'codigo' <> 'CX[1][160]9101-PMOA'
     or d->>'pmo' <> 'PMOA' or d->>'op' <> '9101'
     or d->>'produto' <> 'PLACA CONTROLADORA 24V' or (d->>'quantidade_op')::int <> 800
     or (d->>'quantidade_apontada')::int <> 160 or d->>'regra_tipo' <> 'ficha'
     or d->>'data_producao' is null or abs(extract(epoch from (d->>'data_producao')::timestamptz - now())) > 120
     or d->>'agora' is null then
    raise exception 'F2 FALHOU: campos da ficha errados: %', d;
  end if;
  -- F4: responsável = o colaborador do ÚLTIMO bipe da caixa no posto da caixa (Bia), não a Ana (mais antiga), nem o
  -- Carlos (bipe em outro posto, mais novo ainda).
  if d->>'responsavel' <> 'Bia' then raise exception 'F4 FALHOU: responsavel = % (esperava Bia)', d->>'responsavel'; end if;
  -- a marca foi gravada e a ficha NÃO abriu ocorrência
  if public.teste_marcas_ficha('Ficha caixa') <> 1 then raise exception 'F2 FALHOU: marca de ja avisei ausente'; end if;
  if exists (select 1 from public.alerta_ocorrencias oc join public.alerta_regras rg on rg.id = oc.regra_id where rg.nome = 'Ficha caixa') then
    raise exception 'F2 FALHOU: a ficha abriu ocorrencia';
  end if;
end $t$;
select 'F2 (caixa nova avisa, campos da ficha, sem botao nem ocorrencia) + F4 (responsavel = ultimo bipe da caixa): ok';

do $t$
declare v_antes int;
begin
  v_antes := public.teste_fila_ficha('Ficha caixa');
  perform public.teste_avaliar_ficha();
  perform public.teste_avaliar_ficha();
  perform public.teste_avaliar_ficha();
  if public.teste_fila_ficha('Ficha caixa') <> v_antes then raise exception 'F3 FALHOU: a ficha saiu mais de uma vez'; end if;
  if public.teste_marcas_ficha('Ficha caixa') <> 1 then raise exception 'F3 FALHOU: marca duplicada ou perdida'; end if;
end $t$;
select 'F3 (a mesma caixa nao e reavisada): ok';

-- F4 (cont.): sem nenhum bipe de colaborador a função devolve nulo e a ficha sai com responsavel vazio.
do $t$
declare v_cod text; d jsonb;
begin
  perform public.teste_op_ficha('PMOA', '9102');
  v_cod := public.teste_caixa_ficha('PMOA', '9102', 1, 10, '   ');
  perform public.teste_avaliar_ficha();
  d := public.teste_dados_ficha('Ficha caixa', '9102');
  if d is null or d->>'responsavel' <> '' then raise exception 'F4 FALHOU: responsavel em branco deveria sair vazio: %', d; end if;
  if public.alerta_ficha_responsavel('caixa', 'PMOA', '9102', v_cod) is not null then
    raise exception 'F4 FALHOU: a funcao deveria devolver nulo para colaborador em branco';
  end if;
  if public.alerta_ficha_responsavel('caixa', 'PMOA', '9102', 'CX[inexistente]') is not null
     or public.alerta_ficha_responsavel('lote', 'PMOA', '9102', gen_random_uuid()::text) is not null then
    raise exception 'F4 FALHOU: caixa/lote inexistente deveria dar nulo';
  end if;
end $t$;
select 'F4 (responsavel em branco/inexistente = vazio): ok';

-- ---------- F5: lote novo ----------
-- OP individual com NQA: o lote vira necessidade; data = o último registro (aprovação); responsável = o do último
-- registro do NQA.
select public.teste_regra_ficha('Ficha lote', array['PMOL']);
select public.teste_op_ficha('PMOL', '9201', 'EM PRODUCAO', true, 'KIT SENSOR 5V', 300);
do $t$
declare v_lote uuid; d jsonb;
begin
  v_lote := public.teste_lote_ficha('PMOL', '9201', 6, 'Dora', now());
  -- um registro mais novo de outra pessoa (a que fecha a aprovação do lote)
  insert into public.sf_registros (pmo, op, posto, nqa_lote_id, colaborador, data_hora, status, numero_serie, numero_serie_norm)
  values ('PMOL', '9201', 'NQA', v_lote, 'Eva', now() + interval '1 minute', 'Aprovado', 'zz1', 'ZZ1');
  perform public.teste_avaliar_ficha();
  if public.teste_fila_ficha('Ficha lote') <> 1 then
    raise exception 'F5 FALHOU: % fichas de lote (esperava 1)', public.teste_fila_ficha('Ficha lote');
  end if;
  d := public.teste_dados_ficha('Ficha lote', '9201');
  if d->>'unidade' <> 'lote' or d->>'qr' <> 'LOTE[' || left(replace(v_lote::text, '-', ''), 8) || '][7]'
     or d->>'codigo' <> d->>'qr' or (d->>'quantidade_apontada')::int <> 7
     or d->>'produto' <> 'KIT SENSOR 5V' or (d->>'quantidade_op')::int <> 300
     or d->>'responsavel' <> 'Eva'
     or abs(extract(epoch from (d->>'data_producao')::timestamptz - (now() + interval '1 minute'))) > 5 then
    raise exception 'F5 FALHOU: ficha de lote errada: %', d;
  end if;
  if public.alerta_ficha_responsavel('lote', 'PMOL', '9201', v_lote::text) <> 'Eva' then
    raise exception 'F5 FALHOU: responsavel do lote';
  end if;
  if public.teste_marcas_ficha('Ficha lote') <> 1 then raise exception 'F5 FALHOU: marca do lote ausente'; end if;
  -- de novo: nada
  perform public.teste_avaliar_ficha();
  if public.teste_fila_ficha('Ficha lote') <> 1 then raise exception 'F5 FALHOU: o lote foi reavisado'; end if;
end $t$;
select 'F5 (lote novo avisa, data = aprovacao, responsavel = ultimo registro do NQA): ok';

-- ---------- F6: piso = criado_em da regra ----------
-- Fixtures PRONTAS ANTES de a regra existir: nada deve sair, e nada deve ser marcado.
select public.teste_op_ficha('PMOP', '9301');
select public.teste_op_ficha('PMOP', '9302', 'EM PRODUCAO', true);
select public.teste_caixa_ficha('PMOP', '9301', 1, 20, 'Ana', now() - interval '2 hours');
select public.teste_lote_ficha('PMOP', '9302', 3, 'Dora', now() - interval '2 hours');
select public.teste_regra_ficha('Ficha piso', array['PMOP']);
-- (a regra nasce agora: tudo acima é de antes dela)
do $t$
begin
  perform public.teste_avaliar_ficha();
  perform public.teste_avaliar_ficha();
  if public.teste_fila_ficha('Ficha piso') <> 0 then raise exception 'F6 FALHOU: avisou o passado (% fichas)', public.teste_fila_ficha('Ficha piso'); end if;
  if public.teste_marcas_ficha('Ficha piso') <> 0 then raise exception 'F6 FALHOU: marcou o passado'; end if;
  -- uma caixa NOVA (depois da regra) sai normalmente: o piso não trava o futuro
  perform public.teste_caixa_ficha('PMOP', '9301', 2, 20, 'Ana', now());
  perform public.teste_avaliar_ficha();
  if public.teste_fila_ficha('Ficha piso') <> 1 then raise exception 'F6 FALHOU: a caixa nova nao saiu'; end if;
end $t$;
select 'F6 (piso: o passado nao e despejado nem marcado; o futuro sai): ok';

-- ---------- F7: teto de 3 dias ----------
-- Regra "antiga" (criada há 10 dias): o piso deixaria tudo passar; o TETO corta o que passa de 3 dias.
select public.teste_regra_ficha('Ficha teto', array['PMOT']);
update public.alerta_regras set criado_em = now() - interval '10 days' where nome = 'Ficha teto';
select public.teste_op_ficha('PMOT', '9401');
select public.teste_caixa_ficha('PMOT', '9401', 1, 10, 'Ana', now() - interval '5 days');
select public.teste_caixa_ficha('PMOT', '9401', 2, 10, 'Ana', now() - interval '2 days');
do $t$
declare d jsonb;
begin
  perform public.teste_avaliar_ficha();
  perform public.teste_avaliar_ficha();
  if public.teste_fila_ficha('Ficha teto') <> 1 then raise exception 'F7 FALHOU: % fichas (esperava 1, so a de 2 dias)', public.teste_fila_ficha('Ficha teto'); end if;
  d := (select e.dados from public.alerta_envios e where e.tipo = 'ficha' and e.dados->>'regra_nome' = 'Ficha teto');
  if d->>'codigo' <> 'CX[2][10]9401-PMOT' then raise exception 'F7 FALHOU: saiu a caixa errada: %', d; end if;
  if public.teste_marcas_ficha('Ficha teto') <> 1 then raise exception 'F7 FALHOU: a caixa velha foi marcada (ou a nova nao)'; end if;
end $t$;
select 'F7 (teto de 3 dias: mais velho nao avisa e nao e marcado): ok';

-- ---------- F8: sem ninguém alcançável ----------
-- Destinatário sem conta de canal nenhum (..dd): não enfileira nada e NÃO grava a marca.
select public.teste_regra_ficha('Ficha sem ninguem', array['PMOQ'], array['00000000-0000-0000-0000-0000000000dd']::uuid[]);
select public.teste_op_ficha('PMOQ', '9501');
select public.teste_caixa_ficha('PMOQ', '9501', 1, 10);
do $t$
begin
  perform public.teste_avaliar_ficha();
  perform public.teste_avaliar_ficha();
  if public.teste_fila_ficha('Ficha sem ninguem') <> 0 then raise exception 'F8 FALHOU: enfileirou sem destinatario alcancavel'; end if;
  if public.teste_marcas_ficha('Ficha sem ninguem') <> 0 then raise exception 'F8 FALHOU: gravou a marca sem enviar'; end if;
  -- agora alguém é alcançável: a ficha sai (e só agora a marca grava)
  update public.alerta_regras set destinatarios = array['00000000-0000-0000-0000-0000000000c1']::uuid[] where nome = 'Ficha sem ninguem';
  perform public.teste_avaliar_ficha();
  if public.teste_fila_ficha('Ficha sem ninguem') <> 1 then raise exception 'F8 FALHOU: a ficha nao saiu quando houve destinatario'; end if;
  if public.teste_marcas_ficha('Ficha sem ninguem') <> 1 then raise exception 'F8 FALHOU: a marca nao gravou depois de enviar'; end if;
end $t$;
select 'F8 (sem ninguem alcancavel nao grava a marca; com alguem, avisa e marca): ok';

-- ---------- F9/F10: o que NÃO avisa ----------
select public.teste_regra_ficha('Ficha nao avisa', array['PMON']);
-- OP finalizada (várias grafias) e OP sem Almoxarifado na rota
select public.teste_op_ficha('PMON', '9601', 'FINALIZADA');
select public.teste_op_ficha('PMON', '9602', '  finalizada ');
select public.teste_op_ficha('PMON', '9603', 'EM PRODUCAO', false, 'X', 10, false);
select public.teste_caixa_ficha('PMON', '9601', 1, 10);
select public.teste_caixa_ficha('PMON', '9602', 1, 10);
select public.teste_caixa_ficha('PMON', '9603', 1, 10);
-- peça avulsa: OP individual, registros de peça, nenhum lote de NQA
select public.teste_op_ficha('PMON', '9604', 'EM PRODUCAO', true);
insert into public.sf_registros (pmo, op, posto, colaborador, data_hora, numero_serie, numero_serie_norm, status)
select 'PMON', '9604', 'EMB', 'Ana', now(), 'AV' || g, 'AV' || g, 'Aprovado' from generate_series(1, 25) g;
do $t$
begin
  perform public.teste_avaliar_ficha();
  perform public.teste_avaliar_ficha();
  if public.teste_fila_ficha('Ficha nao avisa') <> 0 then
    raise exception 'F9/F10 FALHOU: avisou o que nao devia (% fichas): %', public.teste_fila_ficha('Ficha nao avisa'),
      (select string_agg(e.dados->>'op', ',') from public.alerta_envios e where e.tipo = 'ficha' and e.dados->>'regra_nome' = 'Ficha nao avisa');
  end if;
  if public.teste_marcas_ficha('Ficha nao avisa') <> 0 then raise exception 'F9/F10 FALHOU: marcou o que nao devia'; end if;
  -- controle: a mesma OP, ativa e com Almoxarifado, avisa (o teste não passa por estar tudo mudo)
  perform public.teste_op_ficha('PMON', '9605');
  perform public.teste_caixa_ficha('PMON', '9605', 1, 10);
  perform public.teste_avaliar_ficha();
  if public.teste_fila_ficha('Ficha nao avisa') <> 1 then raise exception 'F9/F10 FALHOU: o controle nao avisou'; end if;
  -- e uma OP que FINALIZA depois de a ficha estar pendente deixa de avisar
  perform public.teste_op_ficha('PMON', '9606');
  perform public.teste_caixa_ficha('PMON', '9606', 1, 10);
  update public.sf_ordens set status = 'FINALIZADA' where pmo = 'PMON' and op = '9606';
  perform public.teste_avaliar_ficha();
  if public.teste_fila_ficha('Ficha nao avisa') <> 1 then raise exception 'F9 FALHOU: avisou OP que finalizou'; end if;
end $t$;
select 'F9 (OP finalizada nao avisa) + F10 (peca avulsa e OP sem Almoxarifado nao avisam): ok';

-- ---------- F11: filtro de PMO ----------
select public.teste_regra_ficha('Ficha pmo', array['PMOX']);
select public.teste_op_ficha('PMOX', '9701');
select public.teste_op_ficha('PMOY', '9702');
select public.teste_caixa_ficha('PMOX', '9701', 1, 10);
select public.teste_caixa_ficha('PMOY', '9702', 1, 10);
do $t$
begin
  perform public.teste_avaliar_ficha();
  if public.teste_fila_ficha('Ficha pmo') <> 1
     or not exists (select 1 from public.alerta_envios e where e.tipo = 'ficha' and e.dados->>'regra_nome' = 'Ficha pmo' and e.dados->>'op' = '9701') then
    raise exception 'F11 FALHOU: filtro de PMO (esperava so a 9701): %', public.teste_fila_ficha('Ficha pmo');
  end if;
end $t$;
select 'F11 (filtro de PMO): ok';

-- ---------- F12: no máximo 30 por rodada, as mais antigas primeiro ----------
select public.teste_regra_ficha('Ficha lote30', array['PMOZ']);
select public.teste_op_ficha('PMOZ', '9801');
do $t$
declare g int;
begin
  -- 35 caixas, fechadas 1 s uma depois da outra, depois de a regra existir (a seq 1 é a mais antiga)
  for g in 1..35 loop
    perform public.teste_caixa_ficha('PMOZ', '9801', g, 10, 'Ana', now() + make_interval(secs => g));
  end loop;
end $t$;
do $t$
declare v_antes int;
begin
  perform public.teste_avaliar_ficha();
  if public.teste_fila_ficha('Ficha lote30') <> 30 then raise exception 'F12 FALHOU: % fichas na 1a rodada (esperava 30)', public.teste_fila_ficha('Ficha lote30'); end if;
  -- as 30 mais antigas: seq 1..30; a seq 31..35 ficam para depois
  if exists (select 1 from public.alerta_envios e where e.tipo = 'ficha' and e.dados->>'regra_nome' = 'Ficha lote30'
                and substring(e.dados->>'codigo' from 'CX\[(\d+)\]')::int > 30) then
    raise exception 'F12 FALHOU: saiu uma caixa que nao era das 30 mais antigas';
  end if;
  perform public.teste_avaliar_ficha();
  if public.teste_fila_ficha('Ficha lote30') <> 35 then raise exception 'F12 FALHOU: % fichas na 2a rodada (esperava 35)', public.teste_fila_ficha('Ficha lote30'); end if;
  perform public.teste_avaliar_ficha();
  if public.teste_fila_ficha('Ficha lote30') <> 35 or public.teste_marcas_ficha('Ficha lote30') <> 35 then
    raise exception 'F12 FALHOU: depois das 35 nao pode sair mais nada';
  end if;
end $t$;
select 'F12 (30 por rodada, as mais antigas primeiro): ok';

-- ---------- F13: a marca impede o reaviso quando a caixa volta à lista ----------
select public.teste_regra_ficha('Ficha volta', array['PMOV']);
select public.teste_op_ficha('PMOV', '9901');
select public.teste_caixa_ficha('PMOV', '9901', 1, 10);
do $t$
declare v_cod text := 'CX[1][10]9901-PMOV';
begin
  perform public.teste_avaliar_ficha();
  if public.teste_fila_ficha('Ficha volta') <> 1 then raise exception 'F13 FALHOU: a primeira ficha nao saiu'; end if;
  -- o Almoxarifado confirma: a caixa sai da lista
  insert into public.sf_registros (pmo, op, posto, numero_caixa, colaborador, numero_serie, numero_serie_norm)
  values ('PMOV', '9901', 'ALMOX', v_cod, 'Gil', 'c1', 'C1');
  perform public.teste_avaliar_ficha();
  -- cancelamento: o registro do Almoxarifado some e a caixa VOLTA à lista
  delete from public.sf_registros where pmo = 'PMOV' and op = '9901' and posto = 'ALMOX';
  if not exists (select 1 from public.sf_almox_necessidades_base('PMOV', '9901') where codigo = v_cod) then
    raise exception 'F13 FALHOU: a caixa deveria ter voltado a lista (premissa do teste)';
  end if;
  perform public.teste_avaliar_ficha();
  perform public.teste_avaliar_ficha();
  if public.teste_fila_ficha('Ficha volta') <> 1 then raise exception 'F13 FALHOU: reavisou a caixa que voltou'; end if;
end $t$;
select 'F13 (a marca impede o reaviso da caixa que volta a lista): ok';

-- ---------- F14: canal do Discord ----------
-- Só o canal (sem pessoas): uma ficha no canal, sem usuario; sem canal configurado nada é enfileirado nem marcado.
select public.teste_regra_ficha('Ficha canal', array['PMOK'], array['00000000-0000-0000-0000-0000000000c1']::uuid[], false, true);
select public.teste_op_ficha('PMOK', '9911');
select public.teste_caixa_ficha('PMOK', '9911', 1, 10);
do $t$
declare v_env record;
begin
  perform public.teste_avaliar_ficha();   -- sem canal configurado (p_canal_discord nulo)
  if public.teste_fila_ficha('Ficha canal') <> 0 or public.teste_marcas_ficha('Ficha canal') <> 0 then
    raise exception 'F14 FALHOU: sem canal configurado nao pode enfileirar nem marcar';
  end if;
  perform public.teste_avaliar_ficha('CANAL-123');
  if public.teste_fila_ficha('Ficha canal') <> 1 then raise exception 'F14 FALHOU: a ficha do canal nao saiu'; end if;
  select e.* into v_env from public.alerta_envios e where e.tipo = 'ficha' and e.dados->>'regra_nome' = 'Ficha canal';
  if v_env.canal <> 'discord' or v_env.destino_tipo <> 'canal' or v_env.destino_externo_id <> 'CANAL-123'
     or v_env.usuario_id is not null or v_env.com_botao or v_env.ocorrencia_id is not null then
    raise exception 'F14 FALHOU: envio do canal errado: %', to_jsonb(v_env);
  end if;
  if public.teste_marcas_ficha('Ficha canal') <> 1 then raise exception 'F14 FALHOU: marca do canal ausente'; end if;
  perform public.teste_avaliar_ficha('CANAL-123');
  if public.teste_fila_ficha('Ficha canal') <> 1 then raise exception 'F14 FALHOU: reenviou ao canal'; end if;
end $t$;
-- Pessoas E canal juntos: duas linhas por ficha (a do telegram e a do canal), uma marca.
select public.teste_regra_ficha('Ficha os dois', array['PMOJ'], array['00000000-0000-0000-0000-0000000000c1']::uuid[], true, true);
select public.teste_op_ficha('PMOJ', '9921');
select public.teste_caixa_ficha('PMOJ', '9921', 1, 10);
do $t$
begin
  perform public.teste_avaliar_ficha('CANAL-123');
  if public.teste_fila_ficha('Ficha os dois') <> 2 or public.teste_fila_ficha('Ficha os dois', 'discord') <> 1
     or public.teste_fila_ficha('Ficha os dois', 'telegram') <> 1 or public.teste_marcas_ficha('Ficha os dois') <> 1 then
    raise exception 'F14 FALHOU: pessoas + canal deveria dar 2 linhas e 1 marca';
  end if;
end $t$;
select 'F14 (canal do Discord; pessoas + canal): ok';

-- ---------- F15: regra desativada; sem efeito nas outras regras ----------
select public.teste_regra_ficha('Ficha inativa', array['PMOI']);
update public.alerta_regras set ativa = false where nome = 'Ficha inativa';
select public.teste_op_ficha('PMOI', '9931');
select public.teste_caixa_ficha('PMOI', '9931', 1, 10);
do $t$
declare v jsonb;
begin
  v := public.teste_avaliar_ficha();
  if public.teste_fila_ficha('Ficha inativa') <> 0 or public.teste_marcas_ficha('Ficha inativa') <> 0 then
    raise exception 'F15 FALHOU: regra desativada avisou';
  end if;
  -- a ficha não conta como "item de posto avaliado" e não abre ocorrência
  if (v->>'avaliadas')::int <> 0 then raise exception 'F15 FALHOU: avaliadas = % (a ficha nao e item de posto)', v->>'avaliadas'; end if;
  if exists (select 1 from public.alerta_ocorrencias oc join public.alerta_regras rg on rg.id = oc.regra_id where rg.tipo = 'ficha') then
    raise exception 'F15 FALHOU: alguma ficha abriu ocorrencia';
  end if;
  -- reativada: ainda sem aviso do que é anterior à reativação? NÃO: o piso é o criado_em (não a reativação),
  -- então a caixa (criada depois da regra) sai ao ligar
  update public.alerta_regras set ativa = true where nome = 'Ficha inativa';
  perform public.teste_avaliar_ficha();
  if public.teste_fila_ficha('Ficha inativa') <> 1 then raise exception 'F15 FALHOU: reativada nao avisou'; end if;
end $t$;
select 'F15 (regra desativada; ficha nao e item de posto nem abre ocorrencia): ok';

-- ---------- F16: a função de leitura sem regra (a simulação do roteiro) ----------
do $t$
declare v_n int; v_n_marcadas int;
begin
  -- Sem regra (p_regra_id nulo) a marca não vale: devolve também o que já foi avisado.
  select count(*) into v_n from public.alerta_ficha_novas(null, array['PMOA'], now() - interval '1 day', 100);
  select count(*) into v_n_marcadas from public.alerta_ficha_novas(
    (select id from public.alerta_regras where nome = 'Ficha caixa'), array['PMOA'], now() - interval '1 day', 100);
  if v_n < 2 or v_n_marcadas <> 0 then
    raise exception 'F16 FALHOU: sem regra = % (esperava >= 2); com a regra = % (esperava 0, tudo marcado)', v_n, v_n_marcadas;
  end if;
  -- p_limite respeitado; limite 0 devolve nada
  if (select count(*) from public.alerta_ficha_novas(null, array['PMOZ'], now() - interval '1 day', 5)) <> 5
     or (select count(*) from public.alerta_ficha_novas(null, array['PMOZ'], now() - interval '1 day', 0)) <> 0 then
    raise exception 'F16 FALHOU: limite da funcao';
  end if;
end $t$;
select 'F16 (alerta_ficha_novas sem regra ignora a marca; limite respeitado): ok';

-- ---------- F17: os outros tipos seguem como antes (chamada sem argumentos, como o app antigo) ----------
do $t$
declare v jsonb;
begin
  v := public.alerta_avaliar();
  if (v->>'ocupado')::boolean is not false then raise exception 'F17 FALHOU: %', v; end if;
end $t$;
select 'F17 (alerta_avaliar sem argumentos segue funcionando): ok';
