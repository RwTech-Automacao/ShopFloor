create table public.zz_canary_rls (x int);
grant select on public.zz_canary_rls to authenticated, anon;
