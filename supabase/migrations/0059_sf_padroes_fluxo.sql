-- Padrões de Fluxo: moldes nomeados por PMO (postos + receita) para o Cadastro de OP.
create table public.sf_padroes_fluxo (
  id uuid primary key default gen_random_uuid(),
  pmo text not null,
  nome text not null,
  descricao text not null default '',
  postos jsonb not null default '[]'::jsonb,        -- array ORDENADO de nomes de posto
  componentes jsonb not null default '[]'::jsonb,   -- array de PMOs de placa (receita)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pmo, nome)
);
alter table public.sf_padroes_fluxo enable row level security;
create policy sf_padroes_fluxo_admin on public.sf_padroes_fluxo
  for all
  using (tem_permissao('shopfloor', 'administrar'))
  with check (tem_permissao('shopfloor', 'administrar'));
