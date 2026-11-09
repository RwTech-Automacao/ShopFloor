-- Mede o custo de sf_almox_pendencias_base() no banco real (a função que o cron do alerta de parado roda
-- a cada 5 minutos). SÓ LEITURA: transação read only, desfeita no fim; não grava nada.
-- Critério: <= 300 ms com OPs de 10 mil registros. Rode duas vezes e olhe a última linha "Execution Time".
begin read only;
explain (analyze, buffers) select * from public.sf_almox_pendencias_base();
rollback;
