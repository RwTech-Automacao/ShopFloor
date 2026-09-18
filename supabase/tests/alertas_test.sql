-- Testes SQL dos alertas de taxa de aprovação. Rodar com supabase/tests/rodar-alertas-test.sh
-- (Postgres descartável em Docker). Pré-requisito (feito pelo runner, nesta ordem, na mesma
-- base): supabase/tests/_stubs.sql -> 0113_alertas.sql (com psql -1, como no RDS) ->
-- 0114_sf_registros_posto_data_idx.sql -> este arquivo.

-- Imita os privilégios padrão de tabela do Supabase Dev (tudo liberado pro authenticated/anon),
-- deixando SÓ o RLS como barreira real. Se algum teste de segurança abaixo só passa por causa de
-- um `grant` estreito, essa linha estoura ele.
grant all on all tables in schema public to anon, authenticated;

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);

-- Ajuda dos testes: gera bipes de um posto numa OP, N minutos atrás.
create function public.teste_bipes(
  p_posto text, p_pmo text, p_op text, p_aprovados int, p_reprovados int, p_minutos_atras int
) returns void language sql as $f$
  insert into public.sf_registros (data_hora, posto, pmo, op, status)
  select now() - make_interval(mins => p_minutos_atras) - make_interval(secs => g),
         p_posto, p_pmo, p_op, 'Aprovado'
    from generate_series(1, p_aprovados) g;
  insert into public.sf_registros (data_hora, posto, pmo, op, status)
  select now() - make_interval(mins => p_minutos_atras) - make_interval(secs => g),
         p_posto, p_pmo, p_op, 'REPROVADO'
    from generate_series(1, p_reprovados) g;
$f$;

-- 1. Código de vínculo: formato, invalidação do anterior, uso único, expiração (tudo
--    CODIGO_INVALIDO, de propósito — não dá pra saber de fora se o código chegou perto).
do $t$
declare r1 jsonb; r2 jsonb; v jsonb;
begin
  r1 := alerta_gerar_codigo();
  if (r1->>'codigo') !~ '^ALERTA-[A-Z2-9]{4}$' then
    raise exception 'FALHOU: formato do código %', r1;
  end if;
  if (r1->>'expira_em')::timestamptz <= now() then raise exception 'FALHOU: expiração no passado'; end if;

  r2 := alerta_gerar_codigo();
  if (r1->>'codigo') <> (r2->>'codigo')
     and exists (select 1 from alerta_codigos where codigo = r1->>'codigo') then
    raise exception 'FALHOU: código anterior não invalidado';
  end if;

  -- caixa baixa é aceita (a pessoa digita como quiser)
  v := alerta_vincular(lower(r2->>'codigo'), 'telegram', '111');
  if not coalesce((v->>'ok')::boolean, false) or (v->>'nome') <> 'Ana Gestora' then
    raise exception 'FALHOU: vínculo %', v;
  end if;
  if not exists (select 1 from alerta_contas
                  where usuario_id = '00000000-0000-0000-0000-000000000001'
                    and canal = 'telegram' and externo_id = '111') then
    raise exception 'FALHOU: conta não gravada';
  end if;

  -- código já usado
  v := alerta_vincular(r2->>'codigo', 'telegram', '111');
  if coalesce((v->>'ok')::boolean, true) or (v->>'erro') <> 'CODIGO_INVALIDO' then
    raise exception 'FALHOU: código usado duas vezes deu %', v;
  end if;

  -- expirado
  r1 := alerta_gerar_codigo();
  update alerta_codigos set expira_em = now() - interval '1 minute' where codigo = r1->>'codigo';
  v := alerta_vincular(r1->>'codigo', 'telegram', '113');
  if coalesce((v->>'ok')::boolean, true) or (v->>'erro') <> 'CODIGO_INVALIDO' then
    raise exception 'FALHOU: código expirado deu %', v;
  end if;

  -- canal inválido
  r1 := alerta_gerar_codigo();
  v := alerta_vincular(r1->>'codigo', 'whatsapp', '999');
  if coalesce((v->>'ok')::boolean, true) or (v->>'erro') <> 'CANAL_INVALIDO' then
    raise exception 'FALHOU: canal inválido deu %', v;
  end if;

  -- mesmo usuário troca de chat: atualiza a linha (sem duplicar)
  r1 := alerta_gerar_codigo();
  perform alerta_vincular(r1->>'codigo', 'telegram', '112');
  if (select count(*) from alerta_contas
       where usuario_id = '00000000-0000-0000-0000-000000000001' and canal = 'telegram') <> 1 then
    raise exception 'FALHOU: vínculo duplicado no mesmo canal';
  end if;
  if (select externo_id from alerta_contas
       where usuario_id = '00000000-0000-0000-0000-000000000001' and canal = 'telegram') <> '112' then
    raise exception 'FALHOU: externo_id não atualizou';
  end if;

  -- discord da Ana
  r1 := alerta_gerar_codigo();
  perform alerta_vincular(r1->>'codigo', 'discord', 'D1');
