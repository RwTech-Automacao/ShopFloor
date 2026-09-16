-- =============================================================
-- Espelho da revenda de cada REP (sistema de chaves, tela "REPs/Revendas").
-- Alimentada pelo conector (tools/repinmetro-conector/) via service_role, a partir da view
-- `vw_shopfloor_rep_revenda` do banco do repinmetro (serial + datas + razão social, SEM a chave).
-- O ShopFloor só LÊ: a tela Repinmetro mostra a revenda no card do teste.
--
-- O serial completo tem 17 dígitos: prefixo fixo 00043 + modelo (5) + nº de série (7).
--   ex.: 00043005620016176 → modelo 00562, nº de série 0016176
-- O casamento com o teste é por (modelo, numero_serie_norm), o mesmo par que a tela já busca.
--
-- A revenda é associada DEPOIS do teste e pode mudar, e a origem não tem data de alteração:
-- o conector recarrega tudo a cada rodada e apaga o que sumiu da origem.
-- =============================================================
create table public.repinmetro_revendas (
  numero_serie_completo text primary key,               -- numeroserierep (17 dígitos)
  modelo                text not null default '',       -- dígitos 6–10 do serial
  numero_serie          text not null default '',       -- últimos 7 dígitos
  numero_serie_norm     text not null default '',       -- nº de série normalizado (casa com repinmetro_logs)
  revenda               text,                           -- revenda.razaosocial (null = sem revenda associada)
  gravada_em            timestamptz,                    -- datahora (gravação da chave)
  saida_em              timestamptz,                    -- datahorasaidaexpedicao
  espelhado_em          timestamptz not null default now() -- rodada do conector que trouxe a linha
);

create index repinmetro_revendas_modelo_sn on public.repinmetro_revendas (modelo, numero_serie_norm);
create index repinmetro_revendas_espelhado_em on public.repinmetro_revendas (espelhado_em);

alter table public.repinmetro_revendas enable row level security;
-- Mesmo acesso da repinmetro_logs. `(select ...)` pra avaliar a permissão uma vez por consulta (0096).
create policy repinmetro_revendas_select on public.repinmetro_revendas
  for select using ((select tem_permissao('visualizar')));
create policy repinmetro_revendas_admin on public.repinmetro_revendas
  for all using ((select tem_permissao('administrar'))) with check ((select tem_permissao('administrar')));

-- Permissões explícitas: no RDS da AWS o schema public foi recriado no corte e os privilégios padrão
-- do Supabase podem não valer pra tabela nova. Sem isso o conector (service_role) não grava.
grant select on public.repinmetro_revendas to authenticated;
grant select, insert, update, delete on public.repinmetro_revendas to service_role;

notify pgrst, 'reload schema';
