-- Testes SQL da 0192 (módulo de alerta 'sat', tipo de regra 'sat_entrada': aviso de entrada no SAT). Rodar com
-- supabase/tests/rodar-alertas-test.sh: DEPOIS de toda a cadeia dos alertas (até a 0188), na mesma base, com as
-- migrações do SAT (0186, 0187, 0190) e a 0192 por cima de tudo.
--
-- O mapa:
--   T0  esquema: 'sat' nos checks de módulo; 'sat_entrada' SÓ no módulo 'sat' (e o SAT só aceita ele); a marca
--       com RLS e grants; a função de eventos fechada; as policies das regras com a perna do SAT em InitPlan;
--       a tela (alerta_destinatarios / alerta_listar_ocorrencias) aceita 'sat' com sat.administrar;
--   T1  sem regra ativa: registrar NF não enfileira nada;
--   T2  regra ativa: registrar NF enfileira UM aviso por responsável (dados = a nota), grava a marca, e a
--       rodada seguinte NÃO repete;
--   T3  corrigir a NF: mais um aviso (evento 'correcao', de → para, motivos);
--   T4  trocar a NF: mais um aviso (evento 'troca', número antigo → novo);
--   T5  responsável que não administra o SAT fica de fora; canal do Discord ganha UMA linha;
--   T6  regra desativada: nada;
--   T7  o piso: evento de antes de a regra existir não avisa;
--   T8  ninguém alcançável: nada na fila e SEM marca; vinculou a conta, sai;
--   T9  troca de OS (linha 'os' do histórico) não avisa;
--   T10 não encosta no caminho da ocorrência.
-- (A idempotência da 0192 é do runner: aplicada duas vezes, com as contagens e as funções comparadas.)

select set_config('teste.uid', '00000000-0000-0000-0000-0000000000d1', false);
select set_config('teste.perms',
  'shopfloor.administrar,recebimento.administrar,sat.administrar,sat.visualizar,sat.registrar_entrada,sat.aprovar_nf',
  false);

-- As regras dos testes anteriores saem do caminho e a fila antiga é dada por desistida.
update public.alerta_regras set ativa = false where ativa;
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;

-- ---------- massa ----------
-- Dora administra o SAT e tem Telegram. Beto (da 0149) administra só o Recebimento e também tem Telegram.
-- Eva administra o SAT e NÃO tem conta vinculada (nem e-mail na regra).
insert into public.perfis (id, nome) values ('00000000-0000-0000-0000-0000000000d0', 'Gestor SAT')
on conflict (id) do nothing;
insert into public.perfil_permissao (perfil_id, modulo, permissao) values
  ('00000000-0000-0000-0000-0000000000d0', 'sat', 'administrar')
on conflict do nothing;
insert into public.usuarios (id, nome, email, ativo, perfil_id) values
  ('00000000-0000-0000-0000-0000000000d1', 'Dora SAT', 'dora@x', true, '00000000-0000-0000-0000-0000000000d0'),
  ('00000000-0000-0000-0000-0000000000e1', 'Eva SAT',  'eva@x',  true, '00000000-0000-0000-0000-0000000000d0')
on conflict (id) do nothing;
insert into public.alerta_contas (usuario_id, canal, externo_id) values
  ('00000000-0000-0000-0000-0000000000d1', 'telegram', 'TG-DORA')
on conflict (usuario_id, canal) do nothing;

-- ---------- helpers ----------
-- ⚠️ `minimo_bipes` vai EXPLÍCITO e nulo (default 20 da 0113; o ramo 'sat_entrada' do check exige nulo).
create function public.teste_regra_sat(
  p_nome text,
  p_destinatarios uuid[] default array['00000000-0000-0000-0000-0000000000d1']::uuid[],
  p_criado_em timestamptz default now() - interval '1 hour',
  p_avisar_canal boolean default false
) returns uuid language sql as $f$
  insert into public.alerta_regras
    (nome, tipo, modulo, postos, janela_tipo, janela_valor, minimo_bipes, canais, destinatarios,
     avisar_pessoas, avisar_canal, ativa, criado_por, criado_em)
  values (p_nome, 'sat_entrada', 'sat', '{}'::text[], 'op', null, null, array['telegram'],
          p_destinatarios, true, p_avisar_canal, true, '00000000-0000-0000-0000-0000000000d1', p_criado_em)
  returning id
$f$;

