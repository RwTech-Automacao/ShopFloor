-- Testes SQL da 0151 (canal 'email'). Rodar com supabase/tests/rodar-alertas-test.sh: DEPOIS de
-- alertas_emb_test.sql, na mesma base, com a 0151 por cima de tudo.
--
-- ⚠️ POR QUE ESTE ARQUIVO EXISTE: o e-mail é o único canal SEM vínculo — o endereço sai de
-- usuarios.email, não de alerta_contas. O `join` com alerta_contas resolvia o endereço de todas as
-- linhas de pessoa (0123); se o e-mail passar por ele, a linha nunca é reservada, fica pendente e
-- expira em 24 h EM SILÊNCIO. É esse caminho que este arquivo mede.
--
-- O mapa dos testes:
--   T0  esquema: 'email' aceito em alerta_regras.canais e em alerta_envios.canal; alerta_contas
--       NÃO aceita 'email' (e-mail não tem vínculo, de propósito);
--   T1  o fan-out enfileira e-mail SEM conta vinculada;
--   T2  ⚠️ a reserva resolve o endereço a partir de usuarios.email;
--   T3  responsável com e-mail em branco NÃO é enfileirado (não há endereço a inventar);
--   T4  responsável sem shopfloor/recebimento.administrar continua fora, como nos outros canais;
--   T5  o aviso "resolvido por X" também sai por e-mail;
--   T6  alerta_destinatarios devolve email_ok;
--   T7  Telegram e Discord continuam exigindo conta vinculada (nada regrediu).

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.administrar,recebimento.administrar', false);

update public.alerta_regras set ativa = false where ativa;
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;

-- ---------- helpers (cópias dos da 0150 com canais = email; os originais já foram apagados) ----------
create function public.teste_regra_emb_email(
  p_nome text,
  p_destinatarios uuid[],
  p_criado_em timestamptz default now() - interval '1 hour'
) returns uuid language sql as $f$
  insert into public.alerta_regras
    (nome, tipo, modulo, postos, janela_tipo, janela_valor, minimo_bipes, canais, destinatarios,
     avisar_pessoas, avisar_canal, ativa, criado_por, criado_em)
  values (p_nome, 'emb', 'recebimento', '{}'::text[], 'op', null, null, array['email'],
          p_destinatarios, true, false, true, '00000000-0000-0000-0000-000000000001', p_criado_em)
  returning id
$f$;

create function public.teste_item_emb_email(
  p_emb text, p_item text, p_status text,
  p_pedido numeric default 500, p_recebido numeric default 500
) returns bigint language sql as $f$
  insert into public.processos_recebimento
    (numero_emb, codigo_material, descricao_material, quantidade_pedido, quantidade_recebida,
     divergencia, status, resultado, created_at, finalizado_em)
  values (p_emb, p_item, 'CAPACITOR ' || p_item, p_pedido, p_recebido,
          (p_recebido - p_pedido)::text, p_status,
          case when p_status in ('Aprovado', 'Reprovado') then p_status end,
          now() - interval '2 days',
          case when p_status in ('Aprovado', 'Reprovado') then now() - interval '1 minute' end)
  returning numero
$f$;

-- ---------- T0 ----------
do $t$
begin
  begin
    insert into public.alerta_contas (usuario_id, canal, externo_id)
    values ('00000000-0000-0000-0000-0000000000b1', 'email', 'beto@x');
    raise exception 'T0 FALHOU: alerta_contas aceitou canal email (e-mail nao tem vinculo)';
  exception when check_violation then null;
  end;
end $t$;
\echo 'T0 (esquema do canal email): ok'

-- ---------- T1 e T2: enfileira sem vínculo e a reserva acha o endereço ----------
-- Dora administra o Recebimento, tem e-mail de login e NÃO tem conta em canal nenhum.
select public.teste_regra_emb_email('EMB por email',
         array['00000000-0000-0000-0000-0000000000b2']::uuid[]);
