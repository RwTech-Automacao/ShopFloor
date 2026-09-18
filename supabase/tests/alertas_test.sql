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

-- 5b. Força bruta: 5 falhas seguidas do mesmo (canal, externo_id) travam por 15 min — mesmo
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

-- 5c. authenticated não lê nem escreve em alerta_tentativas (RLS ligado, sem policy nenhuma;
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

-- 5d. Ajustes da revisão da Task 2 no vínculo:
--     canal NULL devolve CANAL_INVALIDO (não estoura not_null_violation);
--     4 falhas + acerto -> as falhas são apagadas;
--     falhas com mais de 15 min não contam pro bloqueio;
--     alerta_gerar_codigo limpa tentativas com mais de 1 dia.
--     (Carla vincula de propósito aqui e a conta é apagada no fim: a seção 16 conta com ela sem canais.)
do $t$
declare v jsonb; r jsonb; i int; n int;
begin
  v := alerta_vincular('ALERTA-ZZZZ', null, 'NUL1');
  if coalesce((v->>'ok')::boolean, true) or (v->>'erro') <> 'CANAL_INVALIDO' then
    raise exception 'FALHOU: canal NULL deu %', v;
  end if;

  for i in 1..4 loop
    v := alerta_vincular('ALERTA-ZZZZ', 'telegram', 'BF2');
    if (v->>'erro') <> 'CODIGO_INVALIDO' then raise exception 'FALHOU: falha % do BF2 deu %', i, v; end if;
  end loop;
  r := alerta_gerar_codigo();
  v := alerta_vincular(r->>'codigo', 'telegram', 'BF2');
  if not coalesce((v->>'ok')::boolean, false) then raise exception 'FALHOU: acerto depois de 4 falhas deu %', v; end if;
  select count(*) into n from alerta_tentativas where canal = 'telegram' and externo_id = 'BF2';
  if n <> 0 then raise exception 'FALHOU: acerto não apagou as % falha(s)', n; end if;

  insert into alerta_tentativas (canal, externo_id, em)
  select 'discord', 'BF3', now() - interval '16 minutes' from generate_series(1, 5);
  r := alerta_gerar_codigo();
  v := alerta_vincular(r->>'codigo', 'discord', 'BF3');
  if not coalesce((v->>'ok')::boolean, false) then
    raise exception 'FALHOU: falhas com mais de 15 min ainda bloquearam: %', v;
  end if;

  insert into alerta_tentativas (canal, externo_id, em) values ('telegram', 'VELHA', now() - interval '2 days');
  insert into alerta_tentativas (canal, externo_id, em) values ('telegram', 'RECENTE', now() - interval '1 hour');
  perform alerta_gerar_codigo();
  if exists (select 1 from alerta_tentativas where externo_id = 'VELHA') then
    raise exception 'FALHOU: tentativa com mais de 1 dia não foi limpa';
  end if;
  if not exists (select 1 from alerta_tentativas where externo_id = 'RECENTE') then
    raise exception 'FALHOU: limpeza apagou tentativa recente';
  end if;
  delete from alerta_tentativas where externo_id = 'RECENTE';

  delete from alerta_contas where usuario_id = '00000000-0000-0000-0000-000000000003';
end $t$;

-- 6. Janela `tempo`: só bipes aprovado/reprovado da última hora contam.
insert into public.alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
                                  lembrete_min, canais, destinatarios, criado_por)
values ('Teste abaixo de 90', array['Teste'], 90, 'tempo', 60, 20, 10,
        array['telegram', 'discord'],
        array['00000000-0000-0000-0000-000000000001',
              '00000000-0000-0000-0000-000000000002']::uuid[],
        '00000000-0000-0000-0000-000000000001');

select public.teste_bipes('Teste', 'PMOA', '1001', 15, 5, 10);    -- 75% na janela
select public.teste_bipes('Teste', 'PMOA', '1001', 100, 0, 180);  -- fora da janela (3 h atrás)
insert into public.sf_registros (data_hora, posto, pmo, op, status)
select now(), 'Teste', 'PMOA', '1001', 'Registrado' from generate_series(1, 30);  -- sem status de aprovação

create function public.teste_acao(p_r jsonb, p_regra text, p_posto text) returns jsonb language sql as $f$
  select x from jsonb_array_elements(p_r->'acoes') x
   where x->>'regra_nome' = p_regra and x->>'posto' = p_posto
   limit 1
