-- =============================================================
-- Caixa reprovada no NQA: a montagem antiga vira HISTÓRICO e a remontagem nasce como caixa nova
-- COM O MESMO NÚMERO.
--
--   antes da reprova   CX[7][14]8498-PMOC14   (fechada)
--   depois da reprova  CX[7]R[14]8498-PMOC14  (histórico, revisao=1 — não muda mais)
--   remontada          CX[7][14]8498-PMOC14   (caixa nova, revisao=0)
--
-- Por que caixa NOVA em vez de reabrir a antiga: reabrir faria a mesma peça ganhar um 2º registro
-- com o MESMO numero_caixa, e aí toda contagem da caixa (fechar, limite, folha impressa) contaria
-- a peça duas vezes. Com caixa nova cada montagem tem o seu marcador, sem colisão — e o NQA passa
-- a resolver a remontagem sozinho, porque ele já procura o registro de caixa MAIS RECENTE da peça.
--
-- `revisao`: 0 = a caixa vigente daquele seq; 1,2,… = montagens reprovadas, da mais antiga pra mais
-- nova. Só existe UMA revisao=0 por (pmo,op,posto,seq) — é o que a unicidade nova garante.
-- =============================================================

alter table public.sf_caixas add column if not exists revisao int not null default 0;

-- A unicidade tinha que sair do (pmo,op,posto,seq): agora convivem a montagem reprovada e a
-- vigente, as duas com o MESMO seq.
alter table public.sf_caixas drop constraint if exists sf_caixas_pmo_op_posto_seq_key;
create unique index if not exists sf_caixas_pmo_op_posto_seq_revisao_key
  on public.sf_caixas (pmo, op, posto, seq, revisao);

-- ---------------------------------------------------------------------------
-- Aposenta a montagem atual da caixa: ela vira revisão histórica e libera o seq
-- ---------------------------------------------------------------------------
-- Faz o mínimo pra caixa parar de ser "a caixa 7": sobe a revisão, carimba o R no código (em
-- sf_caixas E nos registros, que é como as duas pontas se acham) e apaga a marca de "última".
-- NÃO mexe em fechada/qtd/fechada_em de propósito — a montagem antiga fica congelada como foi.
create or replace function public.sf_aposentar_caixa(
  p_pmo text, p_op text, p_posto text, p_numero_caixa text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_cx        record;
  v_rev       int;
  v_marca     text;
  v_prefixo   text;
  v_codigo_r  text;
begin
  -- A caixa vigente é sempre a revisao=0; o NQA manda o código FINAL (só inspeciona caixa fechada).
  select id, seq, codigo into v_cx
  from sf_caixas
  where pmo = p_pmo and op = p_op and posto = p_posto and revisao = 0 and codigo = p_numero_caixa;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'CAIXA_NAO_ENCONTRADA');
  end if;

  -- Próxima revisão livre deste seq (1ª reprova → 1; se reprovar de novo depois → 2).
  select coalesce(max(revisao), 0) + 1 into v_rev
  from sf_caixas
  where pmo = p_pmo and op = p_op and posto = p_posto and seq = v_cx.seq;

  -- 1ª aposentadoria = 'R' puro (CX[7]R); da 2ª em diante numera (CX[7]R2) pra não colidir.
  v_marca := case when v_rev = 1 then 'R' else 'R' || v_rev end;
  -- O R entra logo depois do 'CX[seq]', preservando o resto do código ([qtd]OP-PMO).
  v_prefixo  := 'CX[' || v_cx.seq || ']';
  v_codigo_r := v_prefixo || v_marca || substring(v_cx.codigo from length(v_prefixo) + 1);

  update sf_caixas
     set revisao = v_rev, codigo = v_codigo_r, ultima = false
   where id = v_cx.id;

  -- Os registros carregam o código final; sem renomear, a remontagem fecharia com o MESMO código
  -- e as duas montagens virariam uma só nas telas de consulta.
  update sf_registros
     set numero_caixa = v_codigo_r
   where pmo = p_pmo and op = p_op and posto = p_posto and numero_caixa = v_cx.codigo;

  return jsonb_build_object('ok', true, 'seq', v_cx.seq, 'revisao', v_rev, 'codigo', v_codigo_r);
end;
$$;

grant execute on function public.sf_aposentar_caixa(text,text,text,text) to authenticated;

