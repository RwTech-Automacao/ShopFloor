-- =============================================================
-- Comentário livre no lançamento (usado no NQA). Coluna aditiva em
-- sf_registros + sf_lancar passa a receber/gravar p_observacao.
-- A função é recriada a partir da última definição (0033) com apenas:
--   1) novo parâmetro p_observacao text default '' (por último);
--   2) coluna observacao nos dois inserts de sf_registros.
-- Nenhuma outra lógica mudou.
-- =============================================================
alter table public.sf_registros add column if not exists observacao text not null default '';

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
begin
  if not tem_permissao('lancar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;

  perform pg_advisory_xact_lock(hashtext(p_pmo || '/' || p_op)::bigint);

  -- 1) Anti-duplicidade / re-lançamento (aprovado nunca repete).
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
      status, numero_serie, numero_serie_norm, nqa_visual, nqa_funcional, observacao)
    values (p_colaborador, p_posto, p_pmo, p_op, p_cliente, p_numero_caixa, p_qtd_por_caixa,
      p_status, p_numero_serie, p_numero_serie_norm, p_nqa_visual, p_nqa_funcional, p_observacao);
  else
    for v_linha in select * from jsonb_array_elements(p_linhas)
    loop
      insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, qtd_por_caixa,
        status, numero_serie, numero_serie_norm, codigo_defeito, posicao, tipo_defeito,
        nqa_visual, nqa_funcional, observacao)
      values (p_colaborador, p_posto, p_pmo, p_op, p_cliente, p_numero_caixa, p_qtd_por_caixa,
        p_status, p_numero_serie, p_numero_serie_norm,
        coalesce(v_linha->>'codigo_defeito', ''), coalesce(v_linha->>'posicao', ''),
        coalesce(v_linha->>'tipo_defeito', ''), p_nqa_visual, p_nqa_funcional, p_observacao);
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
