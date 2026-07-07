-- ============ PERFIS ============
create table public.perfis (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  pode_visualizar boolean not null default false,
  pode_importar boolean not null default false,
  pode_editar boolean not null default false,
  pode_finalizar boolean not null default false,
  pode_editar_finalizado boolean not null default false,
  pode_excluir boolean not null default false,
  pode_gerar_etiqueta boolean not null default false,
  pode_administrar boolean not null default false,
  sistema boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ USUARIOS ============
create table public.usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '',
  email text not null,
  perfil_id uuid not null references public.perfis(id),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ SEED DOS PERFIS ============
insert into public.perfis
  (nome, pode_visualizar, pode_importar, pode_editar, pode_finalizar,
   pode_editar_finalizado, pode_excluir, pode_gerar_etiqueta, pode_administrar, sistema)
values
  ('Administrador', true,  true,  true,  true,  true,  true,  true,  true,  true),
  ('Supervisor',    true,  true,  true,  true,  true,  true,  true,  false, true),
  ('Recebimento',   true,  true,  true,  true,  false, false, true,  false, true),
  ('Consulta',      true,  false, false, false, false, false, false, false, true);

-- ============ HELPER RBAC ============
create or replace function public.tem_permissao(perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case perm
      when 'visualizar'         then p.pode_visualizar
      when 'importar'           then p.pode_importar
      when 'editar'             then p.pode_editar
      when 'finalizar'          then p.pode_finalizar
      when 'editar_finalizado'  then p.pode_editar_finalizado
      when 'excluir'            then p.pode_excluir
      when 'gerar_etiqueta'     then p.pode_gerar_etiqueta
      when 'administrar'        then p.pode_administrar
      else false
    end
    from public.usuarios u
    join public.perfis p on p.id = u.perfil_id
    where u.id = auth.uid() and u.ativo
  ), false);
$$;

-- ============ TRIGGER: novo auth.user -> usuarios (perfil Consulta) ============
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  perfil_padrao uuid;
begin
  select id into perfil_padrao from public.perfis where nome = 'Consulta' limit 1;
  insert into public.usuarios (id, email, nome, perfil_id)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nome', ''), perfil_padrao);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ RLS ============
alter table public.perfis enable row level security;
alter table public.usuarios enable row level security;

-- perfis: todos autenticados leem; só quem administra escreve
create policy perfis_select on public.perfis
  for select to authenticated using (true);
create policy perfis_insert on public.perfis
  for insert to authenticated with check (public.tem_permissao('administrar'));
create policy perfis_update on public.perfis
  for update to authenticated using (public.tem_permissao('administrar'));
create policy perfis_delete on public.perfis
  for delete to authenticated using (public.tem_permissao('administrar') and sistema = false);

-- usuarios: o próprio usuário lê a si mesmo; quem administra lê/escreve todos
create policy usuarios_select_self on public.usuarios
  for select to authenticated using (id = auth.uid() or public.tem_permissao('administrar'));
create policy usuarios_insert on public.usuarios
  for insert to authenticated with check (public.tem_permissao('administrar'));
create policy usuarios_update on public.usuarios
  for update to authenticated using (public.tem_permissao('administrar'));
create policy usuarios_delete on public.usuarios
  for delete to authenticated using (public.tem_permissao('administrar'));
