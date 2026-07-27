create or replace function public.zz_test_perm(p_user uuid, p_mod text, p_perm text)
returns boolean language sql security definer set search_path = public as $$
  select exists(select 1 from public.usuarios u
    join public.perfil_permissao pp on pp.perfil_id = u.perfil_id
    where u.id = p_user and u.ativo and pp.modulo = p_mod and pp.permissao = p_perm);
$$;
grant execute on function public.zz_test_perm(uuid,text,text) to authenticated, anon;
