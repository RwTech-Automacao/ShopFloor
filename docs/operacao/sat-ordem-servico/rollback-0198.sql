-- =============================================================
-- ROLLBACK da 0198 (SAT: ordem de serviço) — desliga os gatilhos; tabelas, funções e dados FICAM.
--
-- Quando usar: a OS automática está atrapalhando a entrada (sat_registrar_nf, troca de ticket, planilha) e é
-- preciso voltar ao comportamento anterior à 0198 sem perder as OS já criadas.
-- Efeito: novas entradas deixam de criar OS e as OS deixam de acompanhar NF, ticket e garantia. As telas novas
-- continuam lendo o que já existe. Para religar: reaplicar a 0198 (recria os gatilhos; é idempotente).
--
-- Como rodar (transação única, para no primeiro erro):
--   PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--     -1 -v ON_ERROR_STOP=1 -f docs/operacao/sat-ordem-servico/rollback-0198.sql
-- Idempotente (drop trigger if exists): pode rodar mais de uma vez.
-- =============================================================
drop trigger if exists sat_entradas_ordem  on public.sat_entradas;
drop trigger if exists sat_entradas_ticket on public.sat_entradas;
drop trigger if exists sat_nfs_ordem       on public.sat_nfs;
drop trigger if exists sat_os_garantia     on public.sat_os;
