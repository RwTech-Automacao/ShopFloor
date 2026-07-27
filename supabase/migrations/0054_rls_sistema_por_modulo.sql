-- =============================================================
-- RBAC Fase 2c — RLS por módulo: SISTEMA (usuarios, perfis, perfil_permissao, logs).
-- tem_permissao('administrar') → tem_permissao('sistema','administrar').
-- logs_select passa a exigir sistema.administrar (era 'visualizar' — decisão do
-- usuário: só admin de sistema vê o log de auditoria).
-- PRESERVA o crítico: `id = auth.uid()` no usuarios_select_self (cada um lê a
-- própria linha → getSessao/login NÃO quebra) e `sistema = false` no delete de perfis.
-- NÃO toca: perfis_select/perfil_permissao_select (using(true), getSessao precisa),
-- logs_insert (usuario_id=auth.uid(), registrarLog).
-- A tem_permissao(perm) de 1 arg PERMANECE (os 4 RPCs de 'lancar' ainda a usam).
-- Só no Dev.
-- =============================================================

-- usuarios
drop policy if exists usuarios_select_self on public.usuarios;
create policy usuarios_select_self on public.usuarios
  for select to authenticated using ((id = auth.uid()) or tem_permissao('sistema','administrar'));
drop policy if exists usuarios_insert on public.usuarios;
create policy usuarios_insert on public.usuarios
  for insert to authenticated with check (tem_permissao('sistema','administrar'));
drop policy if exists usuarios_update on public.usuarios;
create policy usuarios_update on public.usuarios
  for update to authenticated using (tem_permissao('sistema','administrar'));
drop policy if exists usuarios_delete on public.usuarios;
create policy usuarios_delete on public.usuarios
  for delete to authenticated using (tem_permissao('sistema','administrar'));

-- perfis
drop policy if exists perfis_insert on public.perfis;
create policy perfis_insert on public.perfis
  for insert to authenticated with check (tem_permissao('sistema','administrar'));
drop policy if exists perfis_update on public.perfis;
create policy perfis_update on public.perfis
  for update to authenticated using (tem_permissao('sistema','administrar'));
drop policy if exists perfis_delete on public.perfis;
create policy perfis_delete on public.perfis
  for delete to authenticated using (tem_permissao('sistema','administrar') and sistema = false);

-- perfil_permissao (admin) — TO public, como o original
drop policy if exists perfil_permissao_admin on public.perfil_permissao;
create policy perfil_permissao_admin on public.perfil_permissao
  for all using (tem_permissao('sistema','administrar')) with check (tem_permissao('sistema','administrar'));

-- logs (select) — só admin de sistema (era 'visualizar')
drop policy if exists logs_select on public.logs;
create policy logs_select on public.logs
  for select to authenticated using (tem_permissao('sistema','administrar'));

-- limpeza do objeto de diagnóstico
drop function if exists public.zz_pol_sys();
