-- =============================================================
-- RBAC Fase 2a — RLS por módulo, SÓ ShopFloor (sf_*).
-- Nova função tem_permissao(modulo, perm) lê os grants (perfil_permissao).
-- A tem_permissao(perm) antiga PERMANECE (Recebimento/Sistema + os RPCs de
-- 'lancar' seguem usando — pode_lancar ≡ shopfloor.lancar).
-- Reescreve as políticas sf_* + o único RPC que vaza (sf_cancelar_integracao).
-- Só no Dev (ShopFloor não está em Prod).
-- =============================================================

-- ---------- função nova (2 args, lê os grants) ----------
create or replace function public.tem_permissao(modulo text, perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.usuarios u
    join public.perfil_permissao pp on pp.perfil_id = u.perfil_id
    where u.id = auth.uid() and u.ativo
      and pp.modulo = modulo and pp.permissao = perm
  );
$$;

-- ---------- políticas sf_* → módulo 'shopfloor' ----------
-- sf_postos
drop policy if exists sf_postos_select on public.sf_postos;
create policy sf_postos_select on public.sf_postos
  for select using (tem_permissao('shopfloor', 'visualizar'));

-- sf_defeitos
drop policy if exists sf_defeitos_select on public.sf_defeitos;
create policy sf_defeitos_select on public.sf_defeitos
  for select using (tem_permissao('shopfloor', 'visualizar'));
drop policy if exists sf_defeitos_admin on public.sf_defeitos;
create policy sf_defeitos_admin on public.sf_defeitos
  for all using (tem_permissao('shopfloor', 'administrar')) with check (tem_permissao('shopfloor', 'administrar'));

-- sf_ordens
drop policy if exists sf_ordens_select on public.sf_ordens;
create policy sf_ordens_select on public.sf_ordens
  for select using (tem_permissao('shopfloor', 'visualizar'));
drop policy if exists sf_ordens_admin on public.sf_ordens;
create policy sf_ordens_admin on public.sf_ordens
  for all using (tem_permissao('shopfloor', 'administrar')) with check (tem_permissao('shopfloor', 'administrar'));

-- sf_ordem_postos
drop policy if exists sf_ordem_postos_select on public.sf_ordem_postos;
create policy sf_ordem_postos_select on public.sf_ordem_postos
  for select using (tem_permissao('shopfloor', 'visualizar'));
drop policy if exists sf_ordem_postos_admin on public.sf_ordem_postos;
create policy sf_ordem_postos_admin on public.sf_ordem_postos
  for all using (tem_permissao('shopfloor', 'administrar')) with check (tem_permissao('shopfloor', 'administrar'));

-- sf_ordem_componentes
drop policy if exists sf_ordem_componentes_select on public.sf_ordem_componentes;
create policy sf_ordem_componentes_select on public.sf_ordem_componentes
  for select using (tem_permissao('shopfloor', 'visualizar'));
drop policy if exists sf_ordem_componentes_admin on public.sf_ordem_componentes;
create policy sf_ordem_componentes_admin on public.sf_ordem_componentes
  for all using (tem_permissao('shopfloor', 'administrar')) with check (tem_permissao('shopfloor', 'administrar'));

-- sf_registros
drop policy if exists sf_registros_select on public.sf_registros;
create policy sf_registros_select on public.sf_registros
  for select using (tem_permissao('shopfloor', 'visualizar'));
drop policy if exists sf_registros_insert on public.sf_registros;
create policy sf_registros_insert on public.sf_registros
  for insert with check (tem_permissao('shopfloor', 'lancar'));

-- sf_integracoes
drop policy if exists sf_integracoes_select on public.sf_integracoes;
create policy sf_integracoes_select on public.sf_integracoes
  for select using (tem_permissao('shopfloor', 'visualizar'));

-- sf_integracao_itens
drop policy if exists sf_integracao_itens_select on public.sf_integracao_itens;
create policy sf_integracao_itens_select on public.sf_integracao_itens
  for select using (tem_permissao('shopfloor', 'visualizar'));

-- ---------- RPC que vaza: sf_cancelar_integracao → shopfloor.administrar ----------
create or replace function public.sf_cancelar_integracao(
  p_codigo text,
  p_por    text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not tem_permissao('shopfloor', 'administrar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;

  perform pg_advisory_xact_lock(hashtext('sf_integracao')::bigint);

  select id into v_id from sf_integracoes where codigo = p_codigo and status = 'ATIVA';
  if v_id is null then
    return jsonb_build_object('ok', false, 'erro', 'NAO_ENCONTRADA');
  end if;

  update sf_integracoes
  set status = 'CANCELADA', cancelada_em = now(), cancelada_por = coalesce(p_por, '')
  where id = v_id;

  -- desfaz a "passagem": o gate volta a travar e os SNs ficam livres (histórico fica no HDR + itens)
  delete from sf_registros where id_integracao = p_codigo;

  return jsonb_build_object('ok', true);
end;
$$;