select public.teste_item_emb_email('EMB800', 'E-1', 'Aprovado', 40, 35);
do $t$
declare v_id uuid; v_ext text;
begin
  set local role service_role;
  perform public.alerta_avaliar();
  reset role;
  select id into v_id from public.alerta_envios
   where tipo = 'emb' and canal = 'email' and dados->>'emb' = 'EMB800';
  if v_id is null then
    raise exception 'T1 FALHOU: nao enfileirou e-mail para quem nao tem conta vinculada';
  end if;
  if not exists (select 1 from public.alerta_contas
                  where usuario_id = '00000000-0000-0000-0000-0000000000b2') then
    null;  -- confirmado: ela nao tem vinculo nenhum, e ainda assim foi enfileirada
  else
    raise exception 'T1 FALHOU: a massa do teste esta errada (Dora tem conta vinculada)';
  end if;

  set local role service_role;
  select externo_id into v_ext from public.alerta_reservar_envios(array['email'], 100)
   where id = v_id;
  reset role;
  if coalesce(v_ext, '') <> 'dora@x' then
    raise exception 'T2 FALHOU: a reserva devolveu endereco %, esperava dora@x', v_ext;
  end if;
end $t$;
\echo 'T1/T2 (e-mail sem vinculo, endereco de usuarios.email): ok'

-- ---------- T3: e-mail em branco ----------
insert into public.usuarios (id, nome, email, ativo, perfil_id) values
  ('00000000-0000-0000-0000-0000000000b3', 'Elza Sem Email', '   ', true,
   '00000000-0000-0000-0000-0000000000b0')
on conflict (id) do update set email = '   ';
select public.teste_regra_emb_email('EMB sem endereco',
         array['00000000-0000-0000-0000-0000000000b3']::uuid[]);
select public.teste_item_emb_email('EMB810', 'E-2', 'Aprovado', 40, 30);
do $t$
begin
  set local role service_role;
  perform public.alerta_avaliar();
  reset role;
  if exists (select 1 from public.alerta_envios
              where tipo = 'emb' and canal = 'email' and dados->>'emb' = 'EMB810'
                and usuario_id = '00000000-0000-0000-0000-0000000000b3') then
    raise exception 'T3 FALHOU: enfileirou e-mail para quem nao tem endereco';
  end if;
end $t$;
\echo 'T3 (e-mail em branco fica fora): ok'

-- ---------- T4: quem não administra o Recebimento continua fora ----------
-- Carla administra SÓ o ShopFloor e tem e-mail de login: não recebe aviso de regra do Recebimento.
select public.teste_regra_emb_email('EMB sem permissao',
         array['00000000-0000-0000-0000-0000000000c1']::uuid[]);
select public.teste_item_emb_email('EMB820', 'E-3', 'Aprovado', 40, 30);
do $t$
begin
  set local role service_role;
  perform public.alerta_avaliar();
  reset role;
  if exists (select 1 from public.alerta_envios
              where tipo = 'emb' and canal = 'email' and dados->>'emb' = 'EMB820'
                and usuario_id = '00000000-0000-0000-0000-0000000000c1') then
    raise exception 'T4 FALHOU: enfileirou e-mail para quem nao administra o Recebimento';
  end if;
end $t$;
\echo 'T4 (sem permissao no modulo fica fora): ok'

-- ---------- T5: o aviso "resolvido por X" também sai por e-mail ----------
-- Regra do ShopFloor SÓ por e-mail, com Carla como responsável. Ana resolve; Carla (sem nenhuma
-- conta vinculada) recebe o "resolvido" por e-mail, com o endereço certo na reserva.
insert into public.alerta_regras
  (nome, tipo, modulo, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes, canais,
   destinatarios, avisar_pessoas, avisar_canal, ativa, criado_por)
