-- Anexos de foto por processo (subsistema A): bucket privado + metadados + RLS.

-- Bucket privado (buffer temporário; export/limpeza ficam no subsistema B).
insert into storage.buckets (id, name, public)
values ('anexos-processos', 'anexos-processos', false)
on conflict (id) do nothing;

-- Metadados dos anexos (listar, contar o limite de 3, auditar).
create table public.anexos_processo (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.processos_recebimento(id) on delete cascade,
  path text not null unique,
  nome_original text not null default '',
  mime text not null default '',
  tamanho bigint not null default 0,
  criado_por uuid references public.usuarios(id),
  created_at timestamptz not null default now()
);

create index anexos_processo_processo_idx on public.anexos_processo(processo_id);

alter table public.anexos_processo enable row level security;

-- RLS da tabela: ver = visualizar; anexar = editar; remover = editar. Sem UPDATE (metadado imutável).
create policy anexos_meta_select on public.anexos_processo
  for select to authenticated using (public.tem_permissao('visualizar'));
create policy anexos_meta_insert on public.anexos_processo
  for insert to authenticated with check (public.tem_permissao('editar'));
create policy anexos_meta_delete on public.anexos_processo
  for delete to authenticated using (public.tem_permissao('editar'));

-- RLS dos objetos do Storage, restrita ao bucket de anexos.
create policy anexos_obj_select on storage.objects
  for select to authenticated
  using (bucket_id = 'anexos-processos' and public.tem_permissao('visualizar'));
create policy anexos_obj_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'anexos-processos' and public.tem_permissao('editar'));
create policy anexos_obj_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'anexos-processos' and public.tem_permissao('editar'));
