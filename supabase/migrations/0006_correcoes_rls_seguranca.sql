-- Correções de segurança/consistência pós-revisão (migração forward-only).

-- ============ C1: logs imutáveis também contra TRUNCATE ============
-- Triggers FOR EACH ROW não disparam em TRUNCATE; adiciona guarda de statement + revoga privilégio.
create trigger logs_no_truncate
  before truncate on public.logs
  for each statement execute function public.prevent_log_mutation();

revoke truncate on public.logs from anon, authenticated, service_role;

-- ============ I1: finalização exige 'finalizar'; edição de finalizado exige 'editar_finalizado' ============
drop policy processos_update on public.processos_recebimento;
create policy processos_update on public.processos_recebimento
  for update to authenticated
  using (
    public.tem_permissao('editar')
    and (status <> 'finalizado' or public.tem_permissao('editar_finalizado'))
  )
  with check (
    public.tem_permissao('editar')
    and (
      status <> 'finalizado'
      or public.tem_permissao('finalizar')
      or public.tem_permissao('editar_finalizado')
    )
  );

-- ============ Minor: atribuição de log não forjável por usuário autenticado ============
-- Server-side (service_role) ignora RLS e continua podendo logar em nome de qualquer usuário.
drop policy logs_insert on public.logs;
create policy logs_insert on public.logs
  for insert to authenticated
  with check (usuario_id = auth.uid());

-- ============ Minor: handle_new_user tolera email nulo (OAuth/phone) ============
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
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'nome', ''), perfil_padrao);
  return new;
end;
$$;

-- ============ Minor: delete de listas de sistema bloqueado (paridade com perfis) ============
drop policy listas_write on public.listas;
create policy listas_insert on public.listas
  for insert to authenticated with check (public.tem_permissao('administrar'));
create policy listas_update on public.listas
  for update to authenticated using (public.tem_permissao('administrar')) with check (public.tem_permissao('administrar'));
create policy listas_delete on public.listas
  for delete to authenticated using (public.tem_permissao('administrar') and sistema = false);

-- ============ Minor: hardening de search_path nas funções utilitárias ============
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

create or replace function public.prevent_log_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Logs são imutáveis e não podem ser alterados ou removidos';
end; $$;
