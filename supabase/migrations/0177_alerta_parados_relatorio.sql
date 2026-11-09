-- =============================================================
-- ALERTAS — RELATÓRIO "PEÇAS PARADAS" de UMA regra 'parado' (tela /shopfloor/analisar/parados?regra=<id>)
--
-- A mensagem do alerta "Parado ou travado na produção" (0172) passa a levar só as 3 OPs mais antigas e um
-- link para esta tela, que mostra o estado de AGORA com os MESMOS critérios da regra e, por OP, a lista
-- dos números de série parados (o que não cabe na mensagem).
--
--   A. alerta_travados_sns(postos, pmos, corte, so_ativas, incluir_manutencao): o miolo da alerta_travados
--      (0172), SN a SN — uma linha por peça parada (pmo, op, posto, reprovada, numero_serie, pecas, em).
--      O corpo é o da 0172 copiado SEM MUDANÇA até o filtro do "terminou"; só o select final deixa de agrupar.
--      Só service_role (como a 0172).
--   B. alerta_travados (MESMA assinatura e MESMO retorno; create or replace): passa a ser o agrupamento da
--      alerta_travados_sns. Assim o alerta e a tela usam UMA definição de "peça parada" (não duas cópias
--      que podem divergir). A foto tirada antes da migração no runner prova que a saída é a mesma.
--   C. alerta_parado_regra(p_regra): o que a tela precisa da regra para calcular o corte do jeito do
--      avaliador (src/modules/alertas/infra/repositorio-servico.ts): nome, limite_horas, postos, pmos, opções
--      e os turnos (alerta_regra_intervalos). A conta de expediente/corte continua no TS
--      (domain/horas-de-turno.ts), como no avaliador.
--   D. alerta_parado_sns(p_regra, p_corte): as peças paradas da regra, SN a SN. Lê postos/pmos/opções DA
--      REGRA (quem chama não escolhe postos) e chama a alerta_travados_sns com a mesma normalização do
--      avaliador (pmos com btrim, opções nulas = true).
--   C e D: authenticated, com checagem `(select tem_permissao('shopfloor','visualizar'))` (sem permissão é
--   ERRO SEM_PERMISSAO, nunca resposta vazia). Só leitura. Regra inexistente/excluída ou de outro tipo:
--   {ok:false, motivo:'regra_inexistente'} em C, nenhuma linha em D.
--
-- Sem índice novo: o plano da alerta_travados_sns é o da 0172 (medido em volume de produção).
-- Corpo de função com $func$ (o SQL Editor recusa o de dois cifrões); grants e revokes explícitos;
-- notify pgrst na última linha. Idempotente.
--
--   Dev e demo (SQL Editor): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0177_alerta_parados_relatorio.sql
-- ⚠️ ORDEM DE DEPLOY: esta migração ANTES do app (a tela chama C e D). O app antigo segue funcionando com
--    o banco novo (a alerta_travados mantém assinatura e retorno).
-- =============================================================

-- ---------- A. o miolo, SN a SN ----------
create or replace function public.alerta_travados_sns(
  p_postos text[], p_pmos text[], p_corte timestamptz,
  p_so_ativas boolean default true, p_incluir_manutencao boolean default true
)
returns table (pmo text, op text, posto text, reprovada boolean, numero_serie text, numero_serie_norm text,
               pecas int, em timestamptz)
language sql
stable
security definer
set search_path = public
set jit = off
as $func$
  with ordens as materialized (
    -- As OPs que a regra olha. Em sf_ordens (poucas centenas de linhas), antes de tocar em sf_registros.
    select o.id, o.pmo, o.op,
           (select p.posto from public.sf_ordem_postos p where p.ordem_id = o.id order by p.ordem desc limit 1)
             as ultimo_posto
      from public.sf_ordens o
     where (not coalesce(p_so_ativas, true) or upper(btrim(o.status)) <> 'FINALIZADA')
       and (coalesce(cardinality(p_pmos), 0) = 0 or btrim(o.pmo) = any (p_pmos))
  ),
  ult as (
    -- O último registro de cada SN na OP (um SN por OP; `pecas` é o peso do bipe, 0161/0162). Um LATERAL por OP
    -- (ver 0172: cada ordenação é de uma OP só e sai do índice sf_registros_ordem_sn).
    select o.ultimo_posto, u.*
      from ordens o
     cross join lateral (
       select distinct on (r.numero_serie_norm)
              r.pmo, r.op, r.numero_serie_norm, r.numero_serie, r.posto, r.status, r.data_hora, r.pecas
         from public.sf_registros r
        where r.pmo = o.pmo and r.op = o.op and r.numero_serie_norm <> ''
        order by r.numero_serie_norm, r.data_hora desc, r.created_at desc
     ) u
  ),
  cand as (
    select u.*, (lower(u.status) = 'reprovado') as reprovada
      from ult u
     where u.posto = any (coalesce(p_postos, '{}'::text[]))
       and u.data_hora <= p_corte
       -- Atalho barato do "terminou" (ver 0172).
       and not coalesce(u.posto = u.ultimo_posto and lower(u.status) <> 'reprovado', false)
       and (coalesce(p_incluir_manutencao, true)
            or (lower(u.status) <> 'reprovado' and lower(u.posto) <> 'manutenção'))
  )
  select btrim(c.pmo), c.op, c.posto, c.reprovada, c.numero_serie, c.numero_serie_norm, c.pecas, c.data_hora
    from cand c
   where not coalesce((
     -- Terminou (a conta da finalização automática): o último registro do SN no último posto da rota não é
     -- reprovação. Só para as candidatas, que são poucas. Sem registro no último posto: não terminou.
     select lower(r2.status) <> 'reprovado'
       from public.sf_registros r2
      where r2.pmo = c.pmo and r2.op = c.op and r2.numero_serie_norm = c.numero_serie_norm
        and r2.posto = c.ultimo_posto
      order by r2.data_hora desc, r2.created_at desc
      limit 1
   ), false)