$f$;

set role service_role;
do $t$
declare r jsonb; a jsonb;
begin
  r := alerta_avaliar();
  if (r->>'ocupado')::boolean is not false then raise exception 'FALHOU: trava presa %', r; end if;
  a := teste_acao(r, 'Teste abaixo de 90', 'Teste');
  if a is null then raise exception 'FALHOU: sem ação de alerta %', r; end if;
  if a->>'tipo' <> 'alerta' then raise exception 'FALHOU: tipo % ', a; end if;
  if (a->>'aprovados')::int <> 15 or (a->>'reprovados')::int <> 5 then
    raise exception 'FALHOU: contagem da janela tempo %', a;
  end if;
  if (a->>'taxa')::numeric <> 75.00 then raise exception 'FALHOU: taxa %', a; end if;
  -- 2 destinatários x 2 canais, todos vinculados
  if jsonb_array_length(a->'contas') <> 4 then raise exception 'FALHOU: contas %', a->'contas'; end if;
  if (select count(*) from alerta_ocorrencias where estado = 'aberta' and posto = 'Teste') <> 1 then
    raise exception 'FALHOU: ocorrência não abriu';
  end if;
end $t$;

-- 7. Reavaliação: nada de novo antes do lembrete; depois do intervalo, lembrete.
do $t$
declare r jsonb;
begin
  r := alerta_avaliar();
  if teste_acao(r, 'Teste abaixo de 90', 'Teste') is not null then
    raise exception 'FALHOU: lembrete antes da hora %', r;
  end if;
end $t$;
reset role;
update public.alerta_ocorrencias set ultimo_envio_em = now() - interval '11 minutes',
                                     aberta_em = now() - interval '11 minutes'
 where posto = 'Teste' and estado = 'aberta';
set role service_role;
do $t$
declare r jsonb; a jsonb;
begin
  r := alerta_avaliar();
  a := teste_acao(r, 'Teste abaixo de 90', 'Teste');
  if a is null or a->>'tipo' <> 'lembrete' then raise exception 'FALHOU: lembrete %', r; end if;
end $t$;

-- 8. Índice único: não dá pra abrir uma segunda ocorrência viva na mesma regra x posto.
reset role;
do $t$
declare g uuid;
begin
  select regra_id into g from alerta_ocorrencias where posto = 'Teste' and estado = 'aberta';
  begin
    insert into alerta_ocorrencias (regra_id, posto, taxa_abertura, taxa_ultima) values (g, 'Teste', 10, 10);
    raise exception 'FALHOU: duas ocorrências vivas na mesma regra x posto';
  exception when unique_violation then
    null;
  end;
end $t$;

-- 9. Resolver: só destinatário, idempotente, e não manda mais lembrete.
set role service_role;
do $t$
declare oc uuid; r jsonb;
begin
  select id into oc from alerta_ocorrencias where posto = 'Teste' and estado = 'aberta';

  begin
    perform alerta_resolver(oc, '00000000-0000-0000-0000-000000000003');
    raise exception 'FALHOU: quem não é destinatário resolveu';
  exception when others then
    if sqlerrm not like '%NAO_DESTINATARIO%' then raise; end if;
  end;

  r := alerta_resolver(oc, '00000000-0000-0000-0000-000000000002');
  if (r->>'ja_resolvida')::boolean is not false then raise exception 'FALHOU: primeira resolução %', r; end if;
  if r->>'resolvida_por_nome' <> 'Bruno Líder' then raise exception 'FALHOU: nome de quem resolveu %', r; end if;
  if r->>'posto' <> 'Teste' then raise exception 'FALHOU: posto na resolução %', r; end if;

  r := alerta_resolver(oc, '00000000-0000-0000-0000-000000000001');
  if (r->>'ja_resolvida')::boolean is not true then raise exception 'FALHOU: idempotência %', r; end if;
  if r->>'resolvida_por_nome' <> 'Bruno Líder' then raise exception 'FALHOU: idempotência trocou o autor %', r; end if;

  if (select estado from alerta_ocorrencias where id = oc) <> 'resolvida' then
    raise exception 'FALHOU: estado após resolver';
  end if;
end $t$;
reset role;
update public.alerta_ocorrencias set ultimo_envio_em = now() - interval '30 minutes'
 where posto = 'Teste' and estado = 'resolvida';
