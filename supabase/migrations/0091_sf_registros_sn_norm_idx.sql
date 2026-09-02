-- Performance: busca por SN em TODAS as OPs (linha do tempo / buscarRegistrosPorSn) filtra SÓ por
-- numero_serie_norm (sem pmo/op). O índice composto (pmo,op,numero_serie_norm) NÃO serve (colunas
-- líderes ausentes) → full scan da sf_registros (dezenas de milhares de linhas), 20-30s.
-- Este índice de coluna única resolve. CONCURRENTLY = não trava escrita (bipe) na tabela viva.
-- ⚠️ CONCURRENTLY não pode rodar dentro de transação (rodar via psql -f, statement isolado).
create index concurrently if not exists sf_registros_sn_norm
  on public.sf_registros (numero_serie_norm);
