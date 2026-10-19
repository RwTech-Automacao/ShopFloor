-- Testes SQL da 0149 (módulo da regra de alerta). Rodar com supabase/tests/rodar-alertas-test.sh:
-- DEPOIS de alertas_resumo_test.sql, na mesma base, com a 0149 por cima de tudo.
--
-- ⚠️ POR QUE ESTE ARQUIVO EXISTE: o caso de aceitação 6 da spec ("a regra do Recebimento NÃO
-- aparece na tela do ShopFloor, e vice-versa") e o 7 ("quem administra só o Recebimento consegue
-- usar") são RLS e permissão — nenhum teste de vitest os enxerga. A tela filtra por módulo na
-- consulta, mas é o RLS que impede o vazamento de verdade.
--
-- O mapa dos testes:
--   T0  esquema: as colunas nasceram com 'shopfloor' RETROATIVO nas linhas que já existiam;
--       as assinaturas novas são UMA só (as antigas sumiram);
--   T1  o check modulo x tipo recusa regra de Recebimento (nenhum tipo é dela ainda, na 0149);
--   T2  MODULO_FIXO: update que muda o módulo é recusado;
--   T3  ⚠️ RLS: quem administra só o ShopFloor vê as regras de 'shopfloor' e NÃO vê as de
--       'recebimento' (caso 6); quem administra só o Recebimento vê o contrário (casos 6 e 7);
--   T3b ⚠️ a ESCRITA pela tela, como `authenticated`: criar regra sem mandar o módulo nasce
--       'shopfloor' (o default vale antes do `with check`), e quem administra só o ShopFloor NÃO
--       grava regra de 'recebimento' (caso 7 pelo lado da escrita);
--   T4  alerta_destinatarios(p_modulo): a lista do Recebimento traz quem administra o
--       Recebimento e NÃO traz quem só administra o ShopFloor;
--   T5  alerta_listar_ocorrencias(..., p_modulo): só as ocorrências das regras daquele módulo, e
--       exige a permissão DAQUELE módulo;
--   T6  ⚠️ a fila congela o módulo: a linha enfileirada por uma regra de 'shopfloor' nasce com
--       modulo = 'shopfloor', e alerta_reservar_envios confere a permissão DESSA coluna;
--   T7  os tipos antigos continuam avaliando e enfileirando normalmente (nada regrediu);
--   T8  ⚠️ o botão "Resolvido" (alerta_resolver_interno, recriada aqui) continua funcionando e o
--       aviso "resolvido por X" nasce com o módulo da regra.
-- (A idempotência da 0149 é do runner, por construção: ela é aplicada duas vezes.)

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);

-- As regras dos testes anteriores saem do caminho e a fila antiga é dada por desistida.
update public.alerta_regras set ativa = false where ativa;
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;

