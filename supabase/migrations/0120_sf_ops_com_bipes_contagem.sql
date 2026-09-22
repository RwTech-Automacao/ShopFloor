-- =============================================================
-- Fluxo: a lista de OPs passa a vir ordenada da OP com MAIS bipes para a com menos (card da
-- sprint 14/09/2026). A função da 0109 só dizia QUAIS OPs tiveram bipe no período; agora devolve
-- também QUANTOS. Contar no mesmo passo não custa nada a mais (já percorria esses bipes).
-- Período nulo = todo o histórico (usado no filtro "Tudo" só pra ordenar, sem esconder OPs).
--
-- Muda o retorno → a assinatura antiga sai antes (senão o PostgREST não sabe qual chamar).
-- =============================================================

drop function if exists public.sf_ops_com_bipes(timestamptz, timestamptz);

create function public.sf_ops_com_bipes(p_ini timestamptz, p_fim timestamptz)
returns table (pmo text, op text, bipes bigint)
language sql stable set search_path = public as $func$
  select r.pmo, r.op, count(*) as bipes
  from public.sf_registros r
  where (p_ini is null or r.data_hora >= p_ini)
    and (p_fim is null or r.data_hora < p_fim)
  group by r.pmo, r.op
$func$;

revoke all on function public.sf_ops_com_bipes(timestamptz, timestamptz) from public, anon;
grant execute on function public.sf_ops_com_bipes(timestamptz, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