-- Registra uma NF com N relógios, como a tela (sat_registrar_nf). Devolve o id da nota.
create function public.teste_nf(p_numero text, p_ns text[]) returns uuid language sql as $f$
  select (public.sat_registrar_nf(jsonb_build_object(
            'numero', p_numero, 'cnpj', '12345678000190', 'empresa', 'CLIENTE FICTICIO', 'valor', '',
            'situacao', 'aprovada', 'motivos', '[]'::jsonb,
            'relogios', (select jsonb_agg(jsonb_build_object('ns', n) order by o) from unnest(p_ns) with ordinality u(n, o))
          )) ->> 'nf_id')::uuid
$f$;

-- As linhas da fila desta regra.
create function public.teste_envios_sat(p_regra text) returns int language sql as $f$
  select count(*)::int from public.alerta_envios
   where tipo = 'sat_entrada' and dados->>'regra_nome' = p_regra
$f$;

create function public.teste_avaliar(p_canal text default null) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  v := public.alerta_avaliar(p_canal);
  if (v->>'ocupado')::boolean then raise exception 'avaliacao ocupada'; end if;
  return v;
end $f$;

-- ---------- T0: esquema ----------
do $t$
declare v int;
begin
  -- 'sat_entrada' SÓ no módulo 'sat'
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, janela_tipo, janela_valor, minimo_bipes, canais, destinatarios, ativa, criado_por)
    values ('SAT no ShopFloor', 'sat_entrada', 'shopfloor', '{}'::text[], 'op', null, null, array['telegram'],
            array['00000000-0000-0000-0000-0000000000d1']::uuid[], true, '00000000-0000-0000-0000-0000000000d1');
    raise exception 'T0 FALHOU: sat_entrada aceito no modulo shopfloor';
  exception when check_violation then null;
  end;
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, janela_tipo, janela_valor, minimo_bipes, canais, destinatarios, ativa, criado_por)
    values ('SAT no Recebimento', 'sat_entrada', 'recebimento', '{}'::text[], 'op', null, null, array['telegram'],
            array['00000000-0000-0000-0000-0000000000d1']::uuid[], true, '00000000-0000-0000-0000-0000000000d1');
    raise exception 'T0 FALHOU: sat_entrada aceito no modulo recebimento';
  exception when check_violation then null;
  end;
  -- e o SAT não aceita outro tipo
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, janela_tipo, janela_valor, minimo_bipes, canais, destinatarios, ativa, criado_por)
    values ('EMB no SAT', 'emb', 'sat', '{}'::text[], 'op', null, null, array['telegram'],
            array['00000000-0000-0000-0000-0000000000d1']::uuid[], true, '00000000-0000-0000-0000-0000000000d1');
    raise exception 'T0 FALHOU: emb aceito no modulo sat';
  exception when check_violation then null;
  end;
  -- sat_entrada não aceita posto nem PMO nem lembrete
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, janela_tipo, janela_valor, minimo_bipes, canais, destinatarios, ativa, criado_por)
    values ('SAT com posto', 'sat_entrada', 'sat', array['TESTE'], 'op', null, null, array['telegram'],
            array['00000000-0000-0000-0000-0000000000d1']::uuid[], true, '00000000-0000-0000-0000-0000000000d1');
    raise exception 'T0 FALHOU: sat_entrada com posto aceito';
  exception when check_violation then null;
  end;
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, pmos, janela_tipo, janela_valor, minimo_bipes, canais, destinatarios, ativa, criado_por)
    values ('SAT com PMO', 'sat_entrada', 'sat', '{}'::text[], array['PMOX'], 'op', null, null, array['telegram'],
            array['00000000-0000-0000-0000-0000000000d1']::uuid[], true, '00000000-0000-0000-0000-0000000000d1');
    raise exception 'T0 FALHOU: sat_entrada com PMO aceito';
  exception when check_violation then null;
  end;
  -- módulo fora da lista continua recusado
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, janela_tipo, janela_valor, minimo_bipes, canais, destinatarios, ativa, criado_por)
    values ('Faturamento', 'sat_entrada', 'faturamento', '{}'::text[], 'op', null, null, array['telegram'],
            array['00000000-0000-0000-0000-0000000000d1']::uuid[], true, '00000000-0000-0000-0000-0000000000d1');
    raise exception 'T0 FALHOU: modulo faturamento aceito';
  exception when check_violation then null;
  end;

  -- a marca
  if not (select relrowsecurity from pg_class where relname = 'alerta_sat_avisada'
            and relnamespace = 'public'::regnamespace) then
    raise exception 'T0 FALHOU: alerta_sat_avisada sem RLS';
  end if;
  if has_table_privilege('anon', 'public.alerta_sat_avisada', 'select') then
    raise exception 'T0 FALHOU: anon le a marca';
  end if;
  if has_table_privilege('authenticated', 'public.alerta_sat_avisada', 'insert') then
    raise exception 'T0 FALHOU: authenticated escreve na marca';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'alerta_sat_avisada'
                    and qual like '%SELECT tem_permissao(''sat''::text, ''administrar''::text)%') then
    raise exception 'T0 FALHOU: policy da marca sem sat.administrar em InitPlan';
  end if;
  -- a função de eventos é interna
  if has_function_privilege('authenticated', 'public.alerta_sat_eventos(uuid, timestamptz, int)', 'execute')
     or has_function_privilege('service_role', 'public.alerta_sat_eventos(uuid, timestamptz, int)', 'execute') then
    raise exception 'T0 FALHOU: alerta_sat_eventos executavel de fora';
  end if;
  -- as 3 policies das regras com a perna do SAT, em InitPlan
  select count(*) into v from pg_policies
   where tablename = 'alerta_regras'
     and policyname in ('alerta_regras_select_admin', 'alerta_regras_insert_admin', 'alerta_regras_update_admin')
     and coalesce(qual, '') || coalesce(with_check, '') like '%(modulo = ''sat''::text) AND ( SELECT tem_permissao(''sat''::text, ''administrar''::text)%';
  if v <> 3 then raise exception 'T0 FALHOU: % de 3 policies das regras com a perna do SAT', v; end if;

  -- a tela: lista de responsáveis do SAT (só quem administra o SAT) e ocorrências vazias, sem estourar
  if (select count(*) from public.alerta_destinatarios('sat')) <> 2 then
    raise exception 'T0 FALHOU: alerta_destinatarios(sat) = % (esperado Dora e Eva)',
      (select count(*) from public.alerta_destinatarios('sat'));
  end if;
  if exists (select 1 from public.alerta_destinatarios('sat') where usuario_id = '00000000-0000-0000-0000-0000000000b1') then
    raise exception 'T0 FALHOU: Beto (so Recebimento) oferecido no SAT';
  end if;
  perform * from public.alerta_listar_ocorrencias(now() - interval '1 day', now(), '', 'sat');
