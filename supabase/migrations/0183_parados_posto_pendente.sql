-- =============================================================
-- PEÇAS PARADAS: o posto mostrado é o posto em que a peça está PENDENTE, não o último em que ela foi bipada.
--
-- Pedido de 10/11/2026 (OP 8682_F): o 0845801634FNT passou no Teste (Aprovado) e aparecia "parado no Teste"; ele
-- está esperando a EMBALAGEM. A regra do posto pendente, a partir do ÚLTIMO registro da peça:
--   1. reprovada: continua no posto que reprovou, "aguardando conserto" (como antes);
--   2. com rota de reteste pendente (`posto_retorno`, gravada pela Manutenção e propagada pela sf_lancar):
--      o 1º posto da lista (é o único que a sf_lancar aceita, RETESTE_PENDENTE);
--   3. último registro na Manutenção sem rota de reteste: volta ao posto que reprovou (`posto_origem`);
--   4. passou num posto da rota da OP: o PRÓXIMO posto da rota (sf_ordem_postos, por `ordem`);
--   5. posto fora da rota da OP (ou OP sem rota): fica o próprio posto (como antes).
-- O filtro de postos (`p_postos`: a regra do alerta e a tela) passa a valer sobre o posto PENDENTE. O resto é
-- idêntico à 0177: o último registro manda, a peça que terminou não conta, o corte é a data do último registro,
-- `p_incluir_manutencao = false` tira a reprovada e a peça cujo último registro é na Manutenção.
--
-- Mesma assinatura e mesmo retorno: alerta_travados (agrupamento, 0177) e sf_pecas_paradas (0180) passam a
-- mostrar o posto pendente sem mudar. Só SQL: não precisa de deploy do app. Idempotente (create or replace).
--
--   RDS:  psql ... -1 -v ON_ERROR_STOP=1 -f 0183_parados_posto_pendente.sql
-- =============================================================

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
    -- As OPs que a regra olha, com a rota (postos em ordem). Em sf_ordens (poucas centenas de linhas).
    select o.id, o.pmo, o.op,
           (select p.posto from public.sf_ordem_postos p where p.ordem_id = o.id order by p.ordem desc limit 1)
             as ultimo_posto,
           array(select p.posto from public.sf_ordem_postos p where p.ordem_id = o.id order by p.ordem) as rota
      from public.sf_ordens o
     where (not coalesce(p_so_ativas, true) or upper(btrim(o.status)) <> 'FINALIZADA')
       and (coalesce(cardinality(p_pmos), 0) = 0 or btrim(o.pmo) = any (p_pmos))
  ),
  ult as (
    -- O último registro de cada SN na OP (ver 0172/0177).
    select o.ultimo_posto, o.rota, u.*
      from ordens o
     cross join lateral (
       select distinct on (r.numero_serie_norm)
              r.pmo, r.op, r.numero_serie_norm, r.numero_serie, r.posto, r.status, r.data_hora, r.pecas,
              r.posto_retorno, r.posto_origem
         from public.sf_registros r
        where r.pmo = o.pmo and r.op = o.op and r.numero_serie_norm <> ''
        order by r.numero_serie_norm, r.data_hora desc, r.created_at desc
     ) u
  ),
  pend as (
    select u.*, (lower(u.status) = 'reprovado') as reprovada,
           case
             when lower(u.status) = 'reprovado' then u.posto
             when btrim(coalesce(u.posto_retorno, '')) <> '' then btrim(split_part(u.posto_retorno, ',', 1))
             when lower(u.posto) = 'manutenção' then coalesce(nullif(btrim(u.posto_origem), ''), u.posto)
             else coalesce(u.rota[array_position(u.rota, u.posto) + 1], u.posto)
           end as pendente
      from ult u
     where u.data_hora <= p_corte
       -- Atalho barato do "terminou" (ver 0172).
       and not coalesce(u.posto = u.ultimo_posto and lower(u.status) <> 'reprovado', false)
       and (coalesce(p_incluir_manutencao, true)
            or (lower(u.status) <> 'reprovado' and lower(u.posto) <> 'manutenção'))
  ),
  cand as (
    select p.* from pend p where p.pendente = any (coalesce(p_postos, '{}'::text[]))
  )
  select btrim(c.pmo), c.op, c.pendente, c.reprovada, c.numero_serie, c.numero_serie_norm, c.pecas, c.data_hora
    from cand c
   where not coalesce((
     -- Terminou (a conta da finalização automática): o último registro do SN no último posto da rota não é
     -- reprovação. Só para as candidatas. Sem registro no último posto: não terminou.
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

-- ⚠️ O cache de esquema do PostgREST NÃO recarrega sozinho. Uma vez só, no fim do arquivo.
notify pgrst, 'reload schema';
