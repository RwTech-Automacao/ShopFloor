-- Esquema mínimo para a 0196 (placa de PRT com série própria que terminou o trecho) nas bases de peças paradas
-- (_stubs + alertas_travados_esquema + alertas_ficha_esquema): os trechos da OP (0184, só as colunas que a 0196 lê) e
-- o gate do perfil do posto (0062). Mesmos nomes e tipos de produção. Idempotente.
alter table public.sf_posto_perfis add column if not exists gate text not null default 'registrado';

create table if not exists public.sf_ordem_trechos (
  ordem_id      uuid not null references public.sf_ordens(id) on delete cascade,
  seq           int  not null check (seq >= 1),
  codigo        text not null,
  tipo          text not null default 'prt' check (tipo in ('prt', 'pmo')),
  posto_conclui text not null,
  sn_modo       text not null default 'mesmo' check (sn_modo in ('mesmo', 'proprio')),
  compels_op    text,
  primary key (ordem_id, seq)
);

grant select on public.sf_ordem_trechos to anon, authenticated, service_role;