$func$;

revoke all on function public.alerta_travados_sns(text[], text[], timestamptz, boolean, boolean) from public, anon, authenticated;
grant execute on function public.alerta_travados_sns(text[], text[], timestamptz, boolean, boolean) to service_role;

-- ---------- B. alerta_travados = o agrupamento do miolo (mesma assinatura, mesmo retorno) ----------
create or replace function public.alerta_travados(
  p_postos text[], p_pmos text[], p_corte timestamptz,
  p_so_ativas boolean default true, p_incluir_manutencao boolean default true
)
returns table (pmo text, op text, posto text, reprovada boolean, pecas bigint, em timestamptz, amostras text[])
language sql
stable
security definer
set search_path = public
set jit = off
as $func$
  select t.pmo, t.op, t.posto, t.reprovada,
         sum(t.pecas)::bigint, min(t.em),
         (array_agg(t.numero_serie order by t.em, t.numero_serie_norm))[1:3]
    from public.alerta_travados_sns(p_postos, p_pmos, p_corte, p_so_ativas, p_incluir_manutencao) t
   group by t.pmo, t.op, t.posto, t.reprovada
$func$;

revoke all on function public.alerta_travados(text[], text[], timestamptz, boolean, boolean) from public, anon, authenticated;
grant execute on function public.alerta_travados(text[], text[], timestamptz, boolean, boolean) to service_role;

-- ---------- C. a regra, para a tela ----------
create or replace function public.alerta_parado_regra(p_regra uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $func$
declare
  v_regra record;
  v_turnos jsonb;
begin
  if not (select tem_permissao('shopfloor', 'visualizar')) then
    raise exception 'SEM_PERMISSAO';
  end if;

  select r.id, r.nome, r.limite_horas, r.postos, r.pmos, r.so_ops_ativas, r.incluir_manutencao, r.ativa
    into v_regra
    from public.alerta_regras r
   where r.id = p_regra and r.tipo = 'parado' and r.excluida_em is null;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'regra_inexistente');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('inicio', i.inicio, 'fim', i.fim) order by i.inicio), '[]'::jsonb)
    into v_turnos
    from public.alerta_regra_intervalos i
   where i.regra_id = p_regra;

  return jsonb_build_object(
    'ok', true,
    'regra', jsonb_build_object(
      'id', v_regra.id, 'nome', v_regra.nome, 'limite_horas', v_regra.limite_horas,
      'postos', coalesce(to_jsonb(v_regra.postos), '[]'::jsonb),
      'pmos', coalesce(to_jsonb(v_regra.pmos), '[]'::jsonb),
      'so_ops_ativas', v_regra.so_ops_ativas, 'incluir_manutencao', v_regra.incluir_manutencao,
      'ativa', v_regra.ativa),
    'turnos', v_turnos);
end
$func$;

revoke all on function public.alerta_parado_regra(uuid) from public, anon;
grant execute on function public.alerta_parado_regra(uuid) to authenticated, service_role;

-- ---------- D. as peças paradas da regra, SN a SN ----------
create or replace function public.alerta_parado_sns(p_regra uuid, p_corte timestamptz)
returns table (pmo text, op text, posto text, reprovada boolean, numero_serie text, pecas int, em timestamptz)
language plpgsql
stable
security definer
set search_path = public
set jit = off
as $func$
#variable_conflict use_column
declare
  v_regra record;
begin
  if not (select tem_permissao('shopfloor', 'visualizar')) then
    raise exception 'SEM_PERMISSAO';
  end if;

  select r.postos, r.pmos, r.so_ops_ativas, r.incluir_manutencao
    into v_regra
    from public.alerta_regras r
   where r.id = p_regra and r.tipo = 'parado' and r.excluida_em is null;
  if not found or coalesce(cardinality(v_regra.postos), 0) = 0 or p_corte is null then
    return;
  end if;

  -- Mesma normalização do avaliador (repositorio-servico.ts): pmos com btrim (sem maiúsculas), opções
  -- nulas valem true.
  return query
    select t.pmo, t.op, t.posto, t.reprovada, t.numero_serie, t.pecas, t.em
      from public.alerta_travados_sns(
             v_regra.postos,
             coalesce(array(select btrim(coalesce(x, '')) from unnest(v_regra.pmos) x), '{}'::text[]),
             p_corte,
             v_regra.so_ops_ativas is distinct from false,
             v_regra.incluir_manutencao is distinct from false) t
     order by t.em, t.pmo, t.op, t.numero_serie;
end
$func$;

revoke all on function public.alerta_parado_sns(uuid, timestamptz) from public, anon;
grant execute on function public.alerta_parado_sns(uuid, timestamptz) to authenticated, service_role;

-- ⚠️ O cache de esquema do PostgREST NÃO recarrega sozinho. Uma vez só, no fim do arquivo.
notify pgrst, 'reload schema';