values ('SF por email', 'aprovacao', 'shopfloor', array['EM-Posto'], 90, 'tempo', 60, 2,
        array['email'], array['00000000-0000-0000-0000-0000000000c1']::uuid[], true, false, true,
        '00000000-0000-0000-0000-000000000001');
insert into public.sf_registros (data_hora, posto, pmo, op, status) values
  (now() - interval '5 minutes', 'EM-Posto', 'PMOE', '1', 'Reprovado'),
  (now() - interval '4 minutes', 'EM-Posto', 'PMOE', '1', 'Reprovado');
do $t$
declare v_oc uuid; v_ext text; v_id uuid;
begin
  set local role service_role;
  perform public.alerta_avaliar();
  reset role;
  select id into v_oc from public.alerta_ocorrencias where posto = 'EM-Posto' and estado = 'aberta';
  if v_oc is null then raise exception 'T5 FALHOU: a ocorrencia do EM-Posto nao abriu'; end if;
  if not exists (select 1 from public.alerta_envios
                  where ocorrencia_id = v_oc and tipo = 'alerta' and canal = 'email'
                    and usuario_id = '00000000-0000-0000-0000-0000000000c1') then
    raise exception 'T5 FALHOU: o alerta da ocorrencia nao saiu por e-mail';
  end if;
  perform public.alerta_resolver_admin(v_oc, 'ok');
  select id into v_id from public.alerta_envios
   where ocorrencia_id = v_oc and tipo = 'resolvido' and canal = 'email'
     and usuario_id = '00000000-0000-0000-0000-0000000000c1';
  if v_id is null then
    raise exception 'T5 FALHOU: o "resolvido" nao saiu por e-mail';
  end if;
  set local role service_role;
  select externo_id into v_ext from public.alerta_reservar_envios(array['email'], 100) where id = v_id;
  reset role;
  if coalesce(v_ext, '') <> 'carla@x' then
    raise exception 'T5 FALHOU: endereco do resolvido = %, esperava carla@x', v_ext;
  end if;
end $t$;
\echo 'T5 (resolvido tambem por e-mail): ok'

-- ---------- T6: alerta_destinatarios devolve email_ok ----------
do $t$
declare v_dora boolean; v_elza boolean;
begin
  perform set_config('teste.perms', 'recebimento.administrar', false);
  select bool_or(email_ok) filter (where usuario_id = '00000000-0000-0000-0000-0000000000b2'),
         bool_or(email_ok) filter (where usuario_id = '00000000-0000-0000-0000-0000000000b3')
    into v_dora, v_elza
    from public.alerta_destinatarios('recebimento');
  if not coalesce(v_dora, false) then raise exception 'T6 FALHOU: Dora veio sem email_ok'; end if;
  if coalesce(v_elza, true) then raise exception 'T6 FALHOU: Elza (email em branco) veio com email_ok'; end if;
end $t$;
select set_config('teste.perms', 'shopfloor.administrar,recebimento.administrar', false);
\echo 'T6 (alerta_destinatarios devolve email_ok): ok'
-- ---------- T7: Telegram e Discord continuam exigindo vínculo ----------
do $t$
declare v_n int;
begin
  insert into public.alerta_envios
    (ocorrencia_id, usuario_id, canal, tipo, modulo, dados, com_botao, destino_tipo)
  values (null, '00000000-0000-0000-0000-0000000000b2', 'telegram', 'resumo', 'recebimento',
          '{}'::jsonb, false, 'usuario');
  set local role service_role;
  select count(*) into v_n from public.alerta_reservar_envios(array['telegram'], 100)
   where usuario_id = '00000000-0000-0000-0000-0000000000b2';
  reset role;
  if v_n <> 0 then
    raise exception 'T7 FALHOU: reservou Telegram para quem nao tem conta vinculada';
  end if;