-- ---------------------------------------------------------------------------
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
  if not tem_permissao('lancar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_pmo||'/'||p_op||'/'||p_posto)::bigint);

  select count(distinct numero_serie_norm) into v_qtd from sf_registros
  where pmo = p_pmo and op = p_op and posto = p_posto and numero_caixa = v_marcador;
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

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- sf_nqa_caixa: ao REPROVAR, aposenta a montagem (corpo idêntico à 0081 + o gancho no fim)
-- ---------------------------------------------------------------------------
-- Só aposenta quando a rota de retorno passa pelo POSTO DA CAIXA. Se a caixa volta pro Teste e não
-- pela Embalagem, ninguém vai remontá-la: aposentar ali deixaria o seq órfão, sem caixa vigente.
create or replace function public.sf_nqa_caixa(
  p_pmo           text,
  p_op            text,
  p_posto         text,
  p_colaborador   text,
  p_numero_caixa  text,
  p_resultado     text,
  p_posto_retorno text,
  p_amostras      jsonb
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
  v_amostra_req numeric;
  v_posto_caixa text;
begin
  if not tem_permissao('lancar') then
    raise exception 'SEM_PERMISSAO';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_pmo || '/' || p_op)::bigint);

  select count(distinct numero_serie_norm), max(cliente), max(posto)
    into v_total, v_cliente, v_posto_caixa
  from sf_registros
  where pmo = p_pmo and op = p_op and numero_caixa = p_numero_caixa and numero_serie_norm <> '';
  if v_total = 0 then
    raise exception 'CAIXA_VAZIA';
  end if;

  -- (a) toda amostra tem que ser DESTA caixa.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_amostras, '[]'::jsonb)) as el(v)
    where (el.v->>'sn_norm') not in (
      select numero_serie_norm from sf_registros
      where pmo = p_pmo and op = p_op and numero_caixa = p_numero_caixa and numero_serie_norm <> ''
    )
  ) then
    raise exception 'AMOSTRA_FORA_DA_CAIXA';
  end if;

  -- (b) SÓ p/ APROVAR: qtd de amostras >= tamanho da amostra da Tabela NQA (pela qtd da caixa).
  if lower(p_resultado) = 'aprovado' then
    select tamanho_amostra into v_amostra_req
    from tabela_nqa
    where quantidade_min <= v_total and (quantidade_max is null or v_total <= quantidade_max)
    order by ordem
    limit 1;
    if v_amostra_req is null or v_amostra_req <= 0 then
      raise exception 'AMOSTRA_NQA_INVALIDA';
    end if;
    if coalesce(jsonb_array_length(p_amostras), 0) < v_amostra_req then
      raise exception 'AMOSTRAS_INSUFICIENTES';
    end if;
  end if;

  -- (c) 'Aprovado' não pode ter amostra reprovada.
  if lower(p_resultado) = 'aprovado' and exists (
    select 1 from jsonb_array_elements(coalesce(p_amostras, '[]'::jsonb)) as el(v)
    where lower(coalesce(el.v->>'visual', '')) = 'reprovado'
       or lower(coalesce(el.v->>'funcional', '')) = 'reprovado'
  ) then
    raise exception 'APROVADO_COM_REPROVA';
  end if;

  -- (d) 'Reprovado' exige ao menos uma amostra reprovada (Visual ou Funcional).
  if lower(p_resultado) = 'reprovado' and not exists (
    select 1 from jsonb_array_elements(coalesce(p_amostras, '[]'::jsonb)) as el(v)
    where lower(coalesce(el.v->>'visual', '')) = 'reprovado'
       or lower(coalesce(el.v->>'funcional', '')) = 'reprovado'
  ) then
    raise exception 'REPROVADO_SEM_REPROVA';
  end if;

  -- Bloqueia se a caixa está NO NQA agora (último registro da peça = posto NQA).
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

  -- Aposenta a montagem DEPOIS do loop: o loop acha as peças pelo numero_caixa, que a aposentadoria
  -- renomeia. Os registros do NQA nascem sem numero_caixa, então a renomeação não os alcança.
  if lower(p_resultado) = 'reprovado'
     and coalesce(v_posto_caixa, '') <> ''
     and v_posto_caixa = any(string_to_array(coalesce(p_posto_retorno, ''), ','))
  then
    perform sf_aposentar_caixa(p_pmo, p_op, v_posto_caixa, p_numero_caixa);
  end if;

  return jsonb_build_object('ok', true, 'total', v_total);
end;
$$;

grant execute on function public.sf_nqa_caixa(text,text,text,text,text,text,text,jsonb) to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- sf_lancar: a caixa conta PEÇAS, não registros (corpo idêntico à 0080 + as duas contagens)
-- ---------------------------------------------------------------------------
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

notify pgrst, 'reload schema';