set role service_role;
do $t$
declare r jsonb;
begin
  r := alerta_avaliar();
  if teste_acao(r, 'Teste abaixo de 90', 'Teste') is not null then
    raise exception 'FALHOU: ocorrência resolvida ainda manda lembrete %', r;
  end if;
end $t$;

-- 10. Normalizou: taxa volta pra meta -> normalizada + envio; se cair de novo, ocorrência NOVA.
reset role;
select public.teste_bipes('Teste', 'PMOA', '1001', 400, 0, 1);
set role service_role;
do $t$
declare r jsonb; a jsonb;
begin
  r := alerta_avaliar();
  a := teste_acao(r, 'Teste abaixo de 90', 'Teste');
  if a is null or a->>'tipo' <> 'normalizou' then raise exception 'FALHOU: normalizou %', r; end if;
  if (select count(*) from alerta_ocorrencias where posto = 'Teste' and estado in ('aberta', 'resolvida')) <> 0 then
    raise exception 'FALHOU: ocorrência continuou viva';
  end if;
end $t$;
reset role;
select public.teste_bipes('Teste', 'PMOA', '1001', 0, 600, 0);
set role service_role;
do $t$
declare r jsonb; a jsonb;
begin
  r := alerta_avaliar();
  a := teste_acao(r, 'Teste abaixo de 90', 'Teste');
  if a is null or a->>'tipo' <> 'alerta' then raise exception 'FALHOU: nova ocorrência depois de normalizar %', r; end if;
  if (select count(*) from alerta_ocorrencias where posto = 'Teste') <> 2 then
    raise exception 'FALHOU: deveria haver 2 ocorrências no histórico do posto Teste';
  end if;
end $t$;
reset role;
-- desliga a regra do posto Teste pra ela não poluir as seções seguintes
update public.alerta_regras set ativa = false where nome = 'Teste abaixo de 90';

-- 11. Mínimo de bipes: 19 bipes não decidem nada.
insert into public.alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
                                  canais, destinatarios, criado_por)
values ('Mínimo', array['Inspeção'], 90, 'tempo', 60, 20, array['telegram'],
        array['00000000-0000-0000-0000-000000000001']::uuid[],
        '00000000-0000-0000-0000-000000000001');
select public.teste_bipes('Inspeção', 'PMOA', '1001', 9, 10, 5);   -- 19 bipes, 47%
set role service_role;
do $t$
declare r jsonb;
begin
  r := alerta_avaliar();
  if teste_acao(r, 'Mínimo', 'Inspeção') is not null then raise exception 'FALHOU: avaliou sem o mínimo %', r; end if;
  if exists (select 1 from alerta_ocorrencias where posto = 'Inspeção') then
    raise exception 'FALHOU: abriu ocorrência sem o mínimo';
  end if;
end $t$;
reset role;
select public.teste_bipes('Inspeção', 'PMOA', '1001', 1, 0, 5);    -- 20º bipe
set role service_role;
do $t$
declare r jsonb; a jsonb;
begin
  r := alerta_avaliar();
  a := teste_acao(r, 'Mínimo', 'Inspeção');
  if a is null or a->>'tipo' <> 'alerta' then raise exception 'FALHOU: 20 bipes deveriam avaliar %', r; end if;
  if (a->>'aprovados')::int <> 10 or (a->>'reprovados')::int <> 10 then
    raise exception 'FALHOU: contagem no mínimo %', a;
  end if;
end $t$;
reset role;
update public.alerta_regras set ativa = false where nome = 'Mínimo';

-- 12. Janela `bipes`: só os N últimos bipes com status contam.
insert into public.alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
                                  canais, destinatarios, criado_por)
values ('Bipes', array['Montagem'], 80, 'bipes', 50, 20, array['telegram'],
        array['00000000-0000-0000-0000-000000000001']::uuid[],
        '00000000-0000-0000-0000-000000000001');
select public.teste_bipes('Montagem', 'PMOA', '1001', 0, 60, 300);  -- antigos, fora dos 50 últimos
select public.teste_bipes('Montagem', 'PMOA', '1001', 50, 0, 5);    -- os 50 últimos: 100%
set role service_role;
do $t$
declare r jsonb;
begin
  r := alerta_avaliar();
  if teste_acao(r, 'Bipes', 'Montagem') is not null then
    raise exception 'FALHOU: janela de bipes olhou além dos 50 %', r;
  end if;
