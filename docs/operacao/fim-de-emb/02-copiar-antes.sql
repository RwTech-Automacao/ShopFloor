-- =============================================================
-- FIM DE EMB (0149 + 0150 + 0151) — CÓPIA DO QUE AS MIGRAÇÕES SUBSTITUEM (rodar ANTES delas)
--
-- As três migrações NÃO reescrevem linha nenhuma de dado: só acrescentam a coluna `modulo` (com
-- default 'shopfloor', que não muda o que já existe), trocam CHECKs, trocam 3 policies e recriam
-- 5 funções. Por isso a cópia é de DEFINIÇÕES, não de linhas:
--   - o texto completo (pg_get_functiondef), o md5 do corpo e a ACL das 5 funções substituídas;
--   - as policies de alerta_regras, alerta_envios e alerta_ocorrencias (pg_policies);
--   - os CHECKs de alerta_regras e alerta_envios (pg_get_constraintdef).
-- Fica tudo em public.alerta_bkp_0149_0151_objetos, uma linha por objeto.
--
-- Para que serve: o 03-rollback-0149-0151.sql recria tudo a partir das migrações antigas
-- (0141/0137/0123/0115/0113), e no fim CONFERE o resultado contra esta cópia (avisa se o corpo
-- devolvido não for igual ao que estava em produção). É também o registro, para recuperar à mão,
-- se um dia for preciso.
--
-- Pode rodar duas vezes: a tabela é criada só se não existir, e um objeto já copiado NÃO é
-- copiado de novo nem sobrescrito (on conflict do nothing) — vale sempre a primeira cópia.
-- ⚠️ Por isso, rode ANTES das migrações. Rodado depois, copiaria as versões NOVAS (e o rollback
-- avisaria que não bate).
--
-- O nome tem _bkp_ de propósito: os scripts de clone do banco excluem public.*bkp*.
-- A tabela fica FECHADA para o app (RLS ligada, sem grant para anon/authenticated): no Supabase,
-- tabela nova no schema public ganharia acesso pela API REST com a anon key.
--
-- Como rodar (UMA linha, senha no prompt do -W):
--   PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f /tmp/fimemb-02.sql
-- =============================================================

create table if not exists public.alerta_bkp_0149_0151_objetos (
  tipo       text not null,               -- 'funcao' | 'policy' | 'check'
  nome       text not null,               -- assinatura / tabela.policy / tabela.constraint
  definicao  text not null,
  md5_corpo  text,                        -- só funções: md5(prosrc), o mesmo que o 01 confere
  acl        text,                        -- só funções: proacl
  copiado_em timestamptz not null default now(),
  primary key (tipo, nome)
);

comment on table public.alerta_bkp_0149_0151_objetos is
  'Cópia, feita antes das migrações 0149–0151, das funções, policies e checks que elas substituem. Lida (só para conferir) pelo 03-rollback-0149-0151.sql. Apagar depois que o Fim de EMB estiver validado.';

alter table public.alerta_bkp_0149_0151_objetos enable row level security;
revoke all on table public.alerta_bkp_0149_0151_objetos from public, anon, authenticated;

\echo
\echo '== Objetos copiados AGORA (na primeira vez: 5 funções, 6 policies e os checks das duas tabelas;'
\echo '   na segunda rodada o normal é tudo 0):'
with copiados as (
  insert into public.alerta_bkp_0149_0151_objetos (tipo, nome, definicao, md5_corpo, acl)
  select 'funcao', p.oid::regprocedure::text, pg_get_functiondef(p.oid), md5(p.prosrc), p.proacl::text
    from pg_proc p
   where p.oid in (to_regprocedure('public.alerta_avaliar(text,jsonb,jsonb)'),
                   to_regprocedure('public.alerta_resolver_interno(uuid,uuid,boolean,text)'),
                   to_regprocedure('public.alerta_reservar_envios(text[],integer,uuid)'),
                   to_regprocedure('public.alerta_destinatarios()'),
                   to_regprocedure('public.alerta_listar_ocorrencias(timestamptz,timestamptz,text)'))
  union all
  select 'policy', p.tablename || '.' || p.policyname,
         format('cmd=%s roles=%s using=%s check=%s', p.cmd, array_to_string(p.roles, ','),
                coalesce(p.qual, ''), coalesce(p.with_check, '')),
         null, null
    from pg_policies p
   where p.schemaname = 'public' and p.tablename in ('alerta_regras', 'alerta_envios', 'alerta_ocorrencias')
  union all
  select 'check', c.conrelid::regclass::text || '.' || c.conname, pg_get_constraintdef(c.oid), null, null
    from pg_constraint c
   where c.conrelid in ('public.alerta_regras'::regclass, 'public.alerta_envios'::regclass)
     and c.contype = 'c'
  on conflict (tipo, nome) do nothing
  returning tipo
)
select t.tipo, count(c.tipo) as copiados_agora
  from (values ('funcao'), ('policy'), ('check')) t(tipo)
  left join copiados c on c.tipo = t.tipo
 group by t.tipo
 order by t.tipo;

\echo
\echo '== Total guardado na cópia (o normal: funcao 5, policy 6, check 24):'
select tipo, count(*) as total_na_copia, min(copiado_em) as primeira_copia
  from public.alerta_bkp_0149_0151_objetos
 group by tipo
 order by tipo;