end $t$;

-- Bruno: telegram 222 + discord D2. Carla: nada (fica sem canal, de propósito).
select set_config('teste.uid', '00000000-0000-0000-0000-000000000002', false);
do $t$
declare r jsonb; v jsonb;
begin
  r := alerta_gerar_codigo();
  perform alerta_vincular(r->>'codigo', 'telegram', '222');
  r := alerta_gerar_codigo();
  perform alerta_vincular(r->>'codigo', 'discord', 'D2');

  -- id externo de OUTRO usuário não pode ser roubado
  r := alerta_gerar_codigo();
  v := alerta_vincular(r->>'codigo', 'telegram', '112');
  if coalesce((v->>'ok')::boolean, true) or (v->>'erro') <> 'CONTA_JA_VINCULADA' then
    raise exception 'FALHOU: externo_id de outro usuário aceito: %', v;
  end if;
end $t$;

-- 2. Grants: alerta_vincular é só do servidor (service_role).
set role authenticated;
do $t$
begin
  begin
    perform alerta_vincular('ALERTA-AAAA', 'telegram', '999');
    raise exception 'FALHOU: authenticated executou alerta_vincular';
  exception when insufficient_privilege then
    null;
  end;
end $t$;

-- 3. RLS de alerta_contas: cada um vê e apaga só a própria linha.
do $t$
declare n int;
begin
  select count(*) into n from alerta_contas;   -- teste.uid = Bruno
  if n <> 2 then raise exception 'FALHOU: RLS de contas mostrou % linhas', n; end if;
  delete from alerta_contas where canal = 'discord';
  if exists (select 1 from alerta_contas where canal = 'discord') then
    raise exception 'FALHOU: delete da própria conta';
  end if;
end $t$;
reset role;

-- devolve o discord do Bruno pro resto dos testes
insert into public.alerta_contas (usuario_id, canal, externo_id)
values ('00000000-0000-0000-0000-000000000002', 'discord', 'D2');

-- 3b. Mesmo com o `grant all` do topo do arquivo (padrão do Supabase Dev), sem policy de
--     insert/update em alerta_contas o RLS barra tudo.
set role authenticated;
do $t$
begin
  begin
    insert into alerta_contas (usuario_id, canal, externo_id)
    values ('00000000-0000-0000-0000-000000000002', 'telegram', 'hack-insert');
    raise exception 'FALHOU: authenticated conseguiu inserir em alerta_contas';
  exception when insufficient_privilege then
    null;
  end;
end $t$;
do $t$
declare n int;
begin
  -- sem policy de update, a USING implícita é `false`: não dá erro, só não afeta nenhuma linha
  update alerta_contas set externo_id = 'hack-update' where canal = 'telegram';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: authenticated atualizou % linha(s) de alerta_contas', n; end if;
end $t$;

-- 3c. SELECT de alerta_codigos de outro usuário (Ana) não vaza pro Bruno.
do $t$
declare n int;
begin
  select count(*) into n from alerta_codigos
   where usuario_id = '00000000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'FALHOU: RLS de alerta_codigos vazou % linha(s) de outro usuário', n; end if;
end $t$;
reset role;

-- 3d. DELETE de alerta_codigos: sem policy de delete, RLS barra tudo — a linha do outro usuário
--     continua existindo depois do reset role.
do $t$
begin
  if not exists (select 1 from alerta_codigos where usuario_id <> '00000000-0000-0000-0000-000000000002') then
    raise exception 'FALHOU: sem código de outro usuário pra testar o delete';
  end if;
end $t$;
set role authenticated;
delete from alerta_codigos where usuario_id <> '00000000-0000-0000-0000-000000000002';
reset role;
do $t$
begin
  if not exists (select 1 from alerta_codigos where usuario_id <> '00000000-0000-0000-0000-000000000002') then
    raise exception 'FALHOU: authenticated apagou código(s) de outro usuário';
  end if;