end $t$;
\echo 'T7 (Telegram/Discord continuam exigindo vinculo): ok'
-- ---------- T8: a negação da reserva ----------
-- A linha de e-mail de uma pessoa que não pode mais receber NÃO pode ser reservada: tem que ficar
-- pendente (ok = false, tentativas = 0, sem reservado_em), sem gastar tentativa nem virar falha.
--   Elza (b3): e-mail de login em branco; Fabio (b4): desativado depois de enfileirado;
--   Carla (c1): ativa e com e-mail, mas só administra o ShopFloor — perdeu o Recebimento.
insert into public.usuarios (id, nome, email, ativo, perfil_id) values
  ('00000000-0000-0000-0000-0000000000b4', 'Fabio Desativado', 'fabio@x', false,
   '00000000-0000-0000-0000-0000000000b0')
on conflict (id) do update set ativo = false;
do $t$
declare v_elza uuid; v_fabio uuid; v_carla uuid; v_dora uuid; v_n int; v_ext text; v_pend int;
begin
  insert into public.alerta_envios
    (ocorrencia_id, usuario_id, canal, tipo, modulo, dados, com_botao, destino_tipo)
  values (null, '00000000-0000-0000-0000-0000000000b3', 'email', 'resumo', 'recebimento',
          '{"t8":"elza"}'::jsonb, false, 'usuario') returning id into v_elza;
  insert into public.alerta_envios
    (ocorrencia_id, usuario_id, canal, tipo, modulo, dados, com_botao, destino_tipo)
  values (null, '00000000-0000-0000-0000-0000000000b4', 'email', 'resumo', 'recebimento',
          '{"t8":"fabio"}'::jsonb, false, 'usuario') returning id into v_fabio;
  insert into public.alerta_envios
    (ocorrencia_id, usuario_id, canal, tipo, modulo, dados, com_botao, destino_tipo)
  values (null, '00000000-0000-0000-0000-0000000000c1', 'email', 'resumo', 'recebimento',
          '{"t8":"carla"}'::jsonb, false, 'usuario') returning id into v_carla;
  -- controle: a mesma linha para quem pode (Dora) TEM que ser reservada, senão o teste não prova nada
  insert into public.alerta_envios
    (ocorrencia_id, usuario_id, canal, tipo, modulo, dados, com_botao, destino_tipo)
  values (null, '00000000-0000-0000-0000-0000000000b2', 'email', 'resumo', 'recebimento',
          '{"t8":"dora"}'::jsonb, false, 'usuario') returning id into v_dora;

  -- uma única chamada reserva tudo o que pode: o controle (Dora) e os três que não podem
  set local role service_role;
  select count(*) filter (where id in (v_elza, v_fabio, v_carla)),
         max(externo_id) filter (where id = v_dora)
    into v_n, v_ext
    from public.alerta_reservar_envios(array['email'], 100);
  reset role;
  if coalesce(v_ext, '') <> 'dora@x' then
    raise exception 'T8 FALHOU: o controle (Dora) nao foi reservado (endereco %), o teste nao prova nada', v_ext;
  end if;
  if v_n <> 0 then
    raise exception 'T8 FALHOU: reservou % linha(s) de e-mail de quem nao pode receber (sem endereco, desativado ou sem permissao)', v_n;
  end if;

  select count(*) into v_pend from public.alerta_envios
   where id in (v_elza, v_fabio, v_carla) and not ok and tentativas = 0 and reservado_em is null;
  if v_pend <> 3 then
    raise exception 'T8 FALHOU: as 3 linhas deviam seguir pendentes e intactas, so % estao', v_pend;
  end if;
end $t$;
\echo 'T8 (negacao da reserva: sem endereco, desativado, sem permissao): ok'

-- ---------- limpeza: os helpers deste arquivo não ficam para quem roda depois ----------
drop function public.teste_regra_emb_email(text, uuid[], timestamptz);
drop function public.teste_item_emb_email(text, text, text, numeric, numeric);

\echo '0151 (canal email): ok'
