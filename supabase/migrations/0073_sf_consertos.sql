-- =============================================================
-- Catálogo de Consertos (espelho de sf_defeitos, porém SEM tipo).
-- Usado na Manutenção: o conserto deixa de ser texto livre e passa a
-- ser escolhido desta lista. Cadastro em Configurações → Consertos.
-- =============================================================
create table public.sf_consertos (
  codigo     text primary key,     -- ex.: '2001 RESSOLDA DE COMPONENTE'
  created_at timestamptz not null default now()
);
alter table public.sf_consertos enable row level security;
create policy sf_consertos_select on public.sf_consertos for select using (tem_permissao('visualizar'));
create policy sf_consertos_admin  on public.sf_consertos for all using (tem_permissao('administrar')) with check (tem_permissao('administrar'));
