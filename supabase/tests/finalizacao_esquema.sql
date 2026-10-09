-- Esquema mínimo para provar a 0145 sem subir o banco inteiro. Só o que a 0121 e a 0145 leem.
-- Roda ANTES da 0121 (que referencia estas tabelas e dá grant a authenticated/service_role).
create role anon;
create role authenticated;
create role service_role bypassrls;

create table public.sf_ordens (
  id uuid primary key default gen_random_uuid(),
  pmo text not null,
  op text not null,
  qtd int,
  status text not null default '',
  updated_at timestamptz not null default now(),
  unique (pmo, op)
);

create table public.sf_ordem_postos (
  ordem_id uuid not null references public.sf_ordens(id) on delete cascade,
  posto text not null,
  ordem int not null default 0,
  primary key (ordem_id, posto)
);

create table public.sf_registros (
  id uuid primary key default gen_random_uuid(),
  data_hora timestamptz not null default now(),
  pmo text not null,
  op text not null,
  posto text not null,
  status text not null default 'aprovado',
  numero_serie_norm text not null
);

grant select, insert, update, delete on public.sf_ordens, public.sf_ordem_postos, public.sf_registros
  to authenticated, service_role;
