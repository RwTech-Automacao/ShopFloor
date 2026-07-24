-- =============================================================
-- CORREÇÃO CRÍTICA (2ª tentativa): a qualificação `tem_permissao.modulo` (0041)
-- NÃO desfez o sombreamento nesta função `language sql` — o teste de isolamento
-- mostrou que um perfil só-Recebimento ainda lia sf_ordens.
-- Solução à prova de bala: referenciar os parâmetros por POSIÇÃO ($1/$2), que
-- não podem ser sombreados por coluna. Mesma assinatura → create or replace.
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
    join public.perfil_permissao pp
      on pp.perfil_id = u.perfil_id
     and pp.modulo = $1
     and pp.permissao = $2
    where u.id = auth.uid() and u.ativo
  );
$$;
