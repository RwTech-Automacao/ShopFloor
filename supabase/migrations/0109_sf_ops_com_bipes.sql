-- =============================================================
-- OPs que tiveram bipe num período — alimenta o filtro da lista de OPs do Fluxo de Processos.
-- Antes a lista filtrava pela data de CRIAÇÃO da OP; agora "Hoje / 7 dias / 30 dias / Período"
-- quer dizer "teve lançamento nesse período". p_ini/p_fim nulos = sem limite daquele lado.
-- SECURITY INVOKER: a RLS de sf_registros continua valendo (só quem pode visualizar).
-- =============================================================
create or replace function public.sf_ops_com_bipes(p_ini timestamptz, p_fim timestamptz)
returns table (pmo text, op text)
language sql stable set search_path = public as $func$
  select distinct r.pmo, r.op
  from public.sf_registros r
  where (p_ini is null or r.data_hora >= p_ini)
    and (p_fim is null or r.data_hora < p_fim)
$func$;

grant execute on function public.sf_ops_com_bipes(timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