end $t$;
reset role;
select public.teste_bipes('Montagem', 'PMOB', '2001', 0, 30, 0);    -- 30 reprovas mais recentes
set role service_role;
do $t$
declare r jsonb; a jsonb;
begin
  r := alerta_avaliar();
  a := teste_acao(r, 'Bipes', 'Montagem');
  if a is null or a->>'tipo' <> 'alerta' then raise exception 'FALHOU: janela de bipes %', r; end if;
  if (a->>'aprovados')::int <> 20 or (a->>'reprovados')::int <> 30 then
    raise exception 'FALHOU: os 50 últimos deveriam ser 20 aprovados / 30 reprovados %', a;
  end if;
end $t$;

-- 13. Regra desativada e posto removido: ocorrência viva vira normalizada SEM envio.
reset role;
update public.alerta_regras set ativa = false where nome = 'Bipes';
set role service_role;
do $t$
declare r jsonb;
begin
  r := alerta_avaliar();
  if teste_acao(r, 'Bipes', 'Montagem') is not null then raise exception 'FALHOU: regra desativada avisou %', r; end if;
  if exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
              where rg.nome = 'Bipes' and oc.estado in ('aberta', 'resolvida')) then
    raise exception 'FALHOU: ocorrência de regra desativada continuou viva';
  end if;
end $t$;

-- 14. Janela `op`: OP do último bipe; bipe com mais de 2 h não avalia; OP nova normaliza.
reset role;
insert into public.alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
                                  canais, destinatarios, criado_por)
values ('OP', array['Embalagem', 'Inspeção Final'], 95, 'op', null, 20, array['telegram'],
        array['00000000-0000-0000-0000-000000000001']::uuid[],
        '00000000-0000-0000-0000-000000000001');
select public.teste_bipes('Embalagem', 'PMOB', '2001', 0, 50, 200);      -- OP antiga
select public.teste_bipes('Embalagem', 'PMOB', '2002', 18, 2, 30);       -- OP em andamento: 90%
select public.teste_bipes('Inspeção Final', 'PMOB', '2001', 0, 30, 150); -- último bipe com 2h30
set role service_role;
do $t$
declare r jsonb; a jsonb;
begin
  r := alerta_avaliar();
  a := teste_acao(r, 'OP', 'Embalagem');
  if a is null or a->>'tipo' <> 'alerta' then raise exception 'FALHOU: janela op %', r; end if;
  if a->>'op' <> '2002' or a->>'pmo' <> 'PMOB' then raise exception 'FALHOU: OP da janela %', a; end if;
  if (a->>'aprovados')::int <> 18 or (a->>'reprovados')::int <> 2 then
    raise exception 'FALHOU: contagem da OP %', a;
  end if;
  if teste_acao(r, 'OP', 'Inspeção Final') is not null then
    raise exception 'FALHOU: posto com último bipe de 2h30 foi avaliado %', r;
  end if;
  if (select op from alerta_ocorrencias where posto = 'Embalagem' and estado = 'aberta') <> '2002' then
    raise exception 'FALHOU: OP não gravada na ocorrência';
  end if;
end $t$;
reset role;
select public.teste_bipes('Embalagem', 'PMOB', '2003', 25, 0, 0);        -- OP nova, dentro da meta
set role service_role;
do $t$
declare r jsonb; a jsonb;
begin
  r := alerta_avaliar();
  a := teste_acao(r, 'OP', 'Embalagem');
  if a is null or a->>'tipo' <> 'normalizou' then raise exception 'FALHOU: OP nova deveria normalizar %', r; end if;
end $t$;
reset role;
update public.alerta_regras set ativa = false where nome = 'OP';

-- 15. alerta_previa: taxa atual sem gravar nada + gate de permissão.
set role authenticated;
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);
do $t$
declare n int; p record;
begin
  select count(*) into n from alerta_ocorrencias;
  select * into p from alerta_previa(array['Montagem', 'Posto Sem Bipe'], 'bipes', 50, 20)
   where posto = 'Montagem';
  if p.aprovados <> 20 or p.reprovados <> 30 then raise exception 'FALHOU: prévia %', p; end if;
  if p.taxa <> 40.00 or p.avaliavel is not true then raise exception 'FALHOU: taxa da prévia %', p; end if;
  select * into p from alerta_previa(array['Montagem', 'Posto Sem Bipe'], 'bipes', 50, 20)
   where posto = 'Posto Sem Bipe';
  if p.aprovados <> 0 or p.taxa is not null or p.avaliavel is not false then
    raise exception 'FALHOU: prévia de posto sem bipe %', p;
  end if;
  if (select count(*) from alerta_ocorrencias) <> n then raise exception 'FALHOU: prévia gravou ocorrência'; end if;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar', false);
