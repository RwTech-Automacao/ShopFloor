-- Prova a 0176. Esquema mínimo: só a sf_ordens como era antes da migração, com OPs "antigas".
\set ON_ERROR_STOP on
create extension if not exists pgcrypto;
drop table if exists public.sf_ordens cascade;
create table public.sf_ordens (
  id uuid primary key default gen_random_uuid(),
  pmo text not null,
  op text not null,
  unique (pmo, op)
);
insert into public.sf_ordens (pmo, op) values ('PMOA', '1001'), ('PMOA', '1002');
