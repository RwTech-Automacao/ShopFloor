-- =============================================================
-- 0166: NQA de caixa e NQA individual — o `total` informativo em PLACAS (placas por painel).
--
-- Decisão do usuário (27/10/2026, opção C): a AMOSTRA e a APROVAÇÃO do NQA continuam em PAINÉIS,
-- exatamente como antes (a faixa da Tabela NQA pelo nº de SNs da caixa/lote; 1 amostra bipada = 1).
-- As placas aparecem SÓ no `total` devolvido (o número exibido "Caixa aprovada — 500 peças").
--
-- Regra única de contagem (a mesma da 0163/0165): linha de sf_registros NÃO é bipe — defeito, reparo,
-- rebipe e reteste repetem o SN —, então as placas são `pecas` somadas UMA vez por SN
-- (distinct on (numero_serie_norm), a linha mais recente). Nunca sum(pecas) direto nas linhas.
--
-- Copia das definições VIGENTES: sf_nqa_caixa (0160) e sf_nqa_individual (0097). A ÚNICA mudança em
-- cada uma é o `total` do retorno (v_placas, calculado logo depois das conferências de existência e ANTES
-- das gravações e da aposentadoria, que renomeia o numero_caixa da montagem reprovada). Todo o resto —
-- assinaturas, gate tem_permissao('lancar') (1 argumento), security definer, search_path, advisory
-- lock, ordem das verificações, códigos de exceção, plano estável da 0160 e grants — é igual.
-- A sf_nqa_individual troca o delimitador $$ por $func$ (o SQL Editor do Supabase não aceita o outro).
--
-- Aditiva e idempotente (create or replace). Teste: supabase/tests/rodar-placas-nqa-test.sh (foto N = 1
-- antes × depois idêntica + cenários N = 50).
-- =============================================================

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
as $func$
declare
  v_sn record;
  v_amostra jsonb;
  v_total int;
  v_cliente text;
  v_amostra_req numeric;
  v_posto_caixa text;
  v_pecas text[];
  v_placas int;  -- 0166: placas da caixa (só para o `total` do retorno; a amostra segue em painéis)
begin
  if not tem_permissao('lancar') then
    raise exception 'SEM_PERMISSAO';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_pmo || '/' || p_op)::bigint);

  -- Peças e cliente da caixa: pelo conjunto de SÉRIES, que as linhas do Almoxarifado repetem sem
  -- mudar (ver o cabeçalho). O `max(posto)` que ficava aqui saiu — o posto da caixa vem de
  -- sf_caixas, lá embaixo, na hora de aposentar a montagem.
  -- 0160: a lista das peças sai UMA vez daqui (array_agg) e as conferências abaixo usam
  -- `= any(v_pecas)` em vez de subconsulta — ver o cabeçalho da 0160.
  select count(distinct numero_serie_norm), max(cliente), array_agg(distinct numero_serie_norm)
    into v_total, v_cliente, v_pecas
  from sf_registros
  where pmo = p_pmo and op = p_op and numero_caixa = p_numero_caixa and numero_serie_norm <> '';
  if v_total = 0 then
    raise exception 'CAIXA_VAZIA';
  end if;

  -- 0166: o `total` (informativo) é em PLACAS — `pecas` UMA vez por SN (a linha mais recente da caixa),
  -- nunca sum(pecas) nas linhas (rebipe repete o SN na caixa). Com N = 1 é o v_total de sempre. A faixa
  -- da Tabela NQA e a contagem das amostras continuam em PAINÉIS (v_total, 1 por amostra).
  -- Calculado AQUI, antes da aposentadoria (que renomeia o numero_caixa da montagem reprovada).
  select coalesce(sum(u.pecas), 0) into v_placas
  from (
    select distinct on (numero_serie_norm) numero_serie_norm, pecas
    from sf_registros
    where pmo = p_pmo and op = p_op and numero_caixa = p_numero_caixa and numero_serie_norm <> ''
    order by numero_serie_norm, data_hora desc, created_at desc
  ) u;

  -- Caixa que JÁ DEU ENTRADA no Almoxarifado não se inspeciona mais (ver (2) no cabeçalho): a ordem
  -- física é NQA primeiro, estoque depois. Pelo PERFIL do posto (recurso 'almoxarifado', semeado
  -- pela 0128), como na 0129 e na 0131 — nunca pelo nome do posto. Vale pros dois resultados:
  -- reprovar deixaria as N linhas do Almoxarifado órfãs do código renomeado, e aprovar trancaria o
  -- cancelamento da entrada por LIFO. O caminho de volta é cancelar a entrada (Registros →
  -- "Cancelar a caixa inteira") e então inspecionar.
  if exists (
    select 1
    from sf_registros r
    join sf_postos po        on po.chave = r.posto
    join sf_posto_perfis pe  on pe.chave = po.perfil
    where r.pmo = p_pmo and r.op = p_op and r.numero_caixa = p_numero_caixa
      and pe.recurso = 'almoxarifado'
  ) then
    raise exception 'CAIXA_JA_NO_ALMOXARIFADO';
  end if;

  -- (a) toda amostra tem que ser DESTA caixa.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_amostras, '[]'::jsonb)) as el(v)
    where not ((el.v->>'sn_norm') = any(v_pecas))
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
        and r.numero_serie_norm = any(v_pecas)
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
  if lower(p_resultado) = 'reprovado' then
    -- O POSTO DA CAIXA vem de sf_caixas — quem sabe de quem é a caixa —, e não mais de
    -- `max(posto)` dos registros (ver o cabeçalho: o Almoxarifado entrou nesse conjunto).
    -- Só a montagem VIGENTE (revisao = 0) interessa: é a que está sendo reprovada agora, e é ela
    -- que sf_aposentar_caixa procura com esta mesma chave.
    select c.posto into v_posto_caixa
    from sf_caixas c
    where c.pmo = p_pmo and c.op = p_op and c.codigo = p_numero_caixa and c.revisao = 0
      -- Desempata o código, que não é único por construção (dois postos de embalagem da mesma OP
      -- podem chegar ao mesmo seq/qtd): vale o posto que tem as peças desta caixa carimbadas.
      and exists (
        select 1 from sf_registros r
        where r.pmo = p_pmo and r.op = p_op and r.posto = c.posto
          and r.numero_caixa = p_numero_caixa and r.numero_serie_norm <> ''
      )
    order by c.posto, c.seq
    limit 1;

    -- Só aposenta quando a rota de retorno passa pelo POSTO DA CAIXA. Se a caixa volta pro Teste e
    -- não pela Embalagem, ninguém vai remontá-la: aposentar ali deixaria o seq órfão, sem caixa
    -- vigente.
    if coalesce(v_posto_caixa, '') <> ''
       and v_posto_caixa = any(string_to_array(coalesce(p_posto_retorno, ''), ','))
    then
      perform sf_aposentar_caixa(p_pmo, p_op, v_posto_caixa, p_numero_caixa);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'total', v_placas);
