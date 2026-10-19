-- =============================================================
-- Fila de estoque (0132) — QUANTAS PEÇAS DESTA OP JÁ CHEGARAM AO COMPELS
--
-- A integração com o Compels decide cada entrada comparando o que o ERP mostra apontado com o que o
-- ShopFloor já enviou (spec docs/superpowers/specs/2026-10-16-integracao-compels-apontamento-design.md,
-- seção 3.2): se o ERP mostra exatamente o que mandamos antes, envia; se mostra outra coisa, alguém
-- mexeu à mão e a integração PARA em vez de contar em dobro. Este é o "o que mandamos antes".
--
-- Soma, para a PMO e a OP, as linhas que chegaram (ok): entradas somam, estornos entregues subtraem.
-- Entrada cancelada nunca é ok (check da 0132), então não entra. `p_exceto` deixa de fora a própria linha
-- que está sendo enviada.
--
-- Por que no banco e não no TypeScript: numa OP de produto único o bipe é peça a peça, e 2.358 linhas
-- por OP seriam lidas inteiras a cada envio. Aqui é uma soma com índice.
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0153_sf_estoque_enviado.sql
--
-- Pré-requisito: a 0132. Aditiva e idempotente. Corpo com $func$ (nunca dois cifrões).
-- =============================================================

-- A soma pesquisa por (pmo, op) só entre as linhas entregues: índice parcial, pequeno e exato.
create index if not exists sf_estoque_envios_entregues
  on public.sf_estoque_envios (pmo, op)
  where ok;

create or replace function public.sf_estoque_enviado(
  p_pmo text, p_op text, p_exceto uuid default null
) returns numeric
language sql
stable
security definer
set search_path = public
as $func$
  select coalesce(sum(case when e.operacao = 'estorno' then -e.quantidade else e.quantidade end), 0)
    from public.sf_estoque_envios e
   where e.pmo = p_pmo
     and e.op = p_op
     and e.ok
     and (p_exceto is null or e.id <> p_exceto)
$func$;

-- Só o servidor (o cron e o Reenviar) pergunta isto: não é leitura de tela.
revoke all on function public.sf_estoque_enviado(text, text, uuid) from public, anon, authenticated;
grant execute on function public.sf_estoque_enviado(text, text, uuid) to service_role;

notify pgrst, 'reload schema';