do $t$
begin
  begin
    perform * from alerta_previa(array['Montagem'], 'tempo', 60, 20);
    raise exception 'FALHOU: prévia sem administrar';
  exception when others then
    if sqlerrm not like '%SEM_PERMISSAO%' then raise; end if;
  end;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);

-- 16. alerta_destinatarios: usuários ativos + quais canais cada um tem.
do $t$
declare d record;
begin
  if (select count(*) from alerta_destinatarios()) <> 3 then raise exception 'FALHOU: destinatários'; end if;
  select * into d from alerta_destinatarios() where usuario_id = '00000000-0000-0000-0000-000000000001';
  if d.telegram is not true or d.discord is not true then raise exception 'FALHOU: canais da Ana %', d; end if;
  select * into d from alerta_destinatarios() where usuario_id = '00000000-0000-0000-0000-000000000003';
  if d.telegram is not false or d.discord is not false then raise exception 'FALHOU: Carla sem canais %', d; end if;
end $t$;

-- 17. alerta_resolver_admin + alerta_listar_ocorrencias (com contagem de envios).
-- As avaliações das seções 12-14 encerraram a ocorrência da seção 11 (regra 'Mínimo' desativada):
-- reativa a regra e avalia de novo para ter uma ocorrência ABERTA de verdade aqui.
reset role;
update public.alerta_regras set ativa = true where nome = 'Mínimo';
set role service_role;
do $t$ begin perform alerta_avaliar(); end $t$;
reset role;

insert into public.alerta_envios (ocorrencia_id, usuario_id, canal, tipo, texto, ok, tentativas)
select id, '00000000-0000-0000-0000-000000000001', 'telegram', 'alerta', 'x', true, 1
  from public.alerta_ocorrencias where posto = 'Inspeção' and estado = 'aberta';
insert into public.alerta_envios (ocorrencia_id, usuario_id, canal, tipo, texto, ok, erro, tentativas)
select id, '00000000-0000-0000-0000-000000000002', 'discord', 'alerta', 'x', false, 'Discord 403', 1
  from public.alerta_ocorrencias where posto = 'Inspeção' and estado = 'aberta';

set role authenticated;
select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
do $t$
declare l record; oc uuid; r jsonb;
begin
  select * into l from alerta_listar_ocorrencias(now() - interval '1 day', now() + interval '1 day', 'aberta')
   where posto = 'Inspeção';
  if l.regra_nome <> 'Mínimo' then raise exception 'FALHOU: nome da regra na listagem %', l; end if;
  if l.envios_ok <> 1 or l.envios_falha <> 1 then raise exception 'FALHOU: contagem de envios %', l; end if;

  if exists (select 1 from alerta_listar_ocorrencias(now() - interval '1 day', now() + interval '1 day', 'normalizada')
              where estado <> 'normalizada') then
    raise exception 'FALHOU: filtro de estado';
  end if;

  select id into oc from alerta_ocorrencias where posto = 'Inspeção' and estado = 'aberta';
  r := alerta_resolver_admin(oc);
  if (r->>'ja_resolvida')::boolean is not false then raise exception 'FALHOU: resolver pela tela %', r; end if;
  if r->>'resolvida_por_nome' <> 'Ana Gestora' then raise exception 'FALHOU: autor pela tela %', r; end if;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar', false);
do $t$
declare oc uuid;
begin
  begin
    perform alerta_listar_ocorrencias(now() - interval '1 day', now(), '');
    raise exception 'FALHOU: listagem sem administrar';
  exception when others then
    if sqlerrm not like '%SEM_PERMISSAO%' then raise; end if;
  end;
end $t$;
reset role;

-- Ajustes pós-revisão (Task 3): a seção 17 deixou `teste.perms` só com 'visualizar'; várias
-- seções abaixo (26) chamam alerta_previa, que exige 'administrar'.
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);

-- 18. Posto removido da regra (regra continua ATIVA, só sem esse posto): a ocorrência viva vira
--     normalizada, sem ação.
insert into public.alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
                                  canais, destinatarios, criado_por)
