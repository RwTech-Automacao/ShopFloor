-- =============================================================
-- 0152 — CÓPIA DAS LINHAS QUE O UPDATE DA 0152 VAI MUDAR (rodar ANTES da 0152)
--
-- A 0152 tem um UPDATE que deixa vazias ('') as justificativas de divergência feitas só de
-- espaços. Este arquivo guarda, ANTES, o estado dessas linhas na tabela
-- public.processos_recebimento_bkp_0152, para o 03-rollback-0152.sql poder devolver o texto.
--
-- Copia EXATAMENTE o WHERE do UPDATE da 0152:
--   divergencia_justificativa <> '' and btrim(divergencia_justificativa) = ''
--
-- Pode rodar duas vezes: a tabela é criada só se não existir, e uma linha já copiada NÃO é
-- copiada de novo nem sobrescrita (on conflict do nothing) — vale sempre a primeira cópia.
-- Depois da 0152 aplicada, rodar de novo copia 0 linhas (não há mais o que copiar).
--
-- O nome termina em _bkp_0152 de propósito: os scripts de clone do banco excluem public.*bkp*.
-- A tabela fica FECHADA para o app (RLS ligada, sem grant para anon/authenticated): no Supabase,
-- tabela nova no schema public ganharia acesso pela API REST com a anon key.
--
-- Como rodar (UMA linha, senha no prompt do -W):
--   PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f /tmp/0152-02.sql
--
-- Apagar a cópia (só quando a 0152 estiver validada em produção e ninguém precisar mais dela):
--   psql ... -c "drop table if exists public.processos_recebimento_bkp_0152;"
-- =============================================================

create table if not exists public.processos_recebimento_bkp_0152 (
  id                               uuid primary key,
  divergencia_justificativa        text not null,
  divergencia_justificada_por      uuid,
  divergencia_justificada_em       timestamptz,
  divergencia_justificada_por_nome text,
  updated_at                       timestamptz,
  copiado_em                       timestamptz not null default now()
);

comment on table public.processos_recebimento_bkp_0152 is
  'Cópia, feita antes da migração 0152, das justificativas só-de-espaços que ela deixa vazias. Lida pelo 03-rollback-0152.sql. Apagar depois que a 0152 estiver validada.';

alter table public.processos_recebimento_bkp_0152 enable row level security;
revoke all on table public.processos_recebimento_bkp_0152 from public, anon, authenticated;

\echo
\echo '== Linhas copiadas AGORA (na segunda rodada, ou depois da 0152, o normal é 0):'
with copiadas as (
  insert into public.processos_recebimento_bkp_0152
         (id, divergencia_justificativa, divergencia_justificada_por, divergencia_justificada_em,
          divergencia_justificada_por_nome, updated_at)
  select p.id, p.divergencia_justificativa, p.divergencia_justificada_por, p.divergencia_justificada_em,
         p.divergencia_justificada_por_nome, p.updated_at
    from public.processos_recebimento p
   where p.divergencia_justificativa <> ''
     and btrim(p.divergencia_justificativa) = ''
  on conflict (id) do nothing
  returning 1
)
select count(*) as linhas_copiadas_agora from copiadas;

\echo
\echo '== Total guardado na cópia (tem que ser igual a linhas_que_o_update_muda do 01-conferir-antes.sql):'
select count(*) as total_na_copia,
       min(copiado_em) as primeira_copia,
       max(copiado_em) as ultima_copia
  from public.processos_recebimento_bkp_0152;
