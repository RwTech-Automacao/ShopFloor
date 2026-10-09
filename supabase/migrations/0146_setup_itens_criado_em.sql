-- =============================================================
-- SETUP — DATA DE CRIAÇÃO DO ITEM
-- Spec: docs/superpowers/specs/2026-10-08-setup-linha-no-topo-design.md
--
-- A tela de Montar setup passa a mostrar a linha mais recente em primeiro. Para isso é preciso
-- saber QUANDO o item nasceu, e st_setup_itens só tinha atualizado_em, que muda ao editar (e editar
-- NÃO deve mover a linha). Esta migração acrescenta criado_em.
--
-- Nenhuma função muda: st_incluir_item faz insert sem listar a coluna, então o default now() basta;
-- st_editar_item e o caminho "atualizou" do st_incluir_item não tocam em criado_em.
--
-- Backfill: as linhas que já existem recebem o atualizado_em. É a melhor aproximação possível, e para
-- item nunca editado os dois valores são iguais.
--
-- Idempotente: add column if not exists; o update só toca linhas ainda sem criado_em; set default e
-- set not null podem ser repetidos.
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0146_setup_itens_criado_em.sql
-- =============================================================

-- Primeiro SEM default e nulável: com "default now()" no add column, o Postgres preencheria as linhas
-- antigas com a hora da migração e o backfill a partir de atualizado_em nunca valeria.
alter table public.st_setup_itens add column if not exists criado_em timestamptz;

update public.st_setup_itens set criado_em = atualizado_em where criado_em is null;

alter table public.st_setup_itens alter column criado_em set default now();
alter table public.st_setup_itens alter column criado_em set not null;

notify pgrst, 'reload schema';
