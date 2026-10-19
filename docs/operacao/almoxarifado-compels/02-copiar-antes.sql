-- =============================================================
-- ALMOXARIFADO + FILA DO COMPELS (0128–0133, 0153) — CÓPIA DO QUE AS MIGRAÇÕES SUBSTITUEM (rodar ANTES delas)
--
-- Das sete migrações, só DUAS mexem em coisa que já existe em produção: elas recriam
--   public.sf_nqa_caixa(text,text,text,text,text,text,text,jsonb)   (versão da 0100, a 0130 troca)
--   public.sf_cancelar_lancamento(uuid,text)                         (versão da 0106, a 0133 troca)
-- Tudo o mais é objeto novo (a fila, 7 funções, 1 linha em sf_posto_perfis) e some no rollback.
-- Nenhuma migração reescreve linha de dado existente. Por isso a cópia é de DEFINIÇÕES, não de linhas:
-- o texto completo (pg_get_functiondef), o md5 do corpo (o mesmo que o 01 confere) e a ACL das duas.
-- Fica tudo em public.almox_bkp_objetos, uma linha por função.
--
-- Para que serve: o 03-rollback.sql recria as duas funções a partir das migrações 0100/0106 e, no fim,
-- CONFERE o resultado contra esta cópia (avisa se o corpo ou a ACL devolvidos não forem iguais ao que
-- estava em produção). É também o registro, para recuperar à mão se um dia for preciso.
--
-- Pode rodar duas vezes: a tabela é criada só se não existir, e um objeto já copiado NÃO é copiado de
-- novo nem sobrescrito (on conflict do nothing) — vale sempre a primeira cópia.
-- ⚠️ Por isso, rode ANTES das migrações. Rodado depois, copiaria as versões NOVAS (e o rollback
-- avisaria que não bate).
--
-- O nome tem _bkp_ de propósito: os scripts de clone do banco excluem public.*bkp*.
-- A tabela fica FECHADA para o app (RLS ligada, sem grant para anon/authenticated): no Supabase,
-- tabela nova no schema public ganharia acesso pela API REST com a anon key.
--
-- Como rodar (UMA linha, senha no prompt do -W):
--   PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f /tmp/almox-02.sql
-- =============================================================

create table if not exists public.almox_bkp_objetos (
  tipo       text not null,               -- 'funcao'
  nome       text not null,               -- assinatura
  definicao  text not null,
  md5_corpo  text,                        -- md5(prosrc), o mesmo que o 01 confere
  acl        text,                        -- proacl
  copiado_em timestamptz not null default now(),
  primary key (tipo, nome)
);

comment on table public.almox_bkp_objetos is
  'Cópia, feita antes das migrações 0128–0133 e 0153 (Almoxarifado + fila do Compels), das 2 funções que elas substituem (sf_nqa_caixa e sf_cancelar_lancamento). Lida (só para conferir) pelo 03-rollback.sql. Apagar depois que o Almoxarifado estiver validado.';

alter table public.almox_bkp_objetos enable row level security;
revoke all on table public.almox_bkp_objetos from public, anon, authenticated;

\echo
\echo '== Objetos copiados AGORA (na primeira vez: funcao 2; na segunda rodada o normal é 0):'
with copiados as (
  insert into public.almox_bkp_objetos (tipo, nome, definicao, md5_corpo, acl)
  select 'funcao', p.oid::regprocedure::text, pg_get_functiondef(p.oid), md5(p.prosrc), p.proacl::text
    from pg_proc p
   where p.oid in (to_regprocedure('public.sf_nqa_caixa(text,text,text,text,text,text,text,jsonb)'),
                   to_regprocedure('public.sf_cancelar_lancamento(uuid,text)'))
  on conflict (tipo, nome) do nothing
  returning tipo
)
select 'funcao' as tipo, count(c.tipo) as copiados_agora
  from (select 1) x
  left join copiados c on true;

\echo
\echo '== Total guardado na cópia (o normal: funcao 2) e o md5 de cada corpo copiado'
\echo '   (tem que ser 83966057af3dd2643558b3bb213342a7 para sf_nqa_caixa e d7d065ebb018cc1825fff09b734a68ab'
\echo '    para sf_cancelar_lancamento — os mesmos "igual_ao_esperado = t" do 01):'
select tipo, nome, md5_corpo, copiado_em
  from public.almox_bkp_objetos
 order by tipo, nome;
