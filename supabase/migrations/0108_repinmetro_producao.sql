-- =============================================================
-- Espelho dos testes de produção do repinmetro (integração do REP: quais peças foram montadas).
-- Alimentada pelo conector (tools/repinmetro-conector/) via service_role, a partir de
-- teste × testeproducao no banco do repinmetro. O ShopFloor só LÊ: Análise → Repinmetro → Integração.
--
-- Busca nos dois sentidos:
--   • pelo produto final: modelo + nº de série do REP (numero_serie_norm), igual à aba Testes;
--   • pelo produto integrado: serial de qualquer peça, normalizado, em `seriais_norm` (índice GIN).
-- Um REP pode ter vários testes de produção (reteste), por isso a chave é o id do teste na origem.
-- =============================================================
create table public.repinmetro_producao (
  origem_id          bigint primary key,               -- teste.id na origem (marca d'água do conector)
  numero_serie       text not null,                    -- numeroserierep (REP)
  numero_serie_norm  text not null default '',
  modelo             text,                             -- serialmodelorep
  data_inicio        timestamptz,
  data_fim           timestamptz,
  status             text,                             -- APROVADO / REPROVADO / INICIADO
  observacao         text,
  serial_impressora  text,
  serial_mrp         text,
  serial_modulo_bio  text,
  serial_rfid        text,
  serial_fonte       text,
  serial_barras      text,
  seriais_norm       text[] not null default '{}',     -- seriais das peças normalizados (busca por peça)
  resultados         jsonb not null default '{}'::jsonb, -- 12 itens do teste de produção (statusteste*)
  espelhado_em       timestamptz not null default now()
);

create index repinmetro_producao_numero_serie_norm on public.repinmetro_producao (numero_serie_norm);
create index repinmetro_producao_seriais_norm on public.repinmetro_producao using gin (seriais_norm);

alter table public.repinmetro_producao enable row level security;
-- Mesmo acesso das outras tabelas do repinmetro. `(select ...)` avalia a permissão uma vez por consulta (0096).
create policy repinmetro_producao_select on public.repinmetro_producao
  for select using ((select tem_permissao('visualizar')));
create policy repinmetro_producao_admin on public.repinmetro_producao
  for all using ((select tem_permissao('administrar'))) with check ((select tem_permissao('administrar')));

-- Permissões explícitas (no RDS o schema public foi recriado no corte; ver 0107).
grant select on public.repinmetro_producao to authenticated;
grant select, insert, update, delete on public.repinmetro_producao to service_role;

notify pgrst, 'reload schema';
