-- auth-helpers.sql — funções auth.uid()/auth.role()/auth.jwt()/auth.email()
-- Essas são fornecidas pelo Supabase (NÃO vêm do GoTrue). As policies RLS do app
-- referenciam elas, então precisam existir no RDS ANTES de restaurar o schema public.
--
-- Rodar conectado como supabase_auth_admin (dono do schema auth):
--   psql "host=<rds> port=5432 dbname=postgres user=supabase_auth_admin sslmode=require" -f auth-helpers.sql
-- (a senha do supabase_auth_admin = a mesma senha usada no bootstrap / POSTGRES_PASSWORD)

create or replace function auth.jwt() returns jsonb
  language sql stable
  as $func$
    select coalesce(
      nullif(current_setting('request.jwt.claim', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
  $func$;

create or replace function auth.uid() returns uuid
  language sql stable
  as $func$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $func$;

create or replace function auth.role() returns text
  language sql stable
  as $func$
    select coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    )::text
  $func$;

create or replace function auth.email() returns text
  language sql stable
  as $func$
    select coalesce(
      nullif(current_setting('request.jwt.claim.email', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
    )::text
  $func$;

grant execute on function auth.jwt()   to anon, authenticated, service_role;
grant execute on function auth.uid()   to anon, authenticated, service_role;
grant execute on function auth.role()  to anon, authenticated, service_role;
grant execute on function auth.email() to anon, authenticated, service_role;
