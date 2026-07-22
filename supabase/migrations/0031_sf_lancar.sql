-- =============================================================
-- ShopFloor Processo — função de submit do Lançamento.
-- Atômica (advisory lock por PMO/OP), substitui o LockService do Apps Script.
-- As validações puras (obrigatórios, faixa de SN, posto aplicável) ficam no
-- servidor em TS; aqui só o que é sensível a corrida + a gravação.
-- =============================================================

create or replace function public.sf_lancar(
  p_pmo                  text,
  p_op                   text,
  p_cliente              text,
  p_posto                text,
  p_colaborador          text,
  p_numero_serie         text,
  p_numero_serie_norm    text,
  p_status               text,        -- '' nos postos sem status
  p_posto_tem_status     boolean,     -- posto usa aprovado/reprovado?
  p_numero_caixa         text,        -- '' se não Embalagem
  p_qtd_por_caixa        int,         -- null se não Embalagem (= limite da caixa)
  p_nqa_visual           text,
  p_nqa_funcional        text,
  p_prev_posto           text,        -- posto anterior exigido; '' se nenhum
  p_prev_precisa_aprovado boolean,    -- true = exige aprovado no anterior
  p_linhas               jsonb        -- [{codigo_defeito,posicao,tipo_defeito}]; [] → 1 linha base
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ultimo_status text;
  v_existe        boolean;
  v_prev_ok       boolean;
  v_count         int;
  v_linha         jsonb;
begin
  if not tem_permissao('lancar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;

  -- Serializa lançamentos da MESMA OP (substitui o LockService). Cast p/ bigint
  -- (hashtext devolve int4; evita ambiguidade na resolução de pg_advisory_xact_lock).
  perform pg_advisory_xact_lock(hashtext(p_pmo || '/' || p_op)::bigint);

  -- 1) Anti-duplicidade / re-lançamento (aprovado nunca repete).
  if p_posto_tem_status then
    select status into v_ultimo_status
    from sf_registros
    where pmo = p_pmo and op = p_op and numero_serie_norm = p_numero_serie_norm and posto = p_posto
    order by data_hora desc
    limit 1;
    if v_ultimo_status is not null and lower(v_ultimo_status) = 'aprovado' then
      return jsonb_build_object('ok', false, 'erro', 'DUPLICADO_APROVADO');
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

  -- 2) Trava de sequência (posto anterior aplicável satisfeito?).
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

  -- 3) Caixa (Embalagem): limite.
  if p_qtd_por_caixa is not null then
    select count(*) into v_count
    from sf_registros
    where pmo = p_pmo and op = p_op and posto = p_posto and numero_caixa = p_numero_caixa;
    if v_count >= p_qtd_por_caixa then
      return jsonb_build_object('ok', false, 'erro', 'CAIXA_CHEIA');
    end if;
  end if;

  -- 4) Gravação: 1 linha por elemento de p_linhas (ou 1 linha base se []).
  if jsonb_array_length(p_linhas) = 0 then
    insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, qtd_por_caixa,
      status, numero_serie, numero_serie_norm, nqa_visual, nqa_funcional)
    values (p_colaborador, p_posto, p_pmo, p_op, p_cliente, p_numero_caixa, p_qtd_por_caixa,
      p_status, p_numero_serie, p_numero_serie_norm, p_nqa_visual, p_nqa_funcional);
  else
    for v_linha in select * from jsonb_array_elements(p_linhas)
    loop
      insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, qtd_por_caixa,
        status, numero_serie, numero_serie_norm, codigo_defeito, posicao, tipo_defeito,
        nqa_visual, nqa_funcional)
      values (p_colaborador, p_posto, p_pmo, p_op, p_cliente, p_numero_caixa, p_qtd_por_caixa,
        p_status, p_numero_serie, p_numero_serie_norm,
        coalesce(v_linha->>'codigo_defeito', ''), coalesce(v_linha->>'posicao', ''),
        coalesce(v_linha->>'tipo_defeito', ''), p_nqa_visual, p_nqa_funcional);
    end loop;
  end if;

  -- 5) Embalagem: devolve a contagem pós-inserção.
  if p_qtd_por_caixa is not null then
    select count(*) into v_count
    from sf_registros
    where pmo = p_pmo and op = p_op and posto = p_posto and numero_caixa = p_numero_caixa;
    return jsonb_build_object('ok', true, 'caixa_count', v_count);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;
