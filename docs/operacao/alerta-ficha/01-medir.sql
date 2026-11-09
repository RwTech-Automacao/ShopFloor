-- Mede o custo de alerta_ficha_novas() no banco real (a função que o cron do alerta "Ficha de apontamento" roda a
-- cada 5 minutos, uma vez por regra). SÓ LEITURA: transação read only, desfeita no fim; não grava nada.
-- (1) dia normal: piso de 3 dias, o teto da regra.  (2) pior caso: piso de 30 dias (todas as OPs ativas "mexeram").
-- Rode duas vezes e olhe a linha "Execution Time" de cada medida. Critério: <= 1500 ms nas duas.
begin read only;

explain (analyze, buffers)
select * from public.alerta_ficha_novas(null, '{}'::text[], now() - interval '3 days', 30);

explain (analyze, buffers)
select * from public.alerta_ficha_novas(null, '{}'::text[], now() - interval '30 days', 30);

rollback;
