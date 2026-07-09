create table public.geracoes_etiquetas (
  id uuid primary key default gen_random_uuid(),
  filtro_tipo text not null check (filtro_tipo in ('nf','emb','fornecedor')),
  filtro_valor text not null default '',
  total_processos int not null default 0,
  total_etiquetas int not null default 0,
  processo_ids jsonb not null default '[]'::jsonb,
  usuario_id uuid references public.usuarios(id),
  usuario_nome text not null default '',
  created_at timestamptz not null default now()
);
create index geracoes_etiquetas_created_idx on public.geracoes_etiquetas(created_at desc);

alter table public.geracoes_etiquetas enable row level security;
create policy geracoes_select on public.geracoes_etiquetas
  for select to authenticated using (public.tem_permissao('visualizar'));
create policy geracoes_insert on public.geracoes_etiquetas
  for insert to authenticated with check (public.tem_permissao('gerar_etiqueta') and usuario_id = auth.uid());
