-- =============================================================
-- NQA por caixa (amostragem): o posto NQA inspeciona por CAIXA (embalagem coletiva).
-- Bipa 1 SN → o sistema acha a caixa → amostra vem da Tabela NQA (tamanho do lote da caixa).
-- Inspeciona N amostras (Visual/Funcional). Todas aprovadas → aprova a caixa inteira; 1 reprovada
-- → reprova a caixa inteira e ela volta pro posto ESCOLHIDO (posto_retorno).
-- Grava 1 registro NQA por SN da caixa (as amostradas com visual/funcional/observação; as demais
-- "por amostragem") — assim o Fluxo/pendências funciona por SN, sem gambiarra.
-- =============================================================

-- Posto p/ onde a caixa reprovada no NQA deve voltar (roteamento da reprova escolhida).
alter table public.sf_registros add column if not exists posto_retorno text;

-- ---------- RPC: aprova/reprova a caixa inteira, atômico ----------
create or replace function public.sf_nqa_caixa(
  p_pmo           text,
  p_op            text,
  p_posto         text,   -- posto NQA (onde grava)
  p_colaborador   text,
  p_cliente       text,
  p_numero_caixa  text,
  p_resultado     text,   -- 'Aprovado' | 'Reprovado'
  p_posto_retorno text,   -- posto de retorno (só quando reprovado); '' quando aprovado
  p_amostras      jsonb   -- [{ sn_norm, visual, funcional, observacao }] (as N inspecionadas)
) returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_sn record;
  v_amostra jsonb;
  v_total int;
begin
  if not tem_permissao('lancar') then
    raise exception 'SEM_PERMISSAO';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_pmo || '/' || p_op)::bigint);

  -- SNs da caixa = registros (da embalagem) com este numero_caixa.
  select count(distinct numero_serie_norm) into v_total
  from sf_registros
  where pmo = p_pmo and op = p_op and numero_caixa = p_numero_caixa and numero_serie_norm <> '';
  if v_total = 0 then
    raise exception 'CAIXA_VAZIA';
  end if;

  -- Bloqueia reinspeção: algum SN da caixa já tem registro no posto NQA.
  if exists (
    select 1 from sf_registros r
    where r.pmo = p_pmo and r.op = p_op and r.posto = p_posto
      and r.numero_serie_norm in (
        select numero_serie_norm from sf_registros
        where pmo = p_pmo and op = p_op and numero_caixa = p_numero_caixa and numero_serie_norm <> ''
      )
  ) then
    raise exception 'CAIXA_JA_INSPECIONADA';
  end if;

  -- 1 registro NQA por SN da caixa.
  for v_sn in
    select distinct numero_serie, numero_serie_norm from sf_registros
    where pmo = p_pmo and op = p_op and numero_caixa = p_numero_caixa and numero_serie_norm <> ''
  loop
    select el.v into v_amostra
    from jsonb_array_elements(coalesce(p_amostras, '[]'::jsonb)) as el(v)
    where el.v->>'sn_norm' = v_sn.numero_serie_norm
    limit 1;

    insert into sf_registros (colaborador, posto, pmo, op, cliente, status,
      numero_serie, numero_serie_norm, nqa_visual, nqa_funcional, observacao, posto_retorno)
    values (p_colaborador, p_posto, p_pmo, p_op, p_cliente, p_resultado,
      v_sn.numero_serie, v_sn.numero_serie_norm,
      coalesce(v_amostra->>'visual', ''), coalesce(v_amostra->>'funcional', ''),
      case when v_amostra is not null then coalesce(v_amostra->>'observacao', '')
           else 'Por amostragem' end,
      nullif(p_posto_retorno, ''));
  end loop;

  return jsonb_build_object('ok', true, 'total', v_total);
end;
$$;

grant execute on function public.sf_nqa_caixa(text,text,text,text,text,text,text,text,jsonb) to authenticated;

-- ---------- Recria sf_fluxo_op: WIP considera posto_retorno na reprova ----------
create or replace function public.sf_fluxo_op(p_pmo text, p_op text)
returns table (
  posto      text,
  wip        int,
  registros  int,
  aprovadas  int,
  reprovadas int,
  retestes   int
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not tem_permissao('visualizar') then
    raise exception 'SEM_PERMISSAO';
  end if;

  return query
  with regs as (
    select numero_serie_norm, posto, status, posto_retorno, data_hora, created_at
    from sf_registros
    where pmo = p_pmo and op = p_op and numero_serie_norm <> ''
  ),
  ult as ( -- último registro por SN (desempata por created_at)
    select distinct on (numero_serie_norm) numero_serie_norm, posto, status, posto_retorno
    from regs
    order by numero_serie_norm, data_hora desc, created_at desc
  ),
  wip_t as ( -- reprovado c/ posto_retorno → posto escolhido; reprovado → Manutenção; senão → posto do último
    select case
             when lower(status) = 'reprovado' and coalesce(posto_retorno, '') <> '' then posto_retorno
             when lower(status) = 'reprovado' then 'Manutenção'
             else posto
           end as posto,
           count(*)::int as wip
    from ult
    group by 1
  ),
  por_sn_posto as (
    select posto, numero_serie_norm, count(*) as vezes
    from regs
    group by posto, numero_serie_norm
  ),
  agg as (
    select posto,
           count(*) filter (where lower(status) = 'aprovado')::int  as aprovadas,
           count(*) filter (where lower(status) = 'reprovado')::int as reprovadas,
           count(*)::int as registros
    from regs
    group by posto
  ),
  ret as (
    select posto, count(*) filter (where vezes >= 2)::int as retestes
    from por_sn_posto
    group by posto
  ),
  postos as (
    select posto from agg
    union
    select posto from wip_t
  )
  select p.posto,
         coalesce(w.wip, 0)        as wip,
         coalesce(a.registros, 0)  as registros,
         coalesce(a.aprovadas, 0)  as aprovadas,
         coalesce(a.reprovadas, 0) as reprovadas,
         coalesce(rt.retestes, 0)  as retestes
  from postos p
  left join wip_t w on w.posto = p.posto
  left join agg   a on a.posto = p.posto
  left join ret  rt on rt.posto = p.posto;
end;
$$;

notify pgrst, 'reload schema';
