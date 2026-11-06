-- Esquema MÍNIMO para provar a 0174 (rota de retorno da manutenção filtrada pela rota da OP).
\set ON_ERROR_STOP on
create extension if not exists pgcrypto;

-- Os papéis que o Supabase já traz (o Postgres descartável não tem).
do $f$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $f$;

create or replace function public.tem_permissao(p text) returns boolean language sql as $f$ select true $f$;

create table public.sf_postos (
  chave text primary key,
  retorno_pos_manutencao text not null default ''
);
create table public.sf_ordens (
  id uuid primary key default gen_random_uuid(),
  pmo text not null,
  op text not null,
  unique (pmo, op)
);
create table public.sf_ordem_postos (
  ordem_id uuid not null references public.sf_ordens(id) on delete cascade,
  posto text not null references public.sf_postos(chave),
  ordem int not null default 0,
  primary key (ordem_id, posto)
);
create table public.sf_registros (
  id uuid primary key default gen_random_uuid(),
  data_hora timestamptz not null default now(),
  colaborador text not null default '',
  posto text not null,
  pmo text not null,
  op text not null,
  cliente text not null default '',
  numero_serie text not null default '',
  numero_serie_norm text not null default '',
  codigo_defeito text not null default '',
  posicao text not null default '',
  tipo_defeito text not null default '',
  reparo_conserto text not null default '',
  reparo_posicao text not null default '',
  posto_origem text not null default '',
  data_hora_origem timestamptz,
  reparo_constatado boolean not null default false,
  posto_retorno text,
  created_at timestamptz not null default now()
);

insert into public.sf_postos (chave, retorno_pos_manutencao) values
  ('Integração', ''), ('Inspeção PTH', ''), ('Teste', 'Inspeção PTH'), ('Inspeção Final', ''),
  ('Embalagem', ''), ('Manutenção', ''), ('Teste Final', 'Inspeção PTH,Inspeção Final');

-- OP COM Inspeção PTH na rota
with o as (insert into public.sf_ordens (pmo, op) values ('PMOA', '1001') returning id)
insert into public.sf_ordem_postos (ordem_id, posto, ordem)
select o.id, x.p, x.n from o, (values ('Integração',1),('Inspeção PTH',2),('Teste',3),('Embalagem',4)) as x(p,n);

-- OP SEM Inspeção PTH (o caso do bug)
with o as (insert into public.sf_ordens (pmo, op) values ('PMOB', '2002') returning id)
insert into public.sf_ordem_postos (ordem_id, posto, ordem)
select o.id, x.p, x.n from o, (values ('Integração',1),('Teste',2),('Embalagem',3)) as x(p,n);

-- OP só com a Inspeção Final (para a lista de duas)
with o as (insert into public.sf_ordens (pmo, op) values ('PMOC', '3003') returning id)
insert into public.sf_ordem_postos (ordem_id, posto, ordem)
select o.id, x.p, x.n from o, (values ('Integração',1),('Teste Final',2),('Inspeção Final',3)) as x(p,n);
