-- Esquema mínimo para os testes das MÉTRICAS do dashboard do Recebimento (0154), num banco PRÓPRIO (`dashmet`)
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
  created_at timestamptz not null default now(),
  -- extras das métricas (0154): nomes e tipos do banco real
  resultado text,
  data_prevista date,
  data_compra date,
  finalizado_em timestamptz,
  quantidade_recebida numeric,
  quantidade_reprovada numeric,
  motivo_reprovacao text,
  descricao_material text
);

-- O log de auditoria do app (só as colunas que importam), com o índice do banco real.
create table public.logs (
  id uuid primary key default gen_random_uuid(),
  entidade text,
  entidade_id uuid,
  acao text,
  descricao text,
  dados jsonb,
  usuario_id uuid,
  usuario_nome text,
  created_at timestamptz default now()
);
create index logs_entidade_idx on public.logs (entidade, entidade_id);
