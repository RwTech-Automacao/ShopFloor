create table public.logs (
  id uuid primary key default gen_random_uuid(),
  entidade text not null,
  entidade_id uuid,
  acao text not null check (acao in
    ('criar','importar','alterar_campo','mudar_status','gerar_etiqueta','excluir','login')),
  descricao text not null default '',
  dados jsonb not null default '{}'::jsonb,
  usuario_id uuid references public.usuarios(id),
  usuario_nome text not null default '',
  created_at timestamptz not null default now()
);

create index logs_entidade_idx on public.logs(entidade, entidade_id);
create index logs_created_at_idx on public.logs(created_at desc);

-- imutabilidade: bloqueia UPDATE/DELETE para QUALQUER papel (inclusive service_role)
create or replace function public.prevent_log_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Logs são imutáveis e não podem ser alterados ou removidos';
end; $$;

create trigger logs_no_update
  before update on public.logs
  for each row execute function public.prevent_log_mutation();
create trigger logs_no_delete
  before delete on public.logs
  for each row execute function public.prevent_log_mutation();

alter table public.logs enable row level security;
create policy logs_select on public.logs
  for select to authenticated using (public.tem_permissao('visualizar'));
create policy logs_insert on public.logs
  for insert to authenticated with check (true);
-- sem policies de update/delete => negados por RLS; o trigger reforça mesmo para service_role
