-- Padrões de mapeamento reutilizáveis da importação: guardam o de-para
-- coluna-da-planilha → campo (JSONB) com um nome, para reaplicar em planilhas
-- futuras. Compartilhados: quem importa gerencia; admin também.
create table public.padroes_importacao (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  mapeamento  jsonb not null default '{}'::jsonb,   -- { campo_do_banco: nome_da_coluna }
  criado_por  uuid references public.usuarios(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Nome único, case-insensitive (evita "Fornecedor X" e "fornecedor x" duplicados).
create unique index padroes_importacao_nome_unq
  on public.padroes_importacao (lower(nome));

alter table public.padroes_importacao enable row level security;

-- Todos que importam gerenciam; admin também.
create policy padroes_importacao_select on public.padroes_importacao
  for select to authenticated
  using (public.tem_permissao('importar') or public.tem_permissao('administrar'));

create policy padroes_importacao_write on public.padroes_importacao
  for all to authenticated
  using (public.tem_permissao('importar') or public.tem_permissao('administrar'))
  with check (public.tem_permissao('importar') or public.tem_permissao('administrar'));
