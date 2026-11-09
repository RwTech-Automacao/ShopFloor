-- =============================================================
-- SHOPFLOOR — TELA "PEÇAS PARADAS" SEM REGRA (/shopfloor/analisar/parados)
--
-- A tela deixa de depender de uma regra de alerta: ela tem os próprios filtros (tempo, situação da OP, posto,
-- tipo de parada, agrupar e ordenar). O link da mensagem do alerta (`?regra=<id>`) só PREENCHE os filtros com
-- os da regra (alerta_parado_regra, 0177, continua como está).
--
--   sf_pecas_paradas(p_corte, p_situacao, p_pmos): as peças paradas desde antes de `p_corte`, SN a SN, em
--   TODOS os postos, com o mesmo miolo do alerta (alerta_travados_sns, 0177: o último registro de cada SN, sem
--   as que terminaram) e as reprovadas aguardando conserto incluídas. Devolve também se a OP está finalizada.
--     p_situacao: 'ativas' (padrão), 'finalizadas' ou 'todas'. Outro valor é ERRO SITUACAO_INVALIDA.
--     p_pmos: nulo ou vazio = todas as PMOs (o link de uma regra com PMOs passa as da regra).
--   Posto e tipo de parada são filtrados na tela (a resposta já traz posto e reprovada).
--   "Todos os postos" = os do cadastro (sf_postos), os das rotas (sf_ordem_postos) e a Manutenção.
--
-- authenticated, com checagem `(select tem_permissao('shopfloor','visualizar'))` (sem permissão é ERRO
-- SEM_PERMISSAO, nunca resposta vazia). Só leitura. Idempotente.
--
--   Dev e demo (SQL Editor): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0180_sf_pecas_paradas.sql
-- ⚠️ ORDEM DE DEPLOY: esta migração ANTES do app (a tela nova chama a função). O app antigo não a usa.
-- =============================================================

create or replace function public.sf_pecas_paradas(
  p_corte timestamptz, p_situacao text default 'ativas', p_pmos text[] default null
)
returns table (pmo text, op text, posto text, reprovada boolean, numero_serie text, pecas int, em timestamptz,
               finalizada boolean)
language plpgsql
stable
security definer
set search_path = public
set jit = off
as $func$
#variable_conflict use_column
declare
  v_situacao text := coalesce(p_situacao, 'ativas');
  v_postos text[];
  v_pmos text[];
begin
  if not (select tem_permissao('shopfloor', 'visualizar')) then
    raise exception 'SEM_PERMISSAO';
  end if;
  if v_situacao not in ('ativas', 'finalizadas', 'todas') then
    raise exception 'SITUACAO_INVALIDA';
  end if;
  if p_corte is null then
    return;
  end if;

  select array_agg(distinct x) into v_postos
    from (select s.chave as x from public.sf_postos s
          union select p.posto from public.sf_ordem_postos p
          union select 'Manutenção') t
   where x is not null and x <> '';
  -- Mesma normalização do avaliador (repositorio-servico.ts): pmos com btrim.
  v_pmos := coalesce(array(select btrim(x) from unnest(p_pmos) x where btrim(coalesce(x, '')) <> ''), '{}'::text[]);

  return query
    select t.pmo, t.op, t.posto, t.reprovada, t.numero_serie, t.pecas, t.em,
           coalesce(upper(btrim(o.status)) = 'FINALIZADA', false) as finalizada
      from public.alerta_travados_sns(v_postos, v_pmos, p_corte, v_situacao = 'ativas', true) t
      left join lateral (
        select o2.status from public.sf_ordens o2 where btrim(o2.pmo) = t.pmo and o2.op = t.op limit 1
      ) o on true
     where v_situacao <> 'finalizadas' or upper(btrim(o.status)) = 'FINALIZADA'
     order by t.em, t.pmo, t.op, t.numero_serie;
end
$func$;

revoke all on function public.sf_pecas_paradas(timestamptz, text, text[]) from public, anon;
grant execute on function public.sf_pecas_paradas(timestamptz, text, text[]) to authenticated, service_role;

-- ⚠️ O cache de esquema do PostgREST NÃO recarrega sozinho. Uma vez só, no fim do arquivo.
notify pgrst, 'reload schema';
