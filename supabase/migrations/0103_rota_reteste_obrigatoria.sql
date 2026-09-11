-- =============================================================
-- Rota de reteste: fazer valer, e sobreviver à reprova no meio do caminho.
--
-- Dois furos que só apareceram quando a rota passou a ter um posto INTERMEDIÁRIO (a Inspeção PTH
-- entre a Manutenção e o Teste, migração 0102). No retorno do NQA eles não apareciam porque lá o
-- posto do meio é a Embalagem, que não tem status e portanto nunca reprova.
--
--   1. A rota não BARRAVA nada. Peça reparada voltava direto pro Teste: a trava de manutenção só
--      pergunta "passou pela Manutenção?", e passou. Faltava recusar quando a peça ainda deve um
--      posto anterior da rota.
--
--   2. Reprovar no meio da rota APAGAVA a rota. A peça saía do laço de reparo em silêncio — ia pra
--      Manutenção, era reparada, e voltava direto pro Teste sem repassar a inspeção.
-- =============================================================

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

  -- A peça está numa ROTA e este NÃO é o próximo posto dela → recusa. Sem isto, a rota é um
  -- conselho: a peça reparada voltava direto pro Teste, porque a trava de manutenção só pergunta
  -- "passou pela Manutenção?" — e passou. O que falta é o posto do meio.
  if coalesce(v_last_retorno, '') <> '' and split_part(v_last_retorno, ',', 1) <> p_posto then
    return jsonb_build_object('ok', false, 'erro', 'RETESTE_PENDENTE',
                              'posto_pendente', split_part(v_last_retorno, ',', 1));
  end if;

  if v_em_reteste then
    if lower(p_status) <> 'reprovado' then
      -- consome o 1º da lista → propaga o resto (vazio vira null = fim do reteste)
      v_novo_retorno := nullif(
        case when position(',' in v_last_retorno) > 0
             then substring(v_last_retorno from position(',' in v_last_retorno) + 1)
             else '' end, '');
    else
      -- REPROVOU no meio da rota: NÃO consome. A peça continua devendo este posto e os seguintes,
      -- e vai pra Manutenção. Antes a rota era apagada aqui — a peça saía do laço de reparo sem
      -- ninguém perceber e voltava direto pro posto de origem.
      v_novo_retorno := v_last_retorno;
    end if;
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
  -- Conta as OUTRAS peças da caixa, não os registros: a peça que está sendo bipada pode já ter um
  -- registro nesta mesma caixa (rebipe, retorno de reteste) e ela não ocupa uma vaga a mais. Sem o
  -- `<> p_numero_serie_norm`, a embalagem INDIVIDUAL (caixa = o próprio SN, limite 1) nunca deixaria
  -- a peça voltar: encontraria 1 >= 1 e devolveria CAIXA_CHEIA no primeiro bipe do retorno.
  if p_qtd_por_caixa is not null then
    select count(distinct numero_serie_norm) into v_count
    from sf_registros
    where pmo = p_pmo and op = p_op and posto = p_posto and numero_caixa = p_numero_caixa
      and numero_serie_norm <> p_numero_serie_norm;
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
    select count(distinct numero_serie_norm) into v_count
    from sf_registros
    where pmo = p_pmo and op = p_op and posto = p_posto and numero_caixa = p_numero_caixa;
    return jsonb_build_object('ok', true, 'caixa_count', v_count);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- sf_registrar_reparo: o reparo PRESERVA a rota que a peça já devia
-- ---------------------------------------------------------------------------
create or replace function public.sf_registrar_reparo(
  p_colaborador          text,
  p_pmo                  text,
  p_op                   text,
  p_cliente              text,
  p_sn                   text,
  p_sn_norm              text,
  p_cod                  text,
  p_pos                  text,
  p_tipo                 text,
  p_posto_origem         text,
  p_data_hora_origem     timestamptz,
  p_consertos            jsonb,
  p_defeitos_constatados jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rota      text;
  v_rota_atual text;
begin
  if not tem_permissao('lancar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;
  if coalesce(jsonb_array_length(p_consertos), 0) = 0 then
    return jsonb_build_object('ok', false, 'erro', 'SEM_CONSERTOS');
  end if;
  if coalesce(jsonb_array_length(p_defeitos_constatados), 0) = 0 then
    return jsonb_build_object('ok', false, 'erro', 'SEM_CONSTATADOS_DEFEITO');
  end if;

  -- A peça JÁ devia uma rota? Então o reparo não a inventa de novo nem a apaga: preserva.
  -- É o caso da reprova no meio do caminho — reprovou na Inspeção PTH, veio pra cá, e continua
  -- devendo "Inspeção PTH, depois Teste". Ler a configuração do posto de origem aqui daria a rota
  -- ERRADA: a origem passou a ser a Inspeção PTH, que não tem configuração nenhuma, e a peça
  -- voltaria direto pro Teste — exatamente o furo que a 0103 fecha do outro lado.
  select nullif(trim(posto_retorno), '') into v_rota_atual
  from sf_registros
  where pmo = p_pmo and op = p_op and numero_serie_norm = p_sn_norm
  order by data_hora desc, created_at desc
  limit 1;

  if v_rota_atual is not null then
    v_rota := v_rota_atual;
  else
    -- Primeira ida à Manutenção: a rota sai da configuração do posto que reprovou. Sem
    -- configuração, `v_rota` fica null e vale o de sempre — volta direto pro posto de origem.
    select nullif(trim(retorno_pos_manutencao), '') into v_rota
    from sf_postos where chave = p_posto_origem;
    if v_rota is not null then
      v_rota := v_rota || ',' || p_posto_origem;
    end if;
  end if;

  -- Linhas de conserto: 1 por conserto, com o defeito relatado.
  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm,
    codigo_defeito, posicao, tipo_defeito, reparo_conserto, reparo_posicao, posto_origem,
    data_hora_origem, posto_retorno)
  select p_colaborador, 'Manutenção', p_pmo, p_op, p_cliente, p_sn, p_sn_norm,
    coalesce(p_cod, ''), coalesce(p_pos, ''), coalesce(p_tipo, ''),
    coalesce(x->>'descricao', ''), coalesce(x->>'posicao', ''),
    p_posto_origem, p_data_hora_origem, v_rota
  from jsonb_array_elements(p_consertos) x;

  -- Linhas de defeito CONSTATADO: 1 por código; status '' e reparo_constatado=true.
  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm,
    codigo_defeito, posto_origem, data_hora_origem, reparo_constatado, posto_retorno)
  select p_colaborador, 'Manutenção', p_pmo, p_op, p_cliente, p_sn, p_sn_norm,
    d, p_posto_origem, p_data_hora_origem, true, v_rota
  from jsonb_array_elements_text(p_defeitos_constatados) d
  where coalesce(d, '') <> '';

  return jsonb_build_object('ok', true,
    'linhas', jsonb_array_length(p_consertos),
    'constatados', jsonb_array_length(p_defeitos_constatados),
    'rota', coalesce(v_rota, ''));
end;
$$;

notify pgrst, 'reload schema';
