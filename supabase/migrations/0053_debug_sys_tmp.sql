create or replace function public.zz_pol_sys()
returns table(tabela text, policyname text, cmd text, roles text, qual text, with_check text)
language sql security definer set search_path = public, pg_catalog as $$
  select tablename::text, policyname::text, cmd::text, array_to_string(roles,',')::text, qual::text, with_check::text
  from pg_policies
  where schemaname='public' and tablename in ('usuarios','perfis','logs','perfil_permissao')
  order by tablename, policyname;
$$;
grant execute on function public.zz_pol_sys() to authenticated, anon;
