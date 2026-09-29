-- =============================================================
-- sf_nqa_caixa recriada: o POSTO DA CAIXA deixa de ser `max(posto)` dos registros.
--
-- POR QUE RECRIAR — a 0100 (já aplicada em produção, por isso NÃO é editada no lugar) derivava o
-- posto de embalagem da caixa assim:
--
--     select count(distinct numero_serie_norm), max(cliente), max(posto)
--       into v_total, v_cliente, v_posto_caixa
--     from sf_registros
--     where pmo = ... and op = ... and numero_caixa = p_numero_caixa and numero_serie_norm <> '';
--
-- Aquilo funcionava porque SÓ a Embalagem gravava `numero_caixa` com série preenchida: o conjunto
-- tinha um posto só e o `max` devolvia esse. O posto Almoxarifado mudou isso — o bipe de uma caixa
-- passou a gravar UMA LINHA POR PEÇA (0129), com a série da peça E o código da caixa em
-- `numero_caixa` —, então o conjunto agora tem DOIS postos e o `max` devolve o que vem por último na
-- ordenação de texto.
--
-- A chave do posto é LIVRE (quem cadastra o posto escolhe). Chaves como 'Estoque', 'Expedição' ou
-- 'Recebimento' ordenam DEPOIS de 'Embalagem', e aí o `max` devolvia o posto do almoxarifado; ele
-- não está no `p_posto_retorno` escolhido pela qualidade, a condição do gancho dava falso e
-- `sf_aposentar_caixa` NÃO era chamada. Resultado, tudo calado: a caixa reprovada no NQA ficava com
-- `revisao = 0` e o código original, o guard `caixa_reprovada` da 0129 nunca disparava (a caixa
-- reprovada daria entrada em estoque) e a montagem aposentada não virava histórico — a remontagem
-- da Embalagem carimbaria peça no mesmo código da montagem reprovada. Com a chave literal
-- 'Almoxarifado' o defeito não aparece, porque ela ordena ANTES de 'Embalagem' — mas depender disso
-- é depender do NOME do posto, que é justamente o que este projeto decidiu não fazer (0062/0063).
--
-- O QUE MUDA — só a derivação do posto da caixa, que agora sai de `sf_caixas`, a tabela que SABE de
-- quem é a caixa, e com a mesma chave que `sf_aposentar_caixa` vai usar em seguida
-- (pmo, op, posto, revisao = 0, codigo). O `exists` sobre os registros da embalagem desempata o
-- código, que não é único por construção (dois postos de embalagem da mesma OP podem chegar ao mesmo
-- seq/qtd), na mesma ordem estável que a 0129 usa (posto, seq). Todo o resto do corpo é idêntico ao
-- da 0100.
--
-- POR QUE AS OUTRAS CONSULTAS DO CORPO CONTINUAM SEM FILTRO DE POSTO: elas trabalham com o conjunto
-- de SÉRIES da caixa (`count(distinct numero_serie_norm)`, a validação da amostra, o loop que grava
-- 1 registro de NQA por peça). As linhas do Almoxarifado repetem exatamente as mesmas séries, nas
-- mesmas duas formas que a Embalagem gravou (a 0129 copia `numero_serie`/`numero_serie_norm` das
-- linhas dela), então o conjunto distinto não muda — e mexer nelas sem necessidade num corpo que já
-- roda em produção só acrescentaria risco.
--
-- O gate de permissão fica como está, de UM argumento: trocá-lo por ('shopfloor','lancar') mudaria
-- QUEM consegue finalizar caixa no NQA (perfil global × perfil do módulo), o que não é o defeito
-- desta migração — está anotado na revisão de segurança de 21/09/2026.
--
-- Corpo com $func$: o SQL Editor do Supabase não aceita o delimitador de dois cifrões.
-- Aditiva e idempotente: `create or replace` + `grant`, reaplicar não falha nem muda resultado.
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
begin
  if not tem_permissao('lancar') then
    raise exception 'SEM_PERMISSAO';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_pmo || '/' || p_op)::bigint);

  -- Peças e cliente da caixa: pelo conjunto de SÉRIES, que as linhas do Almoxarifado repetem sem
  -- mudar (ver o cabeçalho). O `max(posto)` que ficava aqui saiu — o posto da caixa vem de
  -- sf_caixas, lá embaixo, na hora de aposentar a montagem.
  select count(distinct numero_serie_norm), max(cliente)
    into v_total, v_cliente
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

  return jsonb_build_object('ok', true, 'total', v_total);
end $func$;

-- O mesmo grant da 0100, repetido porque `create or replace` não mexe nas permissões mas a migração
-- tem que valer sozinha num banco novo. Nada de revoke novo aqui: fechar o EXECUTE de public/anon
-- nesta função é assunto da revisão de segurança, e mudar quem pode chamá-la no mesmo commit que
-- conserta a aposentadoria da caixa misturaria um risco de lockout com um conserto de dado.
grant execute on function public.sf_nqa_caixa(text,text,text,text,text,text,text,jsonb) to authenticated;

notify pgrst, 'reload schema';