values ('PostoRemovido', array['Posto18', 'Posto18b'], 90, 'tempo', 60, 5, array['telegram'],
        array['00000000-0000-0000-0000-000000000001']::uuid[],
        '00000000-0000-0000-0000-000000000001');
select public.teste_bipes('Posto18', 'PMO18', '9010', 1, 9, 5);   -- 10%, abre alerta
set role service_role;
do $t$
begin
  if teste_acao(alerta_avaliar(), 'PostoRemovido', 'Posto18') is null then
    raise exception 'FALHOU: Posto18 não abriu ocorrência';
  end if;
end $t$;
reset role;
update public.alerta_regras set postos = array['Posto18b'] where nome = 'PostoRemovido';
set role service_role;
do $t$
begin
  if teste_acao(alerta_avaliar(), 'PostoRemovido', 'Posto18') is not null then
    raise exception 'FALHOU: posto removido da regra ainda gerou ação';
  end if;
  if exists (select 1 from alerta_ocorrencias where posto = 'Posto18' and estado in ('aberta', 'resolvida')) then
    raise exception 'FALHOU: ocorrência de posto removido continuou viva';
  end if;
  if (select estado from alerta_ocorrencias where posto = 'Posto18' order by aberta_em desc limit 1) <> 'normalizada' then
    raise exception 'FALHOU: ocorrência de posto removido não virou normalizada';
  end if;
end $t$;
reset role;
update public.alerta_regras set ativa = false where nome = 'PostoRemovido';

-- 19. Ocorrência viva que cai abaixo do mínimo de bipes: continua ABERTA, sem normalizar e sem ação
--     (a regra não decide NADA abaixo do mínimo — nem abre, nem normaliza, nem fecha).
insert into public.alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
                                  canais, destinatarios, criado_por)
values ('MinimoViva', array['Posto19'], 90, 'tempo', 60, 20, array['telegram'],
        array['00000000-0000-0000-0000-000000000001']::uuid[],
        '00000000-0000-0000-0000-000000000001');
select public.teste_bipes('Posto19', 'PMO19', '9011', 5, 20, 10);  -- 25 bipes, 20%, abre alerta
set role service_role;
do $t$
declare a jsonb;
begin
  a := teste_acao(alerta_avaliar(), 'MinimoViva', 'Posto19');
  if a is null or a->>'tipo' <> 'alerta' then raise exception 'FALHOU: Posto19 não abriu %', a; end if;
end $t$;
reset role;
-- os 25 bipes saem da janela de 60 min: total cai pra 0, abaixo do mínimo de 20.
update public.sf_registros set data_hora = now() - interval '2 hours' where posto = 'Posto19';
set role service_role;
do $t$
begin
  if teste_acao(alerta_avaliar(), 'MinimoViva', 'Posto19') is not null then
    raise exception 'FALHOU: abaixo do mínimo gerou ação';
  end if;
  if (select estado from alerta_ocorrencias where posto = 'Posto19') <> 'aberta' then
    raise exception 'FALHOU: ocorrência abaixo do mínimo não continuou aberta';
  end if;
  if (select taxa_ultima from alerta_ocorrencias where posto = 'Posto19') <> 20.00 then
    raise exception 'FALHOU: taxa da ocorrência mudou mesmo sem decidir nada';
  end if;
end $t$;
reset role;
update public.alerta_regras set ativa = false where nome = 'MinimoViva';

-- 20. `aberta` com `lembrete_min` nulo: nunca manda lembrete, não importa quanto tempo passe.
insert into public.alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
                                  lembrete_min, canais, destinatarios, criado_por)
values ('SemLembrete', array['Posto20'], 90, 'tempo', 60, 5, null, array['telegram'],
        array['00000000-0000-0000-0000-000000000001']::uuid[],
        '00000000-0000-0000-0000-000000000001');
select public.teste_bipes('Posto20', 'PMO20', '9012', 1, 9, 5);
set role service_role;
do $t$
declare a jsonb;
begin
  a := teste_acao(alerta_avaliar(), 'SemLembrete', 'Posto20');
  if a is null or a->>'tipo' <> 'alerta' then raise exception 'FALHOU: Posto20 não abriu %', a; end if;
