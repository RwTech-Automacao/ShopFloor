-- Índice das janelas de alerta: as janelas `tempo` e `bipes` leem os bipes de UM POSTO em TODAS as
-- OPs, e os índices existentes começam por (pmo, op) — ou seja, não servem. Com este índice a
-- contagem da janela sai direto do índice, ordenada por data_hora desc.
--
-- ⚠️ CONCURRENTLY não roda dentro de transação (mesmo caso da 0095):
--    - Dev (SQL Editor do Supabase): REMOVA a palavra "concurrently" da linha abaixo.
--    - Prod/RDS: psql -f supabase/migrations/0114_sf_registros_posto_data_idx.sql  (SEM -1)
create index concurrently if not exists sf_registros_posto_data_hora
  on public.sf_registros (posto, data_hora desc);
