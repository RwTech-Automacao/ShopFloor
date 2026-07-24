-- =============================================================
-- CORREÇÃO CRÍTICA (definitiva): as tentativas por create-or-replace (0041 qualificado,
-- 0042 posicional) não surtiram efeito — a função 2-arg seguia ignorando o módulo.
-- Aqui fazemos o caminho garantido: DROP das 14 políticas sf_* que dependem da função,
-- DROP da função 2-arg, RECREATE com nomes de parâmetro sem colisão (p_modulo/p_perm),
-- e RECREATE das 14 políticas. sf_cancelar_integracao chama a função por aridade
-- (text,text) → resolve em tempo de execução, não precisa recriar.
-- =============================================================

-- 1) drop das políticas que dependem da função 2-arg
drop policy if exists sf_postos_select on public.sf_postos;
drop policy if exists sf_defeitos_select on public.sf_defeitos;
drop policy if exists sf_defeitos_admin on public.sf_defeitos;
drop policy if exists sf_ordens_select on public.sf_ordens;
drop policy if exists sf_ordens_admin on public.sf_ordens;
drop policy if exists sf_ordem_postos_select on public.sf_ordem_postos;
drop policy if exists sf_ordem_postos_admin on public.sf_ordem_postos;
drop policy if exists sf_ordem_componentes_select on public.sf_ordem_componentes;
drop policy if exists sf_ordem_componentes_admin on public.sf_ordem_componentes;
drop policy if exists sf_registros_select on public.sf_registros;
drop policy if exists sf_registros_insert on public.sf_registros;
drop policy if exists sf_integracoes_select on public.sf_integracoes;
drop policy if exists sf_integracao_itens_select on public.sf_integracao_itens;

-- 2) drop + recreate da função com parâmetros p_ (sem colisão com colunas)
drop function if exists public.tem_permissao(text, text);
create function public.tem_permissao(p_modulo text, p_perm text)
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
      and pp.modulo = p_modulo and pp.permissao = p_perm
  );
$$;

-- 3) recreate das políticas sf_* (módulo 'shopfloor')
create policy sf_postos_select on public.sf_postos
  for select using (tem_permissao('shopfloor', 'visualizar'));

create policy sf_defeitos_select on public.sf_defeitos
  for select using (tem_permissao('shopfloor', 'visualizar'));
create policy sf_defeitos_admin on public.sf_defeitos
  for all using (tem_permissao('shopfloor', 'administrar')) with check (tem_permissao('shopfloor', 'administrar'));

create policy sf_ordens_select on public.sf_ordens
  for select using (tem_permissao('shopfloor', 'visualizar'));
create policy sf_ordens_admin on public.sf_ordens
  for all using (tem_permissao('shopfloor', 'administrar')) with check (tem_permissao('shopfloor', 'administrar'));

create policy sf_ordem_postos_select on public.sf_ordem_postos
  for select using (tem_permissao('shopfloor', 'visualizar'));
create policy sf_ordem_postos_admin on public.sf_ordem_postos
  for all using (tem_permissao('shopfloor', 'administrar')) with check (tem_permissao('shopfloor', 'administrar'));

create policy sf_ordem_componentes_select on public.sf_ordem_componentes
  for select using (tem_permissao('shopfloor', 'visualizar'));
create policy sf_ordem_componentes_admin on public.sf_ordem_componentes
  for all using (tem_permissao('shopfloor', 'administrar')) with check (tem_permissao('shopfloor', 'administrar'));

create policy sf_registros_select on public.sf_registros
  for select using (tem_permissao('shopfloor', 'visualizar'));
create policy sf_registros_insert on public.sf_registros
  for insert with check (tem_permissao('shopfloor', 'lancar'));

create policy sf_integracoes_select on public.sf_integracoes
  for select using (tem_permissao('shopfloor', 'visualizar'));

create policy sf_integracao_itens_select on public.sf_integracao_itens
  for select using (tem_permissao('shopfloor', 'visualizar'));
