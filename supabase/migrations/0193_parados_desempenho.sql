-- =============================================================
-- PEÇAS PARADAS: DESEMPENHO (tela /shopfloor/analisar/parados e o alerta "parado/travado"). Pedido de 19/11/2026:
-- a tela demora a abrir. MESMO RESULTADO linha a linha (provado na massa de volume por
-- supabase/tests/rodar-parados-medir.sh, que compara a saída da 0188/0180 com a desta, e pelos testes do
-- rodar-alertas-test.sh). Onde estava o tempo e o que muda:
--
--   1. A TELA RODAVA A FUNÇÃO UMA VEZ POR PÁGINA. O PostgREST corta cada resposta em 1000 linhas, então o app
--      pedia de 1000 em 1000 (range), e cada página recalculava TUDO (todas as OPs) só para devolver o pedaço.
--      Com 5 mil peças paradas eram 5 cálculos inteiros, em sequência. NOVO: sf_pecas_paradas_json devolve a
--      lista inteira de uma vez (um jsonb só, que o max-rows não corta), com o mesmo teto de 50 mil do app.
--   2. sf_pecas_paradas: a situação da OP (finalizada) era buscada linha a linha com `btrim(pmo) = ...`, que não
--      usa índice: uma varredura de sf_ordens POR PEÇA. Agora é um join só (hash) com sf_ordens. sf_ordens tem
--      unique (pmo, op); o `limit 1` antigo só escolhia entre OPs cujo pmo difere por espaço nas pontas — aqui o
--      `distinct on` escolhe uma delas também (caso que não existe nos dados).
--   3. alerta_travados_sns (o miolo, igual à 0188 no resultado):
--      - o "último registro de cada SN" ordena os registros de cada OP pelo SN com a collation "C" (comparação de
--        bytes). A igualdade de texto é a mesma (collation determinística), então os grupos e a linha escolhida
--        são os mesmos; só a ordenação fica bem mais barata que a do idioma (en_US/pt_BR do RDS);
--      - o posto pendente (o CASE, com a consulta de caixa fechada em sf_caixas) era calculado DUAS vezes por
--        peça (no filtro de posto e na saída); agora uma (CTE materializada);
--      - o "terminou" (último registro no último posto não é reprovação) deixa de ser uma consulta por peça
--        candidata: sai de uma leitura só, por OP, dos registros no último posto (índice (pmo, op, posto, ...)
--        da 0028), com o mesmo desempate (data_hora desc, created_at desc).
--
-- Mesma assinatura e mesmo retorno nas três funções antigas; grants iguais. Idempotente (create or replace).
-- ⚠️ ORDEM DE DEPLOY: esta migração ANTES do app (o app novo chama sf_pecas_paradas_json). O app antigo continua
-- funcionando com ela (sf_pecas_paradas segue igual, só mais rápida).
--
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0193_parados_desempenho.sql
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

  -- 0193: a situação da OP por join (hash) com sf_ordens, e não uma varredura de sf_ordens por peça.
  return query
    with ords as (
      select distinct on (btrim(o2.pmo), o2.op) btrim(o2.pmo) as pmo, o2.op, o2.status
        from public.sf_ordens o2
       order by btrim(o2.pmo), o2.op
    )
    select t.pmo, t.op, t.posto, t.reprovada, t.numero_serie, t.pecas, t.em,
           coalesce(upper(btrim(o.status)) = 'FINALIZADA', false) as finalizada
      from public.alerta_travados_sns(v_postos, v_pmos, p_corte, v_situacao = 'ativas', true) t
      left join ords o on o.pmo = t.pmo and o.op = t.op
     where v_situacao <> 'finalizadas' or upper(btrim(o.status)) = 'FINALIZADA'
     order by t.em, t.pmo, t.op, t.numero_serie;
end
$func$;

revoke all on function public.sf_pecas_paradas(timestamptz, text, text[]) from public, anon;
grant execute on function public.sf_pecas_paradas(timestamptz, text, text[]) to authenticated, service_role;

-- A lista inteira numa resposta só (o max-rows do PostgREST corta conjuntos de linhas, não um valor jsonb): a tela
-- deixa de paginar, e a função roda UMA vez. Mesmas linhas, mesma ordem e mesmo teto (50 mil) da paginação antiga.
-- Security invoker: a permissão é a da sf_pecas_paradas (SEM_PERMISSAO / SITUACAO_INVALIDA como lá).
create or replace function public.sf_pecas_paradas_json(
  p_corte timestamptz, p_situacao text default 'ativas', p_pmos text[] default null
)
returns jsonb
language sql
stable
set search_path = public
as $func$
  select coalesce(jsonb_agg(jsonb_build_object(
           'pmo', s.pmo, 'op', s.op, 'posto', s.posto, 'reprovada', s.reprovada, 'numero_serie', s.numero_serie,
           'pecas', s.pecas, 'em', s.em, 'finalizada', s.finalizada) order by s.n), '[]'::jsonb)
    from (select *
            from public.sf_pecas_paradas(p_corte, p_situacao, p_pmos)
                 with ordinality as x(pmo, op, posto, reprovada, numero_serie, pecas, em, finalizada, n)
           order by x.n
           limit 50000) s
$func$;

revoke all on function public.sf_pecas_paradas_json(timestamptz, text, text[]) from public, anon;
grant execute on function public.sf_pecas_paradas_json(timestamptz, text, text[]) to authenticated, service_role;

-- ⚠️ O cache de esquema do PostgREST NÃO recarrega sozinho. Uma vez só, no fim do arquivo.
notify pgrst, 'reload schema';