-- ---------- T0: as colunas e as assinaturas ----------
do $t$
begin
  -- Retroativo: NENHUMA regra que já existia pode ter ficado sem módulo.
  if exists (select 1 from public.alerta_regras where modulo is distinct from 'shopfloor') then
    raise exception 'T0 FALHOU: regra antiga sem modulo = shopfloor';
  end if;
  if exists (select 1 from public.alerta_envios where modulo is distinct from 'shopfloor') then
    raise exception 'T0 FALHOU: envio antigo sem modulo = shopfloor';
  end if;
  -- Uma assinatura só de cada função que ganhou parâmetro (a antiga tem de ter sumido).
  if (select count(*) from pg_proc where proname = 'alerta_destinatarios'
        and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'T0 FALHOU: alerta_destinatarios tem assinatura duplicada';
  end if;
  if (select count(*) from pg_proc where proname = 'alerta_listar_ocorrencias'
        and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'T0 FALHOU: alerta_listar_ocorrencias tem assinatura duplicada';
  end if;
end $t$;
\echo 'T0 (colunas retroativas e assinaturas unicas): ok'

-- ---------- massa: dois administradores de um módulo só ----------
-- Beto administra SÓ o Recebimento; Carla administra SÓ o ShopFloor. Ana (do teste da 0115)
-- administra o ShopFloor e tem conta nos dois canais.
insert into public.perfis (id, nome) values
  ('00000000-0000-0000-0000-0000000000b0', 'Gestor Recebimento'),
  ('00000000-0000-0000-0000-0000000000c0', 'Gestor ShopFloor')
on conflict (id) do nothing;
insert into public.perfil_permissao (perfil_id, modulo, permissao) values
  ('00000000-0000-0000-0000-0000000000b0', 'recebimento', 'administrar'),
  ('00000000-0000-0000-0000-0000000000c0', 'shopfloor',   'administrar')
on conflict do nothing;
insert into public.usuarios (id, nome, email, ativo, perfil_id) values
  ('00000000-0000-0000-0000-0000000000b1', 'Beto Recebimento', 'beto@x', true,
   '00000000-0000-0000-0000-0000000000b0'),
  ('00000000-0000-0000-0000-0000000000c1', 'Carla ShopFloor',  'carla@x', true,
   '00000000-0000-0000-0000-0000000000c0')
on conflict (id) do nothing;
insert into public.alerta_contas (usuario_id, canal, externo_id) values
  ('00000000-0000-0000-0000-0000000000b1', 'telegram', 'TG-BETO'),
  ('00000000-0000-0000-0000-0000000000c1', 'telegram', 'TG-CARLA')
on conflict (usuario_id, canal) do nothing;

-- Uma regra de cada módulo. A de Recebimento entra à força (nenhum tipo é dela na 0149): o teste
-- T1 prova que o check recusa pelo caminho normal, e aqui o insert desliga o check só para montar
-- a massa do T3/T4/T5 — é a única linha do arquivo que mexe em constraint.
insert into public.alerta_regras
  (nome, tipo, modulo, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
   canais, destinatarios, ativa, criado_por)
values ('SF modulo', 'aprovacao', 'shopfloor', array['Teste'], 90, 'tempo', 60, 5,
        array['telegram'], array['00000000-0000-0000-0000-000000000001']::uuid[], true,
        '00000000-0000-0000-0000-000000000001');

alter table public.alerta_regras drop constraint alerta_regras_modulo_tipo;
insert into public.alerta_regras
  (nome, tipo, modulo, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
   canais, destinatarios, ativa, criado_por)
values ('REC modulo', 'aprovacao', 'recebimento', array['Teste'], 90, 'tempo', 60, 5,
        array['telegram'], array['00000000-0000-0000-0000-0000000000b1']::uuid[], true,
        '00000000-0000-0000-0000-000000000001');
-- `not valid`: a linha que acabou de entrar à força VIOLA o check (é o que o T1 prova), e um
-- `add constraint` normal valida as linhas que já existem e falharia aqui. `not valid` vale para
-- toda linha NOVA — que é exatamente o que o T1 mede.
alter table public.alerta_regras add constraint alerta_regras_modulo_tipo check (coalesce(
  case modulo
    when 'shopfloor'   then tipo in ('aprovacao', 'tempo', 'defeito', 'resumo')
    when 'recebimento' then false
  end, false)) not valid;

-- ---------- T1: o check modulo x tipo ----------
do $t$
begin
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
       canais, destinatarios, ativa, criado_por)
    values ('REC invalida', 'aprovacao', 'recebimento', array['Teste'], 90, 'tempo', 60, 5,
            array['telegram'], array['00000000-0000-0000-0000-0000000000b1']::uuid[], true,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'T1 FALHOU: o check deixou passar regra de recebimento com tipo do shopfloor';
  exception when check_violation then null;
  end;
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
       canais, destinatarios, ativa, criado_por)
    values ('Modulo inexistente', 'aprovacao', 'financeiro', array['Teste'], 90, 'tempo', 60, 5,
            array['telegram'], array['00000000-0000-0000-0000-000000000001']::uuid[], true,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'T1 FALHOU: o check aceitou um modulo que nao existe';
  exception when check_violation then null;
  end;
end $t$;
\echo 'T1 (check modulo x tipo): ok'

-- ---------- T2: MODULO_FIXO ----------
do $t$
begin
  begin
    update public.alerta_regras set modulo = 'recebimento' where nome = 'SF modulo';
    raise exception 'T2 FALHOU: o modulo da regra mudou';
  exception when others then
    if sqlerrm not like '%MODULO_FIXO%' then raise; end if;
  end;
end $t$;
\echo 'T2 (MODULO_FIXO): ok'

-- ---------- T3: o RLS não deixa a lista vazar (casos 6 e 7) ----------
-- `set role authenticated` + teste.uid/teste.perms: é assim que o RLS é medido de verdade (como
-- superusuário as policies nem são avaliadas — a lição da 0096).
do $t$
declare v_sf int; v_rec int;
begin
  -- Carla: só ShopFloor.
  perform set_config('teste.uid', '00000000-0000-0000-0000-0000000000c1', false);
  perform set_config('teste.perms', 'shopfloor.administrar', false);
  set local role authenticated;
  select count(*) filter (where modulo = 'shopfloor'),
         count(*) filter (where modulo = 'recebimento')
    into v_sf, v_rec from public.alerta_regras;
  reset role;
  if v_sf = 0 or v_rec <> 0 then
    raise exception 'T3 FALHOU (shopfloor): sf=% rec=% (esperado sf>0 e rec=0)', v_sf, v_rec;
  end if;

  -- Beto: só Recebimento.
  perform set_config('teste.uid', '00000000-0000-0000-0000-0000000000b1', false);
  perform set_config('teste.perms', 'recebimento.administrar', false);
  set local role authenticated;
  select count(*) filter (where modulo = 'shopfloor'),
         count(*) filter (where modulo = 'recebimento')
    into v_sf, v_rec from public.alerta_regras;
  reset role;
  if v_rec <> 1 or v_sf <> 0 then
    raise exception 'T3 FALHOU (recebimento): sf=% rec=% (esperado sf=0 e rec=1)', v_sf, v_rec;
  end if;
end $t$;
\echo 'T3 (RLS por modulo: a lista nao vaza): ok'

-- T3b: A ESCRITA pelo caminho da TELA, como `authenticated` — é o que a tela de hoje faz, e é o que
-- quebraria calado se a policy de insert e o default não casassem. Dois lados:
--   (a) a tela do ShopFloor cria regra SEM mandar a coluna `modulo`: o default 'shopfloor' é
--       aplicado ANTES do `with check`, então a policy passa e a regra nasce do ShopFloor;
--   (b) quem administra SÓ o ShopFloor NÃO consegue gravar uma regra de 'recebimento' (caso 7 pelo
--       lado da escrita) — a policy recusa com 42501 (insufficient_privilege).
-- ⚠️ EM (b) DUAS GUARDAS SE SOBREPÕEM e o código do erro diz QUAL delas pegou: hoje é o RLS
-- (42501), porque ele é avaliado antes do check; o check alerta_regras_modulo_tipo recusaria em
-- seguida. Por isso o handler aceita SÓ insufficient_privilege: se este teste falhar com
-- 'alerta_regras_modulo_tipo', a leitura é "o RLS deixou a linha passar e só o check a pegou" —
-- ou seja, a perna de módulo da policy de insert se perdeu. Aceitar os dois códigos tornaria
-- (b) incapaz de ver essa perda (conferido por sabotagem: trocar a policy pela da 0113 derruba
-- este teste exatamente assim).
do $t$
declare v_modulo text;
begin
  perform set_config('teste.uid', '00000000-0000-0000-0000-0000000000c1', false);
  perform set_config('teste.perms', 'shopfloor.administrar', false);
  set local role authenticated;
  insert into public.alerta_regras
    (nome, tipo, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
     canais, destinatarios, ativa)
  values ('T3b tela do shopfloor', 'aprovacao', array['T3b'], 90, 'tempo', 60, 5,
          array['telegram'], array['00000000-0000-0000-0000-0000000000c1']::uuid[], false);
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
       canais, destinatarios, ativa)
    values ('T3b tela invasora', 'aprovacao', 'recebimento', array['T3b'], 90, 'tempo', 60, 5,
            array['telegram'], array['00000000-0000-0000-0000-0000000000c1']::uuid[], false);
    reset role;
    raise exception 'T3b FALHOU: quem administra so o ShopFloor gravou uma regra de recebimento';
  exception when insufficient_privilege then null;
  end;
  reset role;
  select modulo into v_modulo from public.alerta_regras where nome = 'T3b tela do shopfloor';
  if v_modulo is distinct from 'shopfloor' then
    raise exception 'T3b FALHOU: a regra criada pela tela nasceu com modulo = % (esperado shopfloor)', v_modulo;
  end if;
end $t$;
\echo 'T3b (escrita pela tela, por modulo): ok'
select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);