end $t$;

-- 3e. authenticated consegue chamar alerta_gerar_codigo; anon não.
set role authenticated;
do $t$
begin
  perform alerta_gerar_codigo();
end $t$;
reset role;
set role anon;
do $t$
begin
  begin
    perform alerta_gerar_codigo();
    raise exception 'FALHOU: anon executou alerta_gerar_codigo';
  exception when insufficient_privilege then
    null;
  end;
end $t$;
reset role;

-- 4. RLS de alerta_regras: precisa de shopfloor.administrar.
insert into public.alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
                                  lembrete_min, canais, destinatarios, criado_por)
values ('Regra RLS', array['Teste'], 90, 'tempo', 60, 20, null, array['telegram'],
        array['00000000-0000-0000-0000-000000000001']::uuid[],
        '00000000-0000-0000-0000-000000000001');

set role authenticated;
select set_config('teste.perms', 'shopfloor.visualizar', false);
do $t$
begin
  if exists (select 1 from alerta_regras) then raise exception 'FALHOU: regra visível sem administrar'; end if;
  begin
    insert into alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, canais, destinatarios)
    values ('Intrusa', array['Teste'], 90, 'tempo', 60, array['telegram'],
            array['00000000-0000-0000-0000-000000000001']::uuid[]);
    raise exception 'FALHOU: insert de regra sem administrar';
  exception when insufficient_privilege then
    null;
  end;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);
do $t$
begin
  if not exists (select 1 from alerta_regras where nome = 'Regra RLS') then
    raise exception 'FALHOU: admin não vê a regra';
  end if;
end $t$;
reset role;
delete from public.alerta_regras where nome = 'Regra RLS';

-- 5. Índice do sf_registros criado pela 0114.
do $t$
begin
  if not exists (select 1 from pg_indexes where indexname = 'sf_registros_posto_data_hora') then
    raise exception 'FALHOU: índice (posto, data_hora desc) não existe';
  end if;
end $t$;

-- 6. Força bruta: 5 falhas seguidas do mesmo (canal, externo_id) travam por 15 min — mesmo
--    chegando um código CERTO na 6ª tentativa. As tentativas ficam gravadas.
select set_config('teste.uid', '00000000-0000-0000-0000-000000000003', false); -- Carla
do $t$
declare v jsonb; r jsonb; i int; n int;
begin
  for i in 1..5 loop
    v := alerta_vincular('ALERTA-ZZZZ', 'telegram', 'BF1');
    if coalesce((v->>'ok')::boolean, true) or (v->>'erro') <> 'CODIGO_INVALIDO' then
      raise exception 'FALHOU: tentativa % de força bruta deu %', i, v;
    end if;
  end loop;

  select count(*) into n from alerta_tentativas where canal = 'telegram' and externo_id = 'BF1';
  if n <> 5 then raise exception 'FALHOU: % tentativa(s) gravada(s), esperava 5', n; end if;

  r := alerta_gerar_codigo();
  v := alerta_vincular(r->>'codigo', 'telegram', 'BF1');
  if coalesce((v->>'ok')::boolean, true) or (v->>'erro') <> 'MUITAS_TENTATIVAS' then
    raise exception 'FALHOU: não travou depois de 5 falhas (código certo): %', v;
  end if;

  if exists (select 1 from alerta_contas
              where usuario_id = '00000000-0000-0000-0000-000000000003' and canal = 'telegram') then
    raise exception 'FALHOU: vínculo travado mesmo assim gravou conta';
  end if;
end $t$;

-- 6b. authenticated não lê nem escreve em alerta_tentativas (RLS ligado, sem policy nenhuma;
--     o `grant all` do topo não adianta nada aqui).
set role authenticated;
do $t$
begin
  if exists (select 1 from alerta_tentativas) then
    raise exception 'FALHOU: authenticated leu alerta_tentativas';
  end if;
  begin
    insert into alerta_tentativas (canal, externo_id) values ('telegram', 'hack-tentativa');
    raise exception 'FALHOU: authenticated escreveu em alerta_tentativas';
  exception when insufficient_privilege then
    null;
  end;
end $t$;
reset role;

\echo 'ALERTAS: TABELAS/RLS/VINCULO OK'
