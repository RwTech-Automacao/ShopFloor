-- =============================================================
-- CORREÇÃO CRÍTICA (review Fase 2a): em tem_permissao(modulo, perm) o parâmetro
-- `modulo` era sombreado pela coluna perfil_permissao.modulo → `pp.modulo = modulo`
-- virava `pp.modulo = pp.modulo` (sempre true) → o filtro de módulo sumia e o
-- vazamento Recebimento→ShopFloor continuava aberto.
-- Não dá pra renomear params num `create or replace` (42P13) nem dropar (as
-- políticas dependem da função). Solução: QUALIFICAR os params com o nome da
-- função (`tem_permissao.modulo`/`.perm`) — desfaz o sombreamento sem renomear.
-- =============================================================

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
      and pp.modulo = tem_permissao.modulo and pp.permissao = tem_permissao.perm
  );
$$;