-- ---------- T4: alerta_destinatarios(p_modulo) ----------
do $t$
declare v_tem_beto boolean; v_tem_carla boolean;
begin
  perform set_config('teste.perms', 'recebimento.administrar', false);
  select bool_or(usuario_id = '00000000-0000-0000-0000-0000000000b1'),
         bool_or(usuario_id = '00000000-0000-0000-0000-0000000000c1')
    into v_tem_beto, v_tem_carla
    from public.alerta_destinatarios('recebimento');
  if not coalesce(v_tem_beto, false) or coalesce(v_tem_carla, false) then
    raise exception 'T4 FALHOU: a lista do Recebimento trouxe beto=% carla=%', v_tem_beto, v_tem_carla;
  end if;
  -- Sem a permissão DAQUELE módulo, a função recusa.
  perform set_config('teste.perms', 'shopfloor.administrar', false);
  begin
    perform * from public.alerta_destinatarios('recebimento');
    raise exception 'T4 FALHOU: quem nao administra o Recebimento leu a lista dele';
  exception when others then
    if sqlerrm not like '%SEM_PERMISSAO%' then raise; end if;
  end;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);
\echo 'T4 (alerta_destinatarios por modulo): ok'

-- ---------- T5: alerta_listar_ocorrencias(..., p_modulo) ----------
-- A ocorrência nasce na regra de shopfloor; a lista do Recebimento não pode trazê-la.
insert into public.alerta_ocorrencias
  (regra_id, posto, estado, taxa_abertura, taxa_ultima, valor_abertura, valor_ultimo, amostras)
