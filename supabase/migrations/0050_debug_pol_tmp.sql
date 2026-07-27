create or replace function public.zz_pol_dump()
returns table(schemaname text, tabela text, policyname text, cmd text, qual text, with_check text)
language sql security definer set search_path = public, pg_catalog as $$
  select schemaname::text, tablename::text, policyname::text, cmd::text, qual::text, with_check::text
  from pg_policies
  where (schemaname='storage')
     or (schemaname='public' and tablename not like 'sf\_%' and tablename <> 'perfil_permissao'
         and (qual like '%tem_permissao%' or with_check like '%tem_permissao%'))
  order by schemaname, tablename, policyname;
$$;
grant execute on function public.zz_pol_dump() to authenticated, anon;
