-- Performance das telas de Defeitos e do detalhe do posto (Fluxo).
--
-- Problema: as duas consultas filtram por OP (+posto) e pedem as 100 mais RECENTES, mas os índices
-- existentes não cobrem a ORDENAÇÃO. Resultado: o Postgres lê todas as linhas da OP que casam com o
-- filtro, ORDENA tudo e só então descarta e devolve 100 — cresce junto com a OP.
-- Com os índices abaixo (ordenados por data_hora desc), as 100 linhas saem direto do índice.
--
-- ⚠️ CONCURRENTLY não roda dentro de transação:
--    - No Prod (psql -f): mantém como está (não trava o bipe na tabela viva).
--    - No SQL Editor do Supabase (Dev): REMOVA a palavra "concurrently" das duas linhas.

-- As duas telas ordenam por (data_hora desc, id desc) — o `id` entra no índice pra a ordenação sair
-- 100% do índice (sem sort nem no desempate).

-- 1) Tela de Defeitos: where pmo=? and op=? and codigo_defeito <> '' order by data_hora desc, id desc limit 100
--    Índice PARCIAL (só linhas COM defeito) → menor e mais rápido que um índice cheio.
create index concurrently if not exists sf_registros_defeitos_op
  on public.sf_registros (pmo, op, data_hora desc, id desc)
  where codigo_defeito <> '';

-- 2) Histórico do posto (acordeon do detalhe): where pmo=? and op=? and posto=? order by data_hora desc, id desc limit 100
create index concurrently if not exists sf_registros_posto_data
  on public.sf_registros (pmo, op, posto, data_hora desc, id desc);