select id, 'Teste', 'aberta', 80, 80, 80, 80, 10 from public.alerta_regras where nome = 'SF modulo';
do $t$
declare v_n int;
begin
  perform set_config('teste.perms', 'recebimento.administrar', false);
  select count(*) into v_n
    from public.alerta_listar_ocorrencias(now() - interval '1 day', now() + interval '1 day',
                                          '', 'recebimento');
  if v_n <> 0 then raise exception 'T5 FALHOU: a lista do Recebimento trouxe % ocorrencia(s) do ShopFloor', v_n; end if;

  perform set_config('teste.perms', 'shopfloor.administrar', false);
  select count(*) into v_n
    from public.alerta_listar_ocorrencias(now() - interval '1 day', now() + interval '1 day',
                                          '', 'shopfloor');
  if v_n < 1 then raise exception 'T5 FALHOU: a lista do ShopFloor perdeu a ocorrencia dele'; end if;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);
\echo 'T5 (alerta_listar_ocorrencias por modulo): ok'

-- ---------- T6: a fila congela o módulo ----------
-- Enfileira à mão (o caminho real é testado em T7) e prova que (a) a coluna nasce com o módulo da
-- regra e (b) a reserva confere a permissão DESSA coluna, não 'shopfloor' fixo.
do $t$
declare v_regra uuid; v_envio uuid; v_n int;
begin
  select id into v_regra from public.alerta_regras where nome = 'REC modulo';
  insert into public.alerta_envios
    (ocorrencia_id, usuario_id, canal, tipo, modulo, dados, com_botao, destino_tipo)
  values (null, '00000000-0000-0000-0000-0000000000b1', 'telegram', 'resumo', 'recebimento',
          jsonb_build_object('regra_nome', 'REC modulo'), false, 'usuario')
  returning id into v_envio;

  set local role service_role;
  select count(*) into v_n from public.alerta_reservar_envios(array['telegram'], 100)
   where id = v_envio;
  reset role;
  -- Beto administra o Recebimento (não o ShopFloor): com a régua antiga a linha NUNCA sairia.
  if v_n <> 1 then
    raise exception 'T6 FALHOU: a linha de recebimento nao foi reservada (a regua ainda e shopfloor?)';
  end if;
end $t$;
\echo 'T6 (modulo congelado na fila e conferido na reserva): ok'

