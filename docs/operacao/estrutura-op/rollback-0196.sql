-- Rollback da 0196 (placa de PRT com série própria que terminou o trecho). Devolve a alerta_travados_sns ao texto
-- EXATO da 0193 (a placa volta a aparecer pendente no posto seguinte da rota, como antes). A sf_pecas_paradas e a
-- sf_pecas_paradas_json não mudaram na 0196. O app não depende da 0196 (o Fluxo aplica a regra sozinho).
-- Idempotente: psql -1 -v ON_ERROR_STOP=1 -f docs/operacao/estrutura-op/rollback-0196.sql

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
    -- O último registro de cada SN na OP (ver 0172/0177/0188). Ordena o SN em "C": mesmos grupos, sort barato.
    select o.ultimo_posto, o.rota, u.*
      from ordens o
     cross join lateral (
       select distinct on (r.numero_serie_norm collate "C")
              r.pmo, r.op, r.numero_serie_norm, r.numero_serie, r.posto, r.status, r.data_hora, r.pecas,
              r.posto_retorno, r.posto_origem, r.numero_caixa
         from public.sf_registros r
        where r.pmo = o.pmo and r.op = o.op and r.numero_serie_norm <> ''
        -- 0188: um bipe num posto FORA da rota (ex.: a placa integrada no produto de outra OP) não move a peça;
        -- vale o último registro na rota (ou na Manutenção). Sem nenhum na rota: o último de todos (como antes).
        order by r.numero_serie_norm collate "C",
                 (cardinality(o.rota) > 0 and r.posto <> all (o.rota) and lower(r.posto) <> 'manutenção'),
                 r.data_hora desc, r.created_at desc
     ) u
  ),
  pend as materialized (
    -- Materializada: o posto pendente (com a consulta da caixa) é calculado UMA vez por peça.
    select u.*, (lower(u.status) = 'reprovado') as reprovada,
           case
             when lower(u.status) = 'reprovado' then u.posto
             when btrim(coalesce(u.posto_retorno, '')) <> '' then btrim(split_part(u.posto_retorno, ',', 1))
             when lower(u.posto) = 'manutenção' then coalesce(nullif(btrim(u.posto_origem), ''), u.posto)
             -- 0188: embalada numa caixa que ainda NÃO fechou: continua na Embalagem.
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
  ),
  terminou as (
    -- Terminou (a conta da finalização automática): o ÚLTIMO registro do SN no último posto da rota não é
    -- reprovação. Uma leitura por OP (só as OPs com candidatas), em vez de uma consulta por peça.
    select distinct on (t.pmo, t.op, t.numero_serie_norm collate "C")
           t.pmo, t.op, t.numero_serie_norm, lower(t.status) <> 'reprovado' as terminou
      from (select distinct c.pmo, c.op, c.ultimo_posto from cand c) k
      join public.sf_registros t
        on t.pmo = k.pmo and t.op = k.op and t.posto = k.ultimo_posto
     order by t.pmo, t.op, t.numero_serie_norm collate "C", t.data_hora desc, t.created_at desc
  )
  select btrim(c.pmo), c.op, c.pendente, c.reprovada, c.numero_serie, c.numero_serie_norm, c.pecas, c.data_hora
    from cand c
    left join terminou t
      on t.pmo = c.pmo and t.op = c.op and t.numero_serie_norm = c.numero_serie_norm
   where not coalesce(t.terminou, false)
$func$;
revoke all on function public.alerta_travados_sns(text[], text[], timestamptz, boolean, boolean) from public, anon, authenticated;
grant execute on function public.alerta_travados_sns(text[], text[], timestamptz, boolean, boolean) to service_role;

notify pgrst, 'reload schema';