end $t$;
reset role;
update public.alerta_ocorrencias set ultimo_envio_em = now() - interval '3 hours',
                                     aberta_em = now() - interval '3 hours'
 where posto = 'Posto20' and estado = 'aberta';
set role service_role;
do $t$
begin
  if teste_acao(alerta_avaliar(), 'SemLembrete', 'Posto20') is not null then
    raise exception 'FALHOU: lembrete_min nulo mandou lembrete';
  end if;
end $t$;
reset role;
update public.alerta_regras set ativa = false where nome = 'SemLembrete';

-- 21. Taxa exatamente igual à meta normaliza (a comparação da regra é >=, não >).
insert into public.alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
                                  canais, destinatarios, criado_por)
values ('Igual', array['Posto21'], 90, 'tempo', 60, 5, array['telegram'],
        array['00000000-0000-0000-0000-000000000001']::uuid[],
        '00000000-0000-0000-0000-000000000001');
select public.teste_bipes('Posto21', 'PMO21', '9013', 1, 9, 10);  -- 10%, abre alerta
set role service_role;
do $t$
declare a jsonb;
begin
  a := teste_acao(alerta_avaliar(), 'Igual', 'Posto21');
  if a is null or a->>'tipo' <> 'alerta' then raise exception 'FALHOU: Posto21 não abriu %', a; end if;
end $t$;
reset role;
delete from public.sf_registros where posto = 'Posto21';
select public.teste_bipes('Posto21', 'PMO21', '9013', 90, 10, 5);  -- 90/100 = 90,00%, igual à meta
set role service_role;
do $t$
declare a jsonb;
begin
  a := teste_acao(alerta_avaliar(), 'Igual', 'Posto21');
  if a is null or a->>'tipo' <> 'normalizou' then raise exception 'FALHOU: taxa igual à meta não normalizou %', a; end if;
  if (a->>'taxa')::numeric <> 90.00 then raise exception 'FALHOU: taxa da normalização %', a; end if;
end $t$;
reset role;
update public.alerta_regras set ativa = false where nome = 'Igual';

-- 22. Janela `bipes`: linhas "Registrado" MAIS RECENTES que os bipes com status não atrapalham —
--     prova que o filtro de status roda ANTES do `order by ... limit`, não depois. Se filtrasse
--     depois, os 10 "Registrado" mais recentes ocupariam o limite inteiro e sobraria 0 bipe.
insert into public.alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
                                  canais, destinatarios, criado_por)
values ('BipesFiltro', array['Posto22'], 95, 'bipes', 10, 5, array['telegram'],
        array['00000000-0000-0000-0000-000000000001']::uuid[],
        '00000000-0000-0000-0000-000000000001');
select public.teste_bipes('Posto22', 'PMO22', '9014', 8, 2, 15);  -- 10 bipes com status, ~15 min atrás
insert into public.sf_registros (data_hora, posto, pmo, op, status)
select now() - make_interval(mins => g), 'Posto22', 'PMO22', '9014', 'Registrado'
  from generate_series(1, 10) g;  -- 10 bipes SEM status, mais recentes (1 a 10 min atrás)
set role service_role;
do $t$
declare a jsonb;
begin
  a := teste_acao(alerta_avaliar(), 'BipesFiltro', 'Posto22');
  if a is null or a->>'tipo' <> 'alerta' then raise exception 'FALHOU: filtro de status na janela bipes %', a; end if;
  if (a->>'aprovados')::int <> 8 or (a->>'reprovados')::int <> 2 then
    raise exception 'FALHOU: contagem com "Registrado" intercalado %', a;
  end if;
end $t$;
reset role;
update public.alerta_regras set ativa = false where nome = 'BipesFiltro';

-- 23. Janela `bipes`: bipes com mais de 30 dias não entram, mesmo dentro do limite N. Sem o
--     filtro de 30 dias, os 20 reprovados antigos completariam os 10 do limite e dariam
--     3 aprovados / 7 reprovados (30%, abaixo da meta); com o filtro, sobram só 3 bipes — abaixo
--     do mínimo de 5 — e a regra não decide nada.
insert into public.alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
                                  canais, destinatarios, criado_por)
values ('Bipes30d', array['Posto23'], 90, 'bipes', 10, 5, array['telegram'],
        array['00000000-0000-0000-0000-000000000001']::uuid[],
        '00000000-0000-0000-0000-000000000001');
