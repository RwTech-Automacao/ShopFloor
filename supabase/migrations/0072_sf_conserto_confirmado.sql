-- =============================================================
-- Confirmação de conserto: quando uma peça reprovada num posto que
-- conserta no próprio posto (reprova≠nenhum, sem Manutenção) é aprovada,
-- o operador confirma que o defeito foi consertado. Auditoria de quem/quando.
-- Uma linha por defeito confirmado.
-- =============================================================
create table public.sf_conserto_confirmado (
  id                uuid primary key default gen_random_uuid(),
  data_hora         timestamptz not null default now(),
  colaborador       text not null default '',
  pmo               text not null,
  op                text not null,
  numero_serie      text not null default '',
  numero_serie_norm text not null default '',
  posto             text not null,
  codigo_defeito    text not null default '',
  posicao           text not null default '',
  tipo_defeito      text not null default '',
  created_at        timestamptz not null default now()
);
alter table public.sf_conserto_confirmado enable row level security;
create policy sf_conserto_confirmado_select on public.sf_conserto_confirmado
  for select using (tem_permissao('visualizar'));
create policy sf_conserto_confirmado_insert on public.sf_conserto_confirmado
  for insert with check (tem_permissao('lancar'));
create index sf_conserto_confirmado_sn on public.sf_conserto_confirmado (pmo, op, numero_serie_norm, posto);
