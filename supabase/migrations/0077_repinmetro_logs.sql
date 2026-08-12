-- =============================================================
-- Espelho dos logs de teste do repinmetro (tela Teste Qualidade).
-- Alimentada pelo conector (tools/repinmetro-conector/) via service_role.
-- O ShopFloor só LÊ (tela "Repinmetro" em Análise, consulta por Nº de Série).
-- Chave de origem = teste.id (sequencial +1) → origem_id (watermark do conector).
-- =============================================================
create table public.repinmetro_logs (
  origem_id      bigint primary key,          -- teste.id na origem (watermark; upsert por aqui)
  numero_serie   text not null,               -- numeroserierep (produto final) — chave de consulta
  modelo         text,                        -- serialmodelorep
  data_inicio    timestamptz,                 -- datahorainicio
  data_fim       timestamptz,                 -- datahorafim
  status         text,                        -- status geral do teste
  observacao     text,
  remanufaturado text,
  lacre          text,
  op_codigo      text,                        -- codigoop  (bônus p/ v2: ligar à placa do ShopFloor)
  op_ano         text,                        -- anoop
  placa_op       text,                        -- numeroplacaop
  resultados     jsonb not null default '{}'::jsonb,  -- 15 itens (statusteste*), chave = coluna de origem
  espelhado_em   timestamptz not null default now()   -- quando o conector trouxe esta linha
);

create index repinmetro_logs_numero_serie on public.repinmetro_logs (numero_serie);

alter table public.repinmetro_logs enable row level security;
-- Leitura: quem pode visualizar. Escrita: só o conector (service_role bypassa RLS);
-- a policy de admin cobre correção manual pela equipe.
create policy repinmetro_logs_select on public.repinmetro_logs
  for select using (tem_permissao('visualizar'));
create policy repinmetro_logs_admin on public.repinmetro_logs
  for all using (tem_permissao('administrar')) with check (tem_permissao('administrar'));
