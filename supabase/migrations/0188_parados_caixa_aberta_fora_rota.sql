-- =============================================================
-- PEÇAS PARADAS: duas correções no posto PENDENTE (0183). Pedido de 18/11/2026 (peças paradas "no Almoxarifado"
-- que não aparecem na tela do Almoxarifado):
--   1. CAIXA ABERTA: a peça embalada numa caixa que ainda não fechou ficava pendente no posto seguinte (ex.:
--      Almoxarifado), mas o Almoxarifado só recebe caixa FECHADA. Agora fica na própria Embalagem.
--      (OPs 8643 CX[4], 8662 CX[1], 8682_F CX[7].)
--   2. POSTO FORA DA ROTA: o bipe num posto que não é da rota da OP (ex.: a placa PMOF49 da OP 8691 integrada no
--      produto de outra OP, na Integração) virava o "posto pendente". Agora esse bipe é ignorado e vale o último
--      registro na rota (ou na Manutenção): a placa que não passou pela confirmação continua pendente no
--      Almoxarifado, como as outras. Sem nenhum registro na rota, fica como antes (o próprio posto).
-- O resto é idêntico à 0183 (mesma assinatura e retorno; o alerta e a tela Peças paradas mudam juntos).
-- Só SQL: não precisa de deploy do app. Idempotente (create or replace).
--
--   RDS:  psql ... -1 -v ON_ERROR_STOP=1 -f 0188_parados_caixa_aberta_fora_rota.sql
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
              r.posto_retorno, r.posto_origem, r.numero_caixa
         from public.sf_registros r
        where r.pmo = o.pmo and r.op = o.op and r.numero_serie_norm <> ''
        -- 0188: um bipe num posto FORA da rota (ex.: a placa integrada no produto de outra OP) não move a peça;
        -- vale o último registro na rota (ou na Manutenção). Sem nenhum na rota: o último de todos (como antes).
        order by r.numero_serie_norm,
                 (cardinality(o.rota) > 0 and r.posto <> all (o.rota) and lower(r.posto) <> 'manutenção'),
                 r.data_hora desc, r.created_at desc
     ) u
  ),
  pend as (
    select u.*, (lower(u.status) = 'reprovado') as reprovada,
           case
             when lower(u.status) = 'reprovado' then u.posto
             when btrim(coalesce(u.posto_retorno, '')) <> '' then btrim(split_part(u.posto_retorno, ',', 1))
             when lower(u.posto) = 'manutenção' then coalesce(nullif(btrim(u.posto_origem), ''), u.posto)
             -- 0188: embalada numa caixa que ainda NÃO fechou: continua na Embalagem (o próximo posto só recebe
             -- caixa fechada). Fechada = existe em sf_caixas com este código e `fechada` (o código definitivo
             -- só nasce no fechamento; antes disso o registro leva o provisório, ex. CX[4]).
             when coalesce(u.numero_caixa, '') <> ''
                  and not exists (select 1 from public.sf_caixas cx
                                   where cx.pmo = u.pmo and cx.op = u.op and cx.codigo = u.numero_caixa
                                     and cx.fechada)
               then u.posto
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
