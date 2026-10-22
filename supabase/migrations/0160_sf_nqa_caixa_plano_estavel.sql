-- =============================================================
-- sf_nqa_caixa com PLANO ESTÁVEL: a mesma regra da 0130, sem depender da estatística do Postgres.
--
-- INCIDENTE (22/10/2026, produção): numa OP grande e NOVA (8.529 registros, estatísticas ainda sem
-- conhecer a OP) o NQA por caixa levou 36,9 s (70 milhões de leituras) pra conferir 24 peças. O
-- planejador estimou 1 linha para (pmo, op) (eram 8.528) e escolheu Nested Loop Semi Join, que varre
-- o índice (pmo, op) 8.528 vezes — o bloco "Bloqueia se a caixa está NO NQA agora" (subconsulta
-- `numero_serie_norm in (select ...)`). A chamada passou do limite do gateway (504), o banco terminou
-- e gravou, a tela mostrou "Não foi possível registrar o NQA da caixa", e a fila na trava
-- pg_advisory_xact_lock(pmo/op) deixou o sistema todo lento. Alívio na hora: `ANALYZE sf_registros`
-- (a mesma consulta caiu pra 1 ms). Reproduzido localmente: 20 mil registros de uma OP nova sem
-- analyze = 94,9 s; com analyze, 0,5 ms. Esta migração é o conserto definitivo.
--
-- A REGRA NÃO MUDA. Mesma assinatura, mesmo gate, mesma ordem das verificações, mesmos códigos de
-- exceção, mesmo loop de inserção, mesma aposentadoria, mesmo retorno e mesmo grant da 0130. A única
-- diferença no corpo: a lista das peças da caixa é calculada UMA vez (`v_pecas text[]`, no mesmo
-- select que já calculava v_total e v_cliente) e as conferências das amostras e do "NO NQA agora"
-- passam a usar `numero_serie_norm = any(v_pecas)` no lugar de `in/not in (select ...)`. Com a lista
-- em mãos o planejador usa o índice por peça (pmo, op, numero_serie_norm) como ScalarArrayOp, e esse
-- plano não depende de quantas linhas ele acha que a OP tem.
--
-- Além disso (defesa em profundidade):
--   * índice (pmo, op, numero_caixa) parcial: o sf_registros_caixa existente é (pmo, op, posto,
--     numero_caixa) e, sem `posto` na condição, as buscas por caixa varrem o subintervalo (pmo, op)
--     inteiro; este vai direto na caixa.
--   * autovacuum/analyze mais frequente na sf_registros: OPs novas e grandes entram de uma vez e a
--     estatística velha foi a causa do incidente.
--
-- Aditiva e idempotente: `create or replace`, `create index if not exists`, `alter table ... set`.
-- Corpo com $func$: o SQL Editor do Supabase não aceita o delimitador de dois cifrões.
-- =============================================================

-- Índice por caixa dentro da OP. Sem `concurrently` (o SQL Editor/transação não aceita); a tabela tem
-- ~107 mil linhas e leva menos de 1 s. Parcial: linhas sem caixa (a maioria) ficam fora do índice.
create index if not exists sf_registros_ordem_caixa
  on public.sf_registros (pmo, op, numero_caixa) where numero_caixa <> '';

-- OPs novas e grandes entram de uma vez; o analyze automático padrão (10% + 50 linhas) demora a
-- enxergar. Com 2% + 500 a estatística acompanha — a estatística velha causou o incidente de 22/10.
alter table public.sf_registros set (
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 500
);

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

  return jsonb_build_object('ok', true, 'total', v_total);
end $func$;

-- O mesmo grant da 0100, repetido porque `create or replace` não mexe nas permissões mas a migração
-- tem que valer sozinha num banco novo. Nada de revoke novo aqui: fechar o EXECUTE de public/anon
-- nesta função é assunto da revisão de segurança, e mudar quem pode chamá-la no mesmo commit que
-- conserta a aposentadoria da caixa misturaria um risco de lockout com um conserto de dado.
grant execute on function public.sf_nqa_caixa(text,text,text,text,text,text,text,jsonb) to authenticated;

notify pgrst, 'reload schema';
