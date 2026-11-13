-- Rollback da 0184 (estrutura da OP). Roda numa transação (psql -1).
drop trigger if exists sf_registros_trecho_ins on public.sf_registros;
drop trigger if exists sf_registros_trecho_del on public.sf_registros;
drop function if exists public.sf_salvar_estrutura(text, jsonb, text, text);
drop function if exists public.sf_trecho_enfileirar();
drop function if exists public.sf_trecho_desfazer();
drop index if exists public.sf_estoque_envios_ordem;
drop index if exists public.sf_estoque_envios_ordem_alvo;
alter table public.sf_estoque_envios drop column if exists ordem_id;
drop table if exists public.sf_ordem_trechos;
drop table if exists public.sf_estrutura_trechos;
drop table if exists public.sf_estruturas;
notify pgrst, 'reload schema';
