-- Mede o custo de alerta_travados() no banco real (a função que o cron do alerta "Parado ou travado" roda
-- a cada 5 minutos, uma vez por regra). SÓ LEITURA: transação read only, desfeita no fim; não grava nada.
-- Todos os postos do catálogo, corte de 168 h (1 semana). Rode duas vezes e olhe a linha "Execution Time" de
-- cada uma das duas medidas: (1) só OPs ativas (o padrão da regra) e (2) todas as OPs (o pior caso).
-- Critério: (1) <= 1500 ms e (2) <= 5000 ms; a função roda a cada 5 minutos.
begin read only;

explain (analyze, buffers)
select * from public.alerta_travados(
  (select array_agg(chave) from public.sf_postos), '{}'::text[], now() - interval '168 hours', true, true);

explain (analyze, buffers)
select * from public.alerta_travados(
  (select array_agg(chave) from public.sf_postos), '{}'::text[], now() - interval '168 hours', false, true);

rollback;
