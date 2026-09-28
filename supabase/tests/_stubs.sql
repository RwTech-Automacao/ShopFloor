-- Stubs do Supabase / ShopFloor usados por supabase/tests/alertas_test.sql.
-- Roda ANTES da 0113 (que referencia usuarios/tem_permissao) e antes do teste em si — em
-- conexão própria, então NÃO grava nenhuma configuração de sessão (isso fica por conta do
-- próprio alertas_test.sql, que roda tudo numa única conexão).
create role anon;
create role authenticated;
create role service_role bypassrls;   -- no Supabase o service_role ignora RLS
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as $f$
  select nullif(current_setting('teste.uid', true), '')::uuid
$f$;

-- RBAC por módulo (0001/0038): o perfil do usuário e as permissões de cada perfil. A 0115 lê isto
-- em usuario_tem_permissao (permissão do DESTINATÁRIO, não de quem chama).
create table public.perfis (
  id uuid primary key,
  nome text not null default ''
);
create table public.perfil_permissao (
  perfil_id uuid not null references public.perfis(id) on delete cascade,
  modulo    text not null,
  permissao text not null,
  primary key (perfil_id, modulo, permissao)
);

create table public.usuarios (
  id uuid primary key,
  nome text not null default '',
  email text not null default '',
  ativo boolean not null default true,
  -- nulo no stub (no banco real é not null): os testes da 0113 criam usuários sem perfil
  perfil_id uuid references public.perfis(id)
);

create table public.sf_registros (
  id uuid primary key default gen_random_uuid(),
  data_hora timestamptz not null default now(),
  posto text not null,
  pmo text not null default '',
  op text not null default '',
  status text not null default '',
  codigo_defeito text not null default ''
);

create table public.sf_ordens (
  id uuid primary key default gen_random_uuid(),
  pmo text not null,
  op text not null
);

grant select on public.usuarios, public.sf_registros, public.sf_ordens, public.perfis, public.perfil_permissao
  to anon, authenticated, service_role;

-- `teste.perms` = lista 'modulo.permissao' separada por vírgula.
create function public.tem_permissao(p_modulo text, p_perm text) returns boolean language sql stable as $f$
  select (',' || coalesce(current_setting('teste.perms', true), '') || ',')
         like '%,' || p_modulo || '.' || p_perm || ',%'
$f$;

insert into public.usuarios (id, nome, email) values
  ('00000000-0000-0000-0000-000000000001', 'Ana Gestora',     'ana@enterplak.com.br'),
  ('00000000-0000-0000-0000-000000000002', 'Bruno Líder',     'bruno@enterplak.com.br'),
  ('00000000-0000-0000-0000-000000000003', 'Carla Operadora', 'carla@enterplak.com.br');