end $t$;
-- sem sat.administrar, a lista de responsáveis do SAT é recusada
do $t$
begin
  perform set_config('teste.perms', 'shopfloor.administrar', true);
  begin
    perform * from public.alerta_destinatarios('sat');
    raise exception 'T0 FALHOU: alerta_destinatarios(sat) sem sat.administrar';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
end $t$;
\echo 'T0 (esquema, checks, RLS, tela): ok'

-- ---------- T1: sem regra ativa, nada ----------
select public.teste_nf('NF-T1', array['NS-T1']);
select public.teste_avaliar();
do $t$
begin
  if (select count(*) from public.alerta_envios where tipo = 'sat_entrada') <> 0 then
    raise exception 'T1 FALHOU: aviso de SAT sem regra ativa';
  end if;
end $t$;
\echo 'T1 (sem regra, ninguem recebe): ok'

-- ---------- T2: regra ativa, registrar NF ----------
select public.teste_regra_sat('SAT entrada');
-- (a NF-T1 é de DEPOIS do criado_em da regra, que é 1 h atrás: ela também avisa — é a mesma rodada.)
select public.teste_nf('NF-T2', array['NS-A', 'NS-B']);
select public.teste_avaliar();
do $t$
declare d jsonb;
begin
  if public.teste_envios_sat('SAT entrada') <> 2 then
    raise exception 'T2 FALHOU: % avisos (esperado 2: NF-T1 e NF-T2, um cada para a Dora)',
      public.teste_envios_sat('SAT entrada');
  end if;
  select dados into d from public.alerta_envios
   where tipo = 'sat_entrada' and dados->>'numero_para' = 'NF-T2';
  if d is null then raise exception 'T2 FALHOU: sem aviso da NF-T2'; end if;
  if d->>'evento' <> 'entrada' or d->>'empresa' <> 'CLIENTE FICTICIO' or d->>'cnpj' <> '12.345.678/0001-90'
     or d->>'situacao_para' <> 'aprovada' or d->>'numero_de' <> '' or d->>'regra_tipo' <> 'sat_entrada'
     or jsonb_array_length(d->'ns') <> 2 or jsonb_array_length(d->'motivos') <> 0 then
    raise exception 'T2 FALHOU: dados errados %', d;
  end if;
  if not exists (select 1 from public.alerta_envios
                  where tipo = 'sat_entrada' and dados->>'numero_para' = 'NF-T2'
                    and usuario_id = '00000000-0000-0000-0000-0000000000d1' and canal = 'telegram'
                    and modulo = 'sat' and ocorrencia_id is null and not com_botao and destino_tipo = 'usuario') then
    raise exception 'T2 FALHOU: linha da fila com forma errada';
  end if;
  if (select count(*) from public.alerta_sat_avisada a join public.alerta_regras r on r.id = a.regra_id
       where r.nome = 'SAT entrada') <> 2 then
    raise exception 'T2 FALHOU: marca nao gravada';
  end if;
