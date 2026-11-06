-- 0169_sf_estoque_envios_aviso.sql
-- Fila do Compels: coluna `aviso` — a entrada FOI enviada (ok = true), mas algo pede conferência:
-- quantidade inesperada no apontado da OP (apontamento manual/antecipado, estorno à mão), empenho ou
-- requisição insuficientes. Decisão de 06/11/2026: a integração deixa de PARAR por apontado diferente
-- do esperado; grava e avisa. É o que o tipo de alerta de problemas do Compels lê.
--
-- Aditiva e idempotente (`if not exists`). O app só escreve a coluna em linha com aviso, então a ordem
-- de deploy não derruba o envio normal — mesmo assim aplique a migração ANTES do app.
alter table public.sf_estoque_envios add column if not exists aviso text;

comment on column public.sf_estoque_envios.aviso is
  'Enviada com ressalva (ok = true): quantidade inesperada no Compels, empenho/requisição insuficientes. Nulo = nada a conferir.';

notify pgrst, 'reload schema';
