-- =============================================================================
-- bootstrap-rds.sql  —  prepara um RDS PostgreSQL "cru" para rodar o
-- Supabase self-hosted (Auth/GoTrue + PostgREST + Storage), SEM Realtime,
-- Vault/pgsodium, GraphQL, pg_cron ou pg_net (o app do ShopFloor não usa).
--
-- COMO RODAR:
--   1) Conecte no RDS como o usuário MASTER (postgres / rds_superuser),
--      no banco `postgres`:
--        psql "postgresql://postgres:SENHA_MASTER@<endpoint-rds>:5432/postgres"
--   2) Antes de rodar, troque o placeholder __SUPABASE_DB_PASSWORD__ pela
--      senha ÚNICA dos papéis do Supabase (a MESMA que vai no .env do Supabase
--      como POSTGRES_PASSWORD). Use só letras e números (sem símbolos).
--   3) Rode este arquivo ANTES de subir os containers do Supabase e ANTES de
--      restaurar o dump do Prod.
--
-- ORDEM GERAL DA MIGRAÇÃO:
--   RDS vazio -> [este script] -> sobe Supabase (GoTrue/Storage criam suas
--   tabelas em auth/storage) -> restaura o dump (public + dados + auth.users).
--
-- OBS: é um ponto de partida sólido. Na 1ª execução, se o GoTrue/Storage
-- reclamarem de alguma permissão específica, a gente concede pontualmente
-- (é assim que funciona o bootstrap de Postgres externo no self-host).
-- =============================================================================

\set ON_ERROR_STOP on

-- 1) EXTENSÕES ----------------------------------------------------------------
create schema if not exists extensions;
create extension if not exists pgcrypto        with schema extensions;
create extension if not exists "uuid-ossp"     with schema extensions;
create extension if not exists pg_stat_statements;
-- (pulados de propósito: pgjwt, pgsodium, supabase_vault, pg_graphql,
--  pg_net, pg_cron — indisponíveis no RDS e/ou não usados pelo app.)

-- 2) SCHEMAS DOS SERVIÇOS -----------------------------------------------------
create schema if not exists auth;     -- GoTrue cria as tabelas dele aqui
create schema if not exists storage;  -- Storage cria as tabelas dele aqui
-- `public` já existe.

-- 3) PAPÉIS (ROLES) -----------------------------------------------------------
-- 3a) Papéis de APLICAÇÃO (sem login): o PostgREST faz SET ROLE para eles.
do $func$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$func$;

-- 3b) Papéis de SERVIÇO (com login) — todos com a MESMA senha (a do .env).
do $func$
begin
  if not exists (select from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password '__SUPABASE_DB_PASSWORD__';
  end if;
  if not exists (select from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin login noinherit createrole password '__SUPABASE_DB_PASSWORD__';
  end if;
  if not exists (select from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin login noinherit createrole password '__SUPABASE_DB_PASSWORD__';
  end if;
  if not exists (select from pg_roles where rolname = 'supabase_admin') then
    -- NOTA: sem `replication` — o RDS não permite (exige superuser real) e não
    -- usamos Realtime, então não é necessário.
    create role supabase_admin login createrole createdb bypassrls
      password '__SUPABASE_DB_PASSWORD__';
  end if;
  if not exists (select from pg_roles where rolname = 'dashboard_user') then
    create role dashboard_user nologin createrole createdb;
  end if;
end
$func$;

-- 4) HIERARQUIA E GRANTS ------------------------------------------------------
-- O authenticator (PostgREST) pode "virar" os papéis de aplicação.
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;  -- master também, p/ admin

-- Cada serviço é dono do seu schema (assim as migrações dele criam as tabelas).
alter schema auth    owner to supabase_auth_admin;
alter schema storage owner to supabase_storage_admin;
grant all on schema auth    to supabase_auth_admin;
grant all on schema storage to supabase_storage_admin;

-- Uso dos schemas pelos papéis de aplicação.
grant usage on schema public     to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
-- IMPORTANTE: 'authenticated' e 'anon' PRECISAM de usage no schema auth — é o papel
-- efetivo quando o PostgREST faz SET ROLE authenticated. Sem isso, qualquer RPC
-- SECURITY INVOKER que chama auth.uid() direto (ex.: importar_processos) estoura
-- "permission denied for schema auth". (No Supabase real esse grant vem por padrão.)
grant usage on schema auth        to anon, authenticated, service_role, authenticator;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- Permissões no schema public (as tabelas do app protegem por RLS).
grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all routines  in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on routines  to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Papéis de app enxergam as extensões.
grant execute on all functions in schema extensions to anon, authenticated, service_role;

-- 5) RDS: elevar o supabase_admin (não existe SUPERUSER no RDS) ----------------
-- Dá o máximo de privilégio administrativo possível no RDS.
grant rds_superuser to supabase_admin;

-- 6) search_path dos admins → cada um opera no SEU schema (PG15 bloqueia CREATE
-- no public pra quem não é dono; sem isso GoTrue/Storage falham nas migrações).
alter role supabase_auth_admin    set search_path to auth, extensions;
alter role supabase_storage_admin set search_path to storage, extensions;

-- =============================================================================
-- FIM. Depois deste script:
--   * suba o Supabase (GoTrue/Storage rodam as próprias migrações),
--   * restaure o dump do Prod (public + dados + auth.users),
--   * confira: select count(*) from auth.users;  e as tabelas sf_*.
-- =============================================================================
