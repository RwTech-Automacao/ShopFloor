-- =============================================================
-- Observação na integração.
--
-- Uso: integrações lançadas por AJUSTE com base numa hipótese, sem conferência física (OP 8504,
-- 21/09/2026 — placa associada ao produto pelo horário do Teste, peças já expedidas). Convenção:
-- a observação começa com '*'; a Grade e a Consultar Integração mostram o asterisco.
-- sf_registros já tem a coluna observacao.
-- =============================================================

alter table public.sf_integracoes add column if not exists observacao text;

notify pgrst, 'reload schema';