insert into public.sf_registros (data_hora, posto, pmo, op, status)
select now() - interval '40 days' - make_interval(secs => g), 'Posto23', 'PMO23', '9015', 'REPROVADO'
  from generate_series(1, 20) g;
select public.teste_bipes('Posto23', 'PMO23', '9015', 3, 0, 5);  -- só 3 bipes dentro dos 30 dias
set role service_role;
do $t$
begin
  if teste_acao(alerta_avaliar(), 'Bipes30d', 'Posto23') is not null then
    raise exception 'FALHOU: bipe com mais de 30 dias entrou na janela';
  end if;
  if exists (select 1 from alerta_ocorrencias where posto = 'Posto23') then
    raise exception 'FALHOU: abriu ocorrência com bipe de mais de 30 dias';
  end if;
end $t$;
reset role;
update public.alerta_regras set ativa = false where nome = 'Bipes30d';

-- 24. Grants: authenticated não pode chamar alerta_avaliar nem alerta_resolver.
set role authenticated;
do $t$
begin
  begin
    perform alerta_avaliar();
    raise exception 'FALHOU: authenticated executou alerta_avaliar';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform alerta_resolver('00000000-0000-0000-0000-000000000000'::uuid,
                             '00000000-0000-0000-0000-000000000001'::uuid);
    raise exception 'FALHOU: authenticated executou alerta_resolver';
  exception when insufficient_privilege then
    null;
  end;
end $t$;
reset role;

-- 25. alerta_resolver: usuário nulo ou inativo é recusado com NAO_DESTINATARIO, mesmo que o
--     usuário inativo esteja no array `destinatarios` da regra.
insert into public.usuarios (id, nome, email, ativo) values
  ('00000000-0000-0000-0000-000000000009', 'Zeca Inativo', 'zeca@enterplak.com.br', false);
insert into public.alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
                                  canais, destinatarios, criado_por)
values ('ResolverNulo', array['Posto25'], 90, 'tempo', 60, 5, array['telegram'],
        array['00000000-0000-0000-0000-000000000001',
              '00000000-0000-0000-0000-000000000009']::uuid[],
        '00000000-0000-0000-0000-000000000001');
select public.teste_bipes('Posto25', 'PMO25', '9016', 1, 9, 5);
set role service_role;
do $t$
declare oc uuid; a jsonb;
begin
  a := teste_acao(alerta_avaliar(), 'ResolverNulo', 'Posto25');
  if a is null then raise exception 'FALHOU: Posto25 não abriu ocorrência'; end if;

  select id into oc from alerta_ocorrencias where posto = 'Posto25' and estado = 'aberta';

  begin
    perform alerta_resolver(oc, null);
    raise exception 'FALHOU: usuário nulo resolveu';
  exception when others then
    if sqlerrm not like '%NAO_DESTINATARIO%' then raise; end if;
  end;

  begin
    perform alerta_resolver(oc, '00000000-0000-0000-0000-000000000009');
    raise exception 'FALHOU: usuário inativo (mas destinatário) resolveu';
  exception when others then
    if sqlerrm not like '%NAO_DESTINATARIO%' then raise; end if;
  end;

  if (select estado from alerta_ocorrencias where id = oc) <> 'aberta' then
    raise exception 'FALHOU: ocorrência mudou de estado sem resolver de verdade';
  end if;
end $t$;
reset role;
update public.alerta_regras set ativa = false where nome = 'ResolverNulo';
delete from public.usuarios where id = '00000000-0000-0000-0000-000000000009';

-- 26. alerta_previa: janela nula ou zero (fora do tipo 'op') dá JANELA_INVALIDA.
set role authenticated;
do $t$
begin
  begin
    perform * from alerta_previa(array['Montagem'], 'tempo', null, 20);
    raise exception 'FALHOU: janela nula deveria falhar';
  exception when others then
    if sqlerrm not like '%JANELA_INVALIDA%' then raise; end if;
  end;
  begin
    perform * from alerta_previa(array['Montagem'], 'bipes', 0, 20);
    raise exception 'FALHOU: janela zero deveria falhar';
  exception when others then
    if sqlerrm not like '%JANELA_INVALIDA%' then raise; end if;
  end;
  -- janela 'op' não usa valor: nulo continua válido aqui.
  perform * from alerta_previa(array['Montagem'], 'op', null, 20);
end $t$;
reset role;

\echo 'ALERTAS: SQL OK'
