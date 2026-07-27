-- =============================================================
-- RBAC Fase 1 — correção: a SELECT de perfil_permissao não pode depender de
-- 'visualizar'. A sessão carrega os PRÓPRIOS grants via embed (RLS-filtrado);
-- um perfil com grant de ação mas sem 'visualizar' (ex.: só shopfloor.lancar)
-- ficaria com porModulo vazio → trava total. Os grants não são mais sensíveis
-- que as colunas pode_* (perfis já é `select using(true)`). Libera o select.
-- =============================================================

drop policy if exists perfil_permissao_select on public.perfil_permissao;
create policy perfil_permissao_select on public.perfil_permissao
  for select using (true);