end $t$;
-- a rodada seguinte não repete
select public.teste_avaliar();
do $t$
begin
  if public.teste_envios_sat('SAT entrada') <> 2 then
    raise exception 'T2 FALHOU: aviso repetido na rodada seguinte (%)', public.teste_envios_sat('SAT entrada');
  end if;
end $t$;
\echo 'T2 (registrar NF: um aviso por nota por responsavel, uma vez so): ok'

-- ---------- T3: corrigir a NF ----------
select public.sat_corrigir_nf(
  (select id from public.sat_nfs where numero = 'NF-T2'), 'reprovada',
  array[(select id from public.sat_motivos_nf where texto = 'CFOP errado')], null);
select public.teste_avaliar();
do $t$
declare d jsonb;
begin
  if public.teste_envios_sat('SAT entrada') <> 3 then
    raise exception 'T3 FALHOU: % avisos (esperado 3)', public.teste_envios_sat('SAT entrada');
  end if;
  select dados into d from public.alerta_envios where tipo = 'sat_entrada' and dados->>'evento' = 'correcao';
  if d->>'numero_de' <> 'NF-T2' or d->>'numero_para' <> 'NF-T2' or d->>'situacao_de' <> 'aprovada'
     or d->>'situacao_para' <> 'reprovada' or d->'motivos' <> '["CFOP errado"]'::jsonb
     or d->>'empresa' <> 'CLIENTE FICTICIO' or jsonb_array_length(d->'ns') <> 2 then
    raise exception 'T3 FALHOU: dados errados %', d;
  end if;
end $t$;
\echo 'T3 (corrigir NF avisa): ok'

-- ---------- T4: trocar a NF ----------
select public.sat_trocar_nf((select id from public.sat_nfs where numero = 'NF-T2'), jsonb_build_object(
  'numero', 'NF-T4', 'cnpj', '98765432000110', 'empresa', 'OUTRA EMPRESA', 'valor', '',
  'situacao', 'aprovada', 'motivos', '[]'::jsonb));
select public.teste_avaliar();
do $t$
declare d jsonb;
begin
  if public.teste_envios_sat('SAT entrada') <> 4 then
    raise exception 'T4 FALHOU: % avisos (esperado 4)', public.teste_envios_sat('SAT entrada');
  end if;
  select dados into d from public.alerta_envios where tipo = 'sat_entrada' and dados->>'evento' = 'troca';
  if d->>'numero_de' <> 'NF-T2' or d->>'numero_para' <> 'NF-T4' or d->>'situacao_de' <> 'reprovada'
     or d->>'situacao_para' <> 'aprovada' or d->>'empresa' <> 'OUTRA EMPRESA' or d->>'cnpj' <> '98.765.432/0001-10' then
    raise exception 'T4 FALHOU: dados errados %', d;
  end if;
end $t$;
\echo 'T4 (trocar NF avisa): ok'

-- ---------- T5: responsável sem sat.administrar fica de fora; canal ganha UMA linha ----------
update public.alerta_regras set ativa = false where nome = 'SAT entrada';
select public.teste_regra_sat('SAT canal',
  array['00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1']::uuid[],
  now() + interval '1 second', true);
select pg_sleep(1.2);   -- o piso: só os eventos daqui em diante
select public.teste_nf('NF-T5', array['NS-T5']);
select public.teste_avaliar('CANAL-SAT');
do $t$
begin
  if public.teste_envios_sat('SAT canal') <> 2 then
    raise exception 'T5 FALHOU: % linhas (esperado 2: Dora + canal)', public.teste_envios_sat('SAT canal');
  end if;
  if exists (select 1 from public.alerta_envios
              where tipo = 'sat_entrada' and usuario_id = '00000000-0000-0000-0000-0000000000b1') then
    raise exception 'T5 FALHOU: Beto (nao administra o SAT) recebeu';
  end if;
  if (select count(*) from public.alerta_envios
       where tipo = 'sat_entrada' and dados->>'regra_nome' = 'SAT canal'
         and destino_tipo = 'canal' and destino_externo_id = 'CANAL-SAT' and usuario_id is null) <> 1 then
    raise exception 'T5 FALHOU: linha do canal';
  end if;
