-- Testes SQL dos alertas de taxa de aprovação. Rodar com supabase/tests/rodar-alertas-test.sh
-- (Postgres descartável em Docker). Tudo que o banco real já tem é STUBADO aqui — só o mínimo.

-- ---------- Stubs do Supabase / ShopFloor ----------
create role anon;
create role authenticated;
create role service_role bypassrls;   -- no Supabase o service_role ignora RLS
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as $f$
  select nullif(current_setting('teste.uid', true), '')::uuid
$f$;

create table public.usuarios (
  id uuid primary key,
  nome text not null default '',
  email text not null default '',
  ativo boolean not null default true
);

create table public.sf_registros (
  id uuid primary key default gen_random_uuid(),
  data_hora timestamptz not null default now(),
  posto text not null,
  pmo text not null default '',
  op text not null default '',
  status text not null default ''
);

grant select on public.usuarios, public.sf_registros to anon, authenticated, service_role;

-- `teste.perms` = lista 'modulo.permissao' separada por vírgula.
create function public.tem_permissao(p_modulo text, p_perm text) returns boolean language sql stable as $f$
  select (',' || coalesce(current_setting('teste.perms', true), '') || ',')
         like '%,' || p_modulo || '.' || p_perm || ',%'
$f$;

insert into public.usuarios (id, nome, email) values
  ('00000000-0000-0000-0000-000000000001', 'Ana Gestora',     'ana@enterplak.com.br'),
  ('00000000-0000-0000-0000-000000000002', 'Bruno Líder',     'bruno@enterplak.com.br'),
  ('00000000-0000-0000-0000-000000000003', 'Carla Operadora', 'carla@enterplak.com.br');

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);

\i /tmp/0113.sql
\i /tmp/0114.sql

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

-- 1. Código de vínculo: formato, invalidação do anterior, uso único, expiração, id já usado.
do $t$
declare r1 jsonb; r2 jsonb; n text;
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
  n := alerta_vincular(lower(r2->>'codigo'), 'telegram', '111');
  if n <> 'Ana Gestora' then raise exception 'FALHOU: nome do vínculo %', n; end if;
  if not exists (select 1 from alerta_contas
                  where usuario_id = '00000000-0000-0000-0000-000000000001'
                    and canal = 'telegram' and externo_id = '111') then
    raise exception 'FALHOU: conta não gravada';
  end if;

  begin
    perform alerta_vincular(r2->>'codigo', 'telegram', '111');
    raise exception 'FALHOU: código usado duas vezes';
  exception when others then
    if sqlerrm not like '%CODIGO_INVALIDO%' then raise; end if;
  end;

  -- expirado
  r1 := alerta_gerar_codigo();
  update alerta_codigos set expira_em = now() - interval '1 minute' where codigo = r1->>'codigo';
  begin
    perform alerta_vincular(r1->>'codigo', 'telegram', '111');
    raise exception 'FALHOU: código expirado aceito';
  exception when others then
    if sqlerrm not like '%CODIGO_EXPIRADO%' then raise; end if;
  end;

  -- canal inválido
  r1 := alerta_gerar_codigo();
  begin
    perform alerta_vincular(r1->>'codigo', 'whatsapp', '999');
    raise exception 'FALHOU: canal inválido aceito';
  exception when others then
    if sqlerrm not like '%CANAL_INVALIDO%' then raise; end if;
  end;

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
declare r jsonb;
begin
  r := alerta_gerar_codigo();
  perform alerta_vincular(r->>'codigo', 'telegram', '222');
  r := alerta_gerar_codigo();
  perform alerta_vincular(r->>'codigo', 'discord', 'D2');

  -- id externo de OUTRO usuário não pode ser roubado
  r := alerta_gerar_codigo();
  begin
    perform alerta_vincular(r->>'codigo', 'telegram', '112');
    raise exception 'FALHOU: externo_id de outro usuário aceito';
  exception when others then
    if sqlerrm not like '%CONTA_JA_VINCULADA%' then raise; end if;
  end;
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

\echo 'ALERTAS: TABELAS/RLS/VINCULO OK'
