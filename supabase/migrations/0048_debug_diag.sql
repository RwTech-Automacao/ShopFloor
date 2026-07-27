create or replace function public.zz_diag(p_user uuid)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'user_existe', exists(select 1 from public.usuarios where id = p_user),
    'perfil_do_user', (select perfil_id from public.usuarios where id = p_user),
    'grants_via_join', (select jsonb_agg(pp.modulo||'.'||pp.permissao)
                        from public.usuarios u join public.perfil_permissao pp on pp.perfil_id = u.perfil_id
                        where u.id = p_user),
    'shopfloor_vis_global', exists(select 1 from public.perfil_permissao where modulo='shopfloor' and permissao='visualizar')
  );
$$;
grant execute on function public.zz_diag(uuid) to authenticated, anon;