end $t$;
\echo 'T5 (so quem administra o SAT; canal uma linha): ok'

-- ---------- T6: regra desativada não avisa ----------
update public.alerta_regras set ativa = false where nome = 'SAT canal';
select public.teste_nf('NF-T6', array['NS-T6']);
select public.teste_avaliar();
do $t$
begin
  if exists (select 1 from public.alerta_envios where tipo = 'sat_entrada' and dados->>'numero_para' = 'NF-T6') then
    raise exception 'T6 FALHOU: regra desativada avisou';
  end if;
end $t$;
\echo 'T6 (regra desativada, nada): ok'

-- ---------- T7: o piso ----------
-- Regra criada DEPOIS da NF-T6: a NF-T6 não avisa; a NF-T7 (depois da regra) avisa.
select public.teste_regra_sat('SAT piso', p_criado_em => now() + interval '1 second');
select pg_sleep(1.2);
select public.teste_nf('NF-T7', array['NS-T7']);
select public.teste_avaliar();
do $t$
begin
  if exists (select 1 from public.alerta_envios
              where tipo = 'sat_entrada' and dados->>'regra_nome' = 'SAT piso' and dados->>'numero_para' = 'NF-T6') then
    raise exception 'T7 FALHOU: evento anterior a regra avisou';
  end if;
  if public.teste_envios_sat('SAT piso') <> 1 then
    raise exception 'T7 FALHOU: % avisos (esperado 1, so a NF-T7)', public.teste_envios_sat('SAT piso');
  end if;
end $t$;
update public.alerta_regras set ativa = false where nome = 'SAT piso';
\echo 'T7 (piso criado_em): ok'

-- ---------- T8: ninguém alcançável ----------
select public.teste_regra_sat('SAT Eva', array['00000000-0000-0000-0000-0000000000e1']::uuid[],
  now() + interval '1 second');
select pg_sleep(1.2);
select public.teste_nf('NF-T8', array['NS-T8']);
select public.teste_avaliar();
do $t$
begin
  if public.teste_envios_sat('SAT Eva') <> 0 then raise exception 'T8 FALHOU: aviso sem conta vinculada'; end if;
  if exists (select 1 from public.alerta_sat_avisada a join public.alerta_regras r on r.id = a.regra_id
              where r.nome = 'SAT Eva') then
    raise exception 'T8 FALHOU: marca gravada sem ninguem alcancavel';
  end if;
end $t$;
insert into public.alerta_contas (usuario_id, canal, externo_id)
values ('00000000-0000-0000-0000-0000000000e1', 'telegram', 'TG-EVA');
select public.teste_avaliar();
do $t$
begin
  if public.teste_envios_sat('SAT Eva') <> 1 then
    raise exception 'T8 FALHOU: depois de vincular, % avisos (esperado 1)', public.teste_envios_sat('SAT Eva');
  end if;
end $t$;
\echo 'T8 (ninguem alcancavel: sem marca; vinculou, sai): ok'

-- ---------- T9: troca de OS não avisa ----------
insert into public.sat_historico (nf_id, entrada_id, tipo, de, para, usuario_nome)
select e.nf_id, e.id, 'os', jsonb_build_object('os', ''), jsonb_build_object('os', '90001'), 'Dora SAT'
  from public.sat_entradas e where e.ns_escrito = 'NS-T8';
select public.teste_avaliar();
do $t$
begin
  if public.teste_envios_sat('SAT Eva') <> 1 then
    raise exception 'T9 FALHOU: troca de OS avisou (%)', public.teste_envios_sat('SAT Eva');
  end if;
end $t$;
\echo 'T9 (troca de OS nao avisa): ok'

-- ---------- T10: fora do caminho da ocorrência ----------
do $t$
begin
  if exists (select 1 from public.alerta_ocorrencias oc join public.alerta_regras r on r.id = oc.regra_id
              where r.modulo = 'sat') then
    raise exception 'T10 FALHOU: regra do SAT abriu ocorrencia';
  end if;
end $t$;
\echo 'T10 (sem ocorrencia): ok'
\echo 'ALERTAS SAT (0192): ok'