end $func$;

grant execute on function public.sf_nqa_caixa(text,text,text,text,text,text,text,jsonb) to authenticated;

create or replace function public.sf_nqa_individual(
  p_pmo           text,
  p_op            text,
  p_posto         text,   -- posto NQA (onde grava)
  p_colaborador   text,
  p_sns_norm      text[], -- SNs (normalizados) que o NQA definiu como o lote
  p_resultado     text,   -- 'Aprovado' | 'Reprovado'
  p_posto_retorno text,   -- posto de retorno (só quando reprovado); '' quando aprovado
  p_amostras      jsonb   -- [{ sn_norm, visual, funcional, observacao }] (as N inspecionadas)
) returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $func$
declare
  v_sn record;
  v_amostra jsonb;
  v_total int;
  v_placas int;  -- 0166: placas do lote (só para o `total` do retorno; a amostra segue em painéis)
  v_encontrados int;
  v_cliente text;
  v_amostra_req numeric;
  v_lote_id uuid := gen_random_uuid();
begin
  if not tem_permissao('lancar') then
    raise exception 'SEM_PERMISSAO';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_pmo || '/' || p_op)::bigint);

  v_total := coalesce(array_length(p_sns_norm, 1), 0);
  if v_total = 0 then
    raise exception 'LOTE_VAZIO';
  end if;
  if v_total <> (select count(distinct s) from unnest(p_sns_norm) as s) then
    raise exception 'LOTE_SN_DUPLICADO';
  end if;

  -- Cada SN do lote precisa realmente pertencer à OP (foi lançado nela em algum posto).
  select count(distinct numero_serie_norm), max(cliente) into v_encontrados, v_cliente
  from sf_registros
  where pmo = p_pmo and op = p_op and numero_serie_norm = any(p_sns_norm);
  if v_encontrados < v_total then
    raise exception 'SN_FORA_DA_OP';
  end if;

  -- 0166: o `total` (informativo) é em PLACAS — `pecas` UMA vez por SN (a linha mais recente do SN na
  -- OP), nunca sum(pecas) nas linhas (defeito, reparo, rebipe e reteste repetem o SN). Com N = 1 é o
  -- v_total de sempre. A faixa da Tabela NQA e a contagem das amostras continuam em PAINÉIS.
  -- Calculado antes das gravações do NQA (só lê as linhas que já existiam).
  select coalesce(sum(u.pecas), 0) into v_placas
  from (
    select distinct on (numero_serie_norm) numero_serie_norm, pecas
    from sf_registros
    where pmo = p_pmo and op = p_op and numero_serie_norm = any(p_sns_norm)
    order by numero_serie_norm, data_hora desc, created_at desc
  ) u;

  -- Bloqueia se alguma peça do lote está NO NQA agora (último registro = este posto): ou acabou de
  -- ser inspecionada (aprovado=fim / reprovado=aguardando reteste). Depois do reteste, o último
  -- registro vira outro posto → libera a reinspeção num lote novo.
  if exists (
    select 1 from (
      select distinct on (r.numero_serie_norm) r.numero_serie_norm, r.posto
      from sf_registros r
      where r.pmo = p_pmo and r.op = p_op and r.numero_serie_norm = any(p_sns_norm)
      order by r.numero_serie_norm, r.data_hora desc, r.created_at desc
    ) ult
    where ult.posto = p_posto
  ) then
    raise exception 'LOTE_JA_INSPECIONADO';
  end if;

  -- Reteste INCOMPLETO: peça reprovada leva em `posto_retorno` os postos que ainda deve repassar,
  -- em ordem, com o NQA no fim; cada passagem consome o primeiro da lista. Se o que sobra na frente
  -- não é o próprio NQA, ela ainda não terminou a rota e não pode entrar num lote novo — o lote
  -- inteiro precisa passar por TODOS os postos escolhidos na reprova antes de voltar.
  if exists (
    select 1 from (
      select distinct on (r.numero_serie_norm) r.numero_serie_norm, r.posto_retorno
      from sf_registros r
      where r.pmo = p_pmo and r.op = p_op and r.numero_serie_norm = any(p_sns_norm)
      order by r.numero_serie_norm, r.data_hora desc, r.created_at desc
    ) ult
    where coalesce(ult.posto_retorno, '') <> ''
      and split_part(ult.posto_retorno, ',', 1) <> p_posto
  ) then
    raise exception 'RETESTE_INCOMPLETO';
  end if;

  -- toda amostra tem que ser DESTE lote.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_amostras, '[]'::jsonb)) as el(v)
    where not (el.v->>'sn_norm' = any(p_sns_norm))
  ) then
    raise exception 'AMOSTRA_FORA_DO_LOTE';
  end if;

  -- SÓ p/ APROVAR: qtd de amostras >= tamanho da amostra da Tabela NQA (pela qtd do lote).
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

  -- 'Aprovado' não pode ter amostra reprovada.
  if lower(p_resultado) = 'aprovado' and exists (
    select 1 from jsonb_array_elements(coalesce(p_amostras, '[]'::jsonb)) as el(v)
    where lower(coalesce(el.v->>'visual', '')) = 'reprovado'
       or lower(coalesce(el.v->>'funcional', '')) = 'reprovado'
  ) then
    raise exception 'APROVADO_COM_REPROVA';
  end if;

  -- 'Reprovado' exige ao menos uma amostra reprovada (Visual ou Funcional).
  if lower(p_resultado) = 'reprovado' and not exists (
    select 1 from jsonb_array_elements(coalesce(p_amostras, '[]'::jsonb)) as el(v)
    where lower(coalesce(el.v->>'visual', '')) = 'reprovado'
       or lower(coalesce(el.v->>'funcional', '')) = 'reprovado'
  ) then
    raise exception 'REPROVADO_SEM_REPROVA';
  end if;

  -- 1 registro NQA por SN do lote.
  for v_sn in
    select distinct on (numero_serie_norm) numero_serie, numero_serie_norm
    from sf_registros
    where pmo = p_pmo and op = p_op and numero_serie_norm = any(p_sns_norm)
    order by numero_serie_norm, data_hora desc, created_at desc
  loop
    select el.v into v_amostra
    from jsonb_array_elements(coalesce(p_amostras, '[]'::jsonb)) as el(v)
    where el.v->>'sn_norm' = v_sn.numero_serie_norm
    limit 1;

    insert into sf_registros (colaborador, posto, pmo, op, cliente, status,
      numero_serie, numero_serie_norm, nqa_visual, nqa_funcional, observacao, posto_retorno, nqa_lote_id)
    values (p_colaborador, p_posto, p_pmo, p_op, coalesce(v_cliente, ''), p_resultado,
      v_sn.numero_serie, v_sn.numero_serie_norm,
      coalesce(v_amostra->>'visual', ''), coalesce(v_amostra->>'funcional', ''),
      case when v_amostra is not null then coalesce(v_amostra->>'observacao', '')
           else 'Por amostragem' end,
      nullif(p_posto_retorno, ''), v_lote_id);
  end loop;

  return jsonb_build_object('ok', true, 'total', v_placas);
end;
$func$;

grant execute on function public.sf_nqa_individual(text,text,text,text,text[],text,text,jsonb) to authenticated;

notify pgrst, 'reload schema';
