-- Esquema mínimo do chão de fábrica para o teste da 0172 (alertas_travados_test.sql). Esta base do runner
-- de alertas só tem o _stubs.sql (sf_registros e sf_ordens enxutos): a 0172 lê também o número de série, o
-- peso do bipe (`pecas`, 0161), o desempate `created_at`, o status da OP e a rota (sf_ordem_postos). Mesmos
-- nomes e tipos de produção; o índice é o MESMO de produção (0028), o que o plano da alerta_travados usa.
alter table public.sf_registros add column if not exists numero_serie text not null default '';
alter table public.sf_registros add column if not exists numero_serie_norm text not null default '';
alter table public.sf_registros add column if not exists pecas int not null default 1;
alter table public.sf_registros add column if not exists created_at timestamptz not null default now();
alter table public.sf_ordens add column if not exists status text not null default '';

create table if not exists public.sf_ordem_postos (
  ordem_id uuid not null references public.sf_ordens(id) on delete cascade,
  posto text not null,
  ordem int not null default 0,
  primary key (ordem_id, posto)
);

create index if not exists sf_registros_ordem_sn on public.sf_registros (pmo, op, numero_serie_norm);

grant select on public.sf_ordem_postos to anon, authenticated, service_role;
