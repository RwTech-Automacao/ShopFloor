-- Esquema mínimo para os testes do dashboard do Recebimento (0152), num banco PRÓPRIO (`dashboard`)
-- dentro do contêiner de supabase/tests/rodar-recebimento-test.sh. Banco próprio porque o dashboard
-- conta a TABELA INTEIRA: a massa do recebimento_fluxo_test.sql mudaria todos os totais.
-- Roda ANTES das migrações (0142, 0143, 0147, 0152), que o runner aplica uma a uma.

-- ---------- stubs mínimos do Supabase ----------
-- Papéis são do CLUSTER, não do banco: o recebimento_fluxo_test.sql (banco postgres, mesmo contêiner)
-- já os criou. Criar só o que faltar.
do $r$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $r$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $f$
  select nullif(current_setting('teste.uid', true), '')::uuid
$f$;
-- `teste.perms` = lista 'modulo.permissao' separada por vírgula (mesmo stub do recebimento_fluxo_test.sql).
create function public.tem_permissao(p_modulo text, p_perm text) returns boolean language sql stable as $f$
  select (',' || coalesce(current_setting('teste.perms', true), '') || ',')
         like '%,' || p_modulo || '.' || p_perm || ',%'
$f$;

-- FK da 0142 (divergencia_justificada_por) e o nome lido pela rec_justificar_divergencia.
create table public.usuarios (id uuid primary key, nome text not null default '', email text);

-- As colunas que o dashboard lê, com os tipos do banco real (0004): data_chegada é DATE.
create table public.processos_recebimento (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'aberto',
  numero_emb text,
  fornecedor text,
  comprador text,
  codigo_material text,
  data_chegada date,
  divergencia text,
  created_at timestamptz not null default now()
);
