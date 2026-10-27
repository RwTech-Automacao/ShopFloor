-- Esquema mínimo para provar a 0161 (placas por painel) sem subir o banco inteiro.
-- As colunas novas e as constraints vêm da própria migração; aqui só as tabelas base.
create table public.sf_ordens (
  id uuid primary key default gen_random_uuid(),
  pmo text not null,
  op text not null,
  qtd int,
  unique (pmo, op)
);

create table public.sf_registros (
  id uuid primary key default gen_random_uuid(),
  pmo text not null,
  op text not null,
  numero_serie_norm text not null,
  data_hora timestamptz not null default now()
);
