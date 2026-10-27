-- =============================================================
-- 0163: caixa e embalagem contam PLACAS (placas por painel).
--
-- Um bipe de painel vale N placas (sf_ordens.placas_por_painel, gravado em sf_registros.pecas pelo
-- trigger da 0161). O limite da caixa é digitado em PLACAS.
--
-- Regra única de contagem: uma linha de sf_registros NÃO é um bipe (defeito, reparo, rebipe e reteste
-- repetem o SN), então as peças da caixa são `pecas` somadas UMA vez por SN
-- (distinct on (numero_serie_norm), a linha mais recente) — nunca sum(pecas) direto nas linhas.
-- Com N = 1 o resultado é idêntico ao count(distinct numero_serie_norm) de antes.
--
-- Copia das definições vigentes: sf_fechar_caixa (0100) e sf_lancar (0103); troca só a contagem,
-- a recusa do limite e o `pecas` no retorno.
-- =============================================================

-- sf_fechar_caixa: opera na caixa VIGENTE (revisao=0) e conta PEÇAS, não registros
-- ---------------------------------------------------------------------------
-- `count(distinct numero_serie_norm)`: uma peça bipada duas vezes na mesma caixa é uma peça só.
-- Hoje isso não acontece no fluxo normal, mas é o número que a folha impressa e o NQA usam —
-- contar registro em vez de peça é um erro esperando uma re-bipagem pra aparecer.
create or replace function public.sf_fechar_caixa(
  p_pmo text, p_op text, p_posto text, p_seq int, p_ultima boolean
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_marcador text := 'CX[' || p_seq || ']';
  v_qtd      int;
  v_codigo   text;
begin
  if not tem_permissao('shopfloor', 'lancar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_pmo||'/'||p_op||'/'||p_posto)::bigint);

  -- Peças (placas) da caixa: `pecas` UMA vez por SN, a linha mais recente.
  select coalesce(sum(u.pecas), 0) into v_qtd
  from (
    select distinct on (numero_serie_norm) numero_serie_norm, pecas
    from sf_registros
    where pmo = p_pmo and op = p_op and posto = p_posto and numero_caixa = v_marcador
    order by numero_serie_norm, data_hora desc, created_at desc
  ) u;
  if v_qtd = 0 then
    return jsonb_build_object('ok', false, 'erro', 'CAIXA_VAZIA');
  end if;

  v_codigo := 'CX[' || p_seq || '][' || v_qtd || ']' || p_op || '-' || p_pmo;

  update sf_caixas set qtd = v_qtd, codigo = v_codigo, fechada = true, ultima = p_ultima, fechada_em = now()
  where pmo = p_pmo and op = p_op and posto = p_posto and seq = p_seq and revisao = 0;

  update sf_registros set numero_caixa = v_codigo
  where pmo = p_pmo and op = p_op and posto = p_posto and numero_caixa = v_marcador;

  return jsonb_build_object('ok', true, 'codigo', v_codigo);
end;
$$;

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
  v_pecas         int;
  v_linha         jsonb;
  v_last_retorno  text;
  v_em_reteste    boolean;
  v_novo_retorno  text;
begin
  if not tem_permissao('shopfloor', 'lancar') then
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

  -- Placas deste bipe: N da OP (sf_ordens.placas_por_painel); sem OP cadastrada vale 1.
  select coalesce(
    (select o.placas_por_painel from sf_ordens o where o.pmo = p_pmo and o.op = p_op), 1)
  into v_pecas;

  -- 3) Embalagem: valida limite ANTES de inserir.
  -- Conta as OUTRAS peças da caixa, não os registros: a peça que está sendo bipada pode já ter um
  -- registro nesta mesma caixa (rebipe, retorno de reteste) e ela não ocupa uma vaga a mais. Sem o
  -- `<> p_numero_serie_norm`, a embalagem INDIVIDUAL (caixa = o próprio SN, limite 1) nunca deixaria
  -- a peça voltar: encontraria 1 >= 1 e devolveria CAIXA_CHEIA no primeiro bipe do retorno.
  if p_qtd_por_caixa is not null then
    -- O limite está em PLACAS: `outras + N > limite` recusa o painel que estoura (com N = 1 é o
    -- mesmo `outras >= limite` de antes). Painel é sempre completo, não há painel parcial.
    select coalesce(sum(u.pecas), 0) into v_count
    from (
      select distinct on (numero_serie_norm) numero_serie_norm, pecas
      from sf_registros
      where pmo = p_pmo and op = p_op and posto = p_posto and numero_caixa = p_numero_caixa
        and numero_serie_norm <> p_numero_serie_norm
      order by numero_serie_norm, data_hora desc, created_at desc
    ) u;
    if v_count + v_pecas > p_qtd_por_caixa then
      return jsonb_build_object('ok', false, 'erro', 'CAIXA_CHEIA',
        'pecas', v_pecas, 'count', v_count, 'limite', p_qtd_por_caixa);
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
    select coalesce(sum(u.pecas), 0) into v_count
    from (
      select distinct on (numero_serie_norm) numero_serie_norm, pecas
      from sf_registros
      where pmo = p_pmo and op = p_op and posto = p_posto and numero_caixa = p_numero_caixa
      order by numero_serie_norm, data_hora desc, created_at desc
    ) u;
    return jsonb_build_object('ok', true, 'caixa_count', v_count, 'pecas', v_pecas);
  end if;

  return jsonb_build_object('ok', true, 'pecas', v_pecas);
end;
$$;

notify pgrst, 'reload schema';
