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
  v_cliente text;
begin
  if not tem_permissao('lancar') then
    raise exception 'SEM_PERMISSAO';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_pmo || '/' || p_op)::bigint);

  -- SNs da caixa = registros (da embalagem) com este numero_caixa. Cliente derivado deles.
  select count(distinct numero_serie_norm), max(cliente) into v_total, v_cliente
  from sf_registros
  where pmo = p_pmo and op = p_op and numero_caixa = p_numero_caixa and numero_serie_norm <> '';
  if v_total = 0 then
    raise exception 'CAIXA_VAZIA';
  end if;

  -- Bloqueia se a caixa está NO NQA agora (último registro da peça = posto NQA): ou acabou de ser
  -- inspecionada (aprovado=fim / reprovado=aguardando reteste). Depois do reteste, o último registro
  -- é outro posto → libera a REINSPEÇÃO. (1ª inspeção: último registro é a Embalagem → libera.)
  if exists (
    select 1 from (
      select distinct on (r.numero_serie_norm) r.numero_serie_norm, r.posto
      from sf_registros r
      where r.pmo = p_pmo and r.op = p_op
        and r.numero_serie_norm in (
          select numero_serie_norm from sf_registros
          where pmo = p_pmo and op = p_op and numero_caixa = p_numero_caixa and numero_serie_norm <> ''
        )
      order by r.numero_serie_norm, r.data_hora desc, r.created_at desc
    ) ult
    where ult.posto = p_posto
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
    values (p_colaborador, p_posto, p_pmo, p_op, coalesce(v_cliente, ''), p_resultado,
      v_sn.numero_serie, v_sn.numero_serie_norm,
      coalesce(v_amostra->>'visual', ''), coalesce(v_amostra->>'funcional', ''),
      case when v_amostra is not null then coalesce(v_amostra->>'observacao', '')
           else 'Por amostragem' end,
      nullif(p_posto_retorno, ''));
  end loop;

  return jsonb_build_object('ok', true, 'total', v_total);
end;
$$;

grant execute on function public.sf_nqa_caixa(text,text,text,text,text,text,text,jsonb) to authenticated;

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
  wip_t as ( -- em reteste (posto_retorno propagado) → 1º da lista restante; reprovado → Manutenção; senão → posto do último
    select case
             when coalesce(posto_retorno, '') <> '' then split_part(posto_retorno, ',', 1)
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

-- ---------- Recria sf_lancar: RETESTE no retorno do NQA (posto_retorno propagado) ----------
-- Quando a peça está RETORNANDO (o último registro traz `posto_retorno` e o 1º posto da lista é
-- ESTE posto), o lançamento é permitido mesmo já tendo passado aqui (reteste), pula a trava de
-- sequência, e PROPAGA a lista restante no novo registro (aprovado/passagem). Se reprovar no
-- reteste, NÃO propaga → segue a regra normal do posto (Manutenção/próprio posto).
create or replace function public.sf_lancar(
  p_pmo                  text,
  p_op                   text,
  p_cliente              text,
  p_posto                text,
  p_colaborador          text,
  p_numero_serie         text,
  p_numero_serie_norm    text,
  p_status               text,
  p_posto_tem_status     boolean,
  p_numero_caixa         text,
  p_qtd_por_caixa        int,
  p_nqa_visual           text,
  p_nqa_funcional        text,
  p_prev_posto           text,
  p_prev_precisa_aprovado boolean,
  p_linhas               jsonb,
  p_exige_manutencao     boolean default false,
  p_observacao           text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ultimo_status text;
  v_ultima_data   timestamptz;
  v_tem_reparo    boolean;
  v_existe        boolean;
  v_prev_ok       boolean;
  v_count         int;
  v_linha         jsonb;
  v_last_retorno  text;
  v_em_reteste    boolean;
  v_novo_retorno  text;
begin
  if not tem_permissao('lancar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;

  perform pg_advisory_xact_lock(hashtext(p_pmo || '/' || p_op)::bigint);

  -- 0) Reteste no retorno: último registro da peça traz posto_retorno e o 1º da lista = este posto.
  select posto_retorno into v_last_retorno
  from sf_registros
  where pmo = p_pmo and op = p_op and numero_serie_norm = p_numero_serie_norm
  order by data_hora desc, created_at desc
  limit 1;
  v_em_reteste := coalesce(v_last_retorno, '') <> '' and split_part(v_last_retorno, ',', 1) = p_posto;
  if v_em_reteste and lower(p_status) <> 'reprovado' then
    -- consome o 1º da lista → propaga o resto (vazio vira null = fim do reteste / pendente no NQA já foi consumido)
    v_novo_retorno := nullif(
      case when position(',' in v_last_retorno) > 0
           then substring(v_last_retorno from position(',' in v_last_retorno) + 1)
           else '' end, '');
  end if;

  -- 1) Anti-duplicidade + 2) Sequência: só quando NÃO é reteste (o retorno reabre o posto).
  if not v_em_reteste then
    if p_posto_tem_status then
      select status, data_hora into v_ultimo_status, v_ultima_data
      from sf_registros
      where pmo = p_pmo and op = p_op and numero_serie_norm = p_numero_serie_norm and posto = p_posto
      order by data_hora desc
      limit 1;
      if v_ultimo_status is not null and lower(v_ultimo_status) = 'aprovado' then
        return jsonb_build_object('ok', false, 'erro', 'DUPLICADO_APROVADO');
      end if;
      if v_ultimo_status is not null and lower(v_ultimo_status) = 'reprovado' and p_exige_manutencao then
        select exists(
          select 1 from sf_registros m
          where m.pmo = p_pmo and m.op = p_op and m.numero_serie_norm = p_numero_serie_norm
            and m.posto = 'Manutenção'
            and m.posto_origem = p_posto
            and m.data_hora > v_ultima_data
        ) into v_tem_reparo;
        if not v_tem_reparo then
          return jsonb_build_object('ok', false, 'erro', 'SEM_MANUTENCAO');
        end if;
      end if;
    else
      select exists(
        select 1 from sf_registros
        where pmo = p_pmo and op = p_op and numero_serie_norm = p_numero_serie_norm and posto = p_posto
      ) into v_existe;
      if v_existe then
        return jsonb_build_object('ok', false, 'erro', 'DUPLICADO');
      end if;
    end if;

    if p_prev_posto <> '' then
      if p_prev_precisa_aprovado then
        select exists(
          select 1 from sf_registros
          where pmo = p_pmo and op = p_op and numero_serie_norm = p_numero_serie_norm
            and posto = p_prev_posto and lower(status) = 'aprovado'
        ) into v_prev_ok;
      else
        select exists(
          select 1 from sf_registros
          where pmo = p_pmo and op = p_op and numero_serie_norm = p_numero_serie_norm
            and posto = p_prev_posto
        ) into v_prev_ok;
      end if;
      if not v_prev_ok then
        return jsonb_build_object('ok', false, 'erro', 'SEQUENCIA');
      end if;
    end if;
  end if;

  -- 3) Embalagem: valida limite ANTES de inserir.
  if p_qtd_por_caixa is not null then
    select count(*) into v_count
    from sf_registros
    where pmo = p_pmo and op = p_op and posto = p_posto and numero_caixa = p_numero_caixa;
    if v_count >= p_qtd_por_caixa then
      return jsonb_build_object('ok', false, 'erro', 'CAIXA_CHEIA');
    end if;
  end if;

  -- 4) Gravação (posto_retorno = v_novo_retorno propaga o reteste; null no fluxo normal).
  if jsonb_array_length(p_linhas) = 0 then
    insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, qtd_por_caixa,
      status, numero_serie, numero_serie_norm, nqa_visual, nqa_funcional, observacao, posto_retorno)
    values (p_colaborador, p_posto, p_pmo, p_op, p_cliente, p_numero_caixa, p_qtd_por_caixa,
      p_status, p_numero_serie, p_numero_serie_norm, p_nqa_visual, p_nqa_funcional, p_observacao, v_novo_retorno);
  else
    for v_linha in select * from jsonb_array_elements(p_linhas)
    loop
      insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, qtd_por_caixa,
        status, numero_serie, numero_serie_norm, codigo_defeito, posicao, tipo_defeito,
        nqa_visual, nqa_funcional, observacao, posto_retorno)
      values (p_colaborador, p_posto, p_pmo, p_op, p_cliente, p_numero_caixa, p_qtd_por_caixa,
        p_status, p_numero_serie, p_numero_serie_norm,
        coalesce(v_linha->>'codigo_defeito', ''), coalesce(v_linha->>'posicao', ''),
        coalesce(v_linha->>'tipo_defeito', ''), p_nqa_visual, p_nqa_funcional, p_observacao, v_novo_retorno);
    end loop;
  end if;

  if p_qtd_por_caixa is not null then
    select count(*) into v_count
    from sf_registros
    where pmo = p_pmo and op = p_op and posto = p_posto and numero_caixa = p_numero_caixa;
    return jsonb_build_object('ok', true, 'caixa_count', v_count);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

notify pgrst, 'reload schema';
