create or replace function public.zz_debug_pol(p_tabela text)
returns table(policyname text, cmd text, qual text, with_check text)
language sql security definer set search_path = public, pg_catalog as $$
  select policyname::text, cmd::text, qual::text, with_check::text
  from pg_policies where schemaname='public' and tablename = p_tabela;
$$;
grant execute on function public.zz_debug_pol(text) to authenticated, anon;