-- ---------- T7: nada regrediu nos tipos antigos ----------
-- A regra de aprovação do T3 (SF modulo) continua abrindo/insistindo normalmente e a linha nova da
-- fila nasce com modulo = 'shopfloor'.
--
-- ⚠️ A ocorrência que o T5 inseriu À MÃO é encerrada aqui antes de avaliar. Com ela viva, o
-- alerta_avaliar cairia no ramo da INSISTÊNCIA (ocorrência já aberta) e, como esta regra não tem
-- lembrete_min, nada seria enfileirado: o T7 falharia por causa da massa do T5, não por regressão.
-- Encerrada, a avaliação volta ao caminho da ABERTURA, que é o que este teste mede.
update public.alerta_ocorrencias oc
   set estado = 'normalizada', normalizada_em = now()
  from public.alerta_regras rg
 where rg.id = oc.regra_id and rg.nome = 'SF modulo' and oc.estado in ('aberta', 'resolvida');
do $t$
declare v_res jsonb; v_n int;
begin
  insert into public.sf_registros (data_hora, posto, pmo, op, status)
  select now() - interval '1 minute', 'Teste', 'PMOA', '1000', 'reprovado'
    from generate_series(1, 10);
  set local role service_role;
  v_res := public.alerta_avaliar();
  reset role;
  if (v_res->>'ocupado')::boolean then raise exception 'T7 FALHOU: avaliacao ocupada'; end if;
  select count(*) into v_n
    from public.alerta_envios e
    join public.alerta_ocorrencias oc on oc.id = e.ocorrencia_id
    join public.alerta_regras rg on rg.id = oc.regra_id
   where rg.nome = 'SF modulo' and e.modulo = 'shopfloor';
  if v_n < 1 then raise exception 'T7 FALHOU: a regra de aprovacao nao enfileirou nada com modulo'; end if;
end $t$;
\echo 'T7 (tipos antigos intactos): ok'

-- ---------- T8: o botão "Resolvido" continua funcionando (alerta_resolver_interno) ----------
-- ⚠️ ESTE TESTE FECHA A ÚLTIMA LACUNA DE COBERTURA DA 0149. A migração RECRIA cinco funções, e
-- quatro delas já são exercitadas depois dela (destinatarios em T4, listar_ocorrencias em T5,
-- reservar_envios em T6, avaliar em T7). O alerta_resolver_interno era a única recriada e nunca
-- chamada depois — e plpgsql só valida o corpo na PRIMEIRA execução: um `r.modulo` errado passaria
-- pelo harness inteiro e só apareceria em produção, no primeiro clique em "Resolvido".
-- A Carla entra como segunda responsável para o fan-out do "✅ resolvido por X" ter alguém além de
-- quem resolveu (a função não avisa quem apertou o botão).
update public.alerta_regras
   set destinatarios = array['00000000-0000-0000-0000-000000000001',
                             '00000000-0000-0000-0000-0000000000c1']::uuid[]
 where nome = 'SF modulo';
do $t$
declare v_oc uuid; v_res jsonb;
begin
  select oc.id into v_oc
    from public.alerta_ocorrencias oc
    join public.alerta_regras rg on rg.id = oc.regra_id
   where rg.nome = 'SF modulo' and oc.estado = 'aberta';
  if v_oc is null then
    raise exception 'T8 FALHOU: o T7 nao deixou ocorrencia aberta para resolver';
  end if;
  set local role service_role;
  v_res := public.alerta_resolver(v_oc, '00000000-0000-0000-0000-000000000001');
  reset role;
  if (v_res->>'ja_resolvida')::boolean then
    raise exception 'T8 FALHOU: a ocorrencia já estava resolvida';
  end if;
  -- O aviso para a OUTRA responsável nasce com o módulo da regra.
  if not exists (select 1 from public.alerta_envios
                  where ocorrencia_id = v_oc and tipo = 'resolvido'
                    and usuario_id = '00000000-0000-0000-0000-0000000000c1'
                    and modulo = 'shopfloor') then
    raise exception 'T8 FALHOU: o aviso "resolvido por" nao saiu com modulo = shopfloor';
  end if;
end $t$;
\echo 'T8 (resolver_interno recriado e exercitado): ok'

-- Os helpers deste arquivo não sobrevivem a ele (os próximos testes criam os seus).
\echo '0149 (modulo da regra): ok'
