create table public.listas (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  nome text not null,
  descricao text not null default '',
  sistema boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.lista_itens (
  id uuid primary key default gen_random_uuid(),
  lista_id uuid not null references public.listas(id) on delete cascade,
  valor text not null,
  ordem int not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (lista_id, valor)
);

create index lista_itens_lista_id_idx on public.lista_itens(lista_id);

insert into public.listas (chave, nome, sistema) values
  ('tipo',         'Tipo',          true),
  ('resultado',    'Resultado',     true),
  ('tipo_entrega', 'Tipo de Entrega', true),
  ('fornecedor',   'Fornecedor',    true),
  ('comprador',    'Comprador',     true),
  ('atraso',       'Atraso',        true),
  ('critico',      'Crítico?',      true),
  ('divergencia',  'Divergência',   true),
  ('amostral',     'Amostral',      true);

alter table public.listas enable row level security;
alter table public.lista_itens enable row level security;

create policy listas_select on public.listas
  for select to authenticated using (true);
create policy listas_write on public.listas
  for all to authenticated
  using (public.tem_permissao('administrar'))
  with check (public.tem_permissao('administrar'));

create policy lista_itens_select on public.lista_itens
  for select to authenticated using (true);
create policy lista_itens_write on public.lista_itens
  for all to authenticated
  using (public.tem_permissao('administrar'))
  with check (public.tem_permissao('administrar'));
