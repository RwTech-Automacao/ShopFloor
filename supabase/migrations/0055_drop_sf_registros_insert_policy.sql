-- =============================================================
-- Higiene/segurança pré-Prod: remove a policy de INSERT direto em sf_registros.
-- Toda escrita passa pelas funções atômicas (sf_lancar/sf_integrar/sf_burnin/
-- sf_registrar_reparo — security definer, furam o RLS). A policy permitia um
-- INSERT cru via API por quem tem shopfloor.lancar, PULANDO as validações
-- (sequência, anti-duplicidade, faixa, gate de Manutenção). Dropando, só os
-- RPCs escrevem registros. Só no Dev.
-- =============================================================

drop policy if exists sf_registros_insert on public.sf_registros;
