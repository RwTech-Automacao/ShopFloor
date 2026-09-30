-- =============================================================
-- sf_nqa_caixa recriada, com DUAS mudanças declaradas em relação à 0100:
--
--   (1) o POSTO DA CAIXA deixa de ser `max(posto)` dos registros;
--   (2) recusa NOVA `CAIXA_JA_NO_ALMOXARIFADO`: caixa que já deu entrada no Almoxarifado não se
--       inspeciona mais.
--
-- COMO CONFERIR QUE SÃO SÓ ESSAS DUAS: extraia o corpo da função dos dois arquivos (da linha
-- `create or replace function public.sf_nqa_caixa(` até o fim do corpo — na 0100 o corpo fecha com
-- `end;` + o delimitador de dois cifrões, aqui com `end $func$;`) e rode `diff -u` entre os dois.
-- Saem TRÊS blocos, e só
-- estes três:
--
--   hunk 1  o `as` de dois cifrões → `as $func$`. Diferença de FORMA, não de comportamento: o SQL Editor do
--           Supabase não aceita o delimitador de dois cifrões, e é regra do repositório. Já estava
--           aqui antes desta correção.
--   hunk 2  o `max(posto)` sai do primeiro `select` (parte da diferença (1)) e entra a recusa nova
--           (diferença (2)). Os dois caem no mesmo hunk porque são linhas vizinhas.
--   hunk 3  a derivação do posto da caixa por sf_caixas, na hora de aposentar (resto da (1)).
--
-- Assinatura, `language`, `security definer`, `set search_path`, o gate de permissão, o grant e
-- TODAS as outras recusas são byte a byte os da 0100.
--
-- A 0100 está EM PRODUÇÃO e por isso não é editada no lugar; esta 0130 nunca foi aplicada em banco
-- nenhum, então é ela que recebe correção — não há migração nova para isto.
--
-- =============================================================
-- (1) O POSTO DA CAIXA
--
-- POR QUE RECRIAR — a 0100 derivava o posto de embalagem da caixa assim:
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
-- seq/qtd), na mesma ordem estável que a 0129 usa (posto, seq).
--
-- ESTA MUDANÇA FICA MESMO COM A RECUSA (2) — que torna o conjunto de dois postos inalcançável pelo
-- caminho legítimo. O `max(posto)` erra sozinho, sem Almoxarifado nenhum: dois postos de EMBALAGEM
-- da mesma OP podem chegar ao mesmo código, e aí o `max` devolve o do nome maior em vez do que tem
-- as peças desta caixa — é exatamente por isso que o desempate por `exists` existe. Além disso, a
-- recusa vale de agora em diante, e registro já gravado continua no banco.
--
-- POR QUE AS OUTRAS CONSULTAS DO CORPO CONTINUAM SEM FILTRO DE POSTO: elas trabalham com o conjunto
-- de SÉRIES da caixa (`count(distinct numero_serie_norm)`, a validação da amostra, o loop que grava
-- 1 registro de NQA por peça). As linhas do Almoxarifado repetem exatamente as mesmas séries, nas
-- mesmas duas formas que a Embalagem gravou (a 0129 copia `numero_serie`/`numero_serie_norm` das
-- linhas dela), então o conjunto distinto não muda — e mexer nelas sem necessidade num corpo que já
-- roda em produção só acrescentaria risco.
--
-- =============================================================
-- (2) A RECUSA `CAIXA_JA_NO_ALMOXARIFADO`
--
-- O DEFEITO — nada impedia o NQA de inspecionar uma caixa que JÁ DEU ENTRADA no Almoxarifado. A
-- guarda `CAIXA_JA_INSPECIONADA` não pega esse caso: ela olha se o último bipe da peça é o próprio
-- posto de NQA, e o último bipe ali é o do Almoxarifado. Reprovando nessa situação, tudo dá errado
-- de uma vez:
--
--   * `sf_aposentar_caixa` (0100) renomeia para `CX[n]R` só as linhas DO POSTO DA CAIXA
--     (`update sf_registros ... where posto = p_posto`), então as N linhas do Almoxarifado ficam com
--     o código ANTIGO, órfãs de qualquer caixa vigente;
--   * a remontagem da Embalagem fecha com o MESMO `CX[seq][qtd]...`, e o rebipe da caixa remontada
--     é recusado pela 0129 com `ja_lancado` — "N de N peças desta caixa estão lançadas", frase falsa:
--     as lançadas são as órfãs da montagem reprovada. A caixa física nunca mais entra no estoque;
--   * não há saída pela tela: "Cancelar a caixa inteira" (0131) e "Cancelar lançamento" (0133)
--     recusam com `NAO_E_ULTIMO`, porque o bipe do NQA é posterior ao do Almoxarifado;
--   * a linha da fila do Compels (0132) da entrada original fica de pé — quantidade N, sem estorno e
--     sem cancelamento —, e o ERP recebe N peças de uma caixa que foi desfeita.
--
-- A CORREÇÃO É RECUSAR, e não consertar a aposentadoria: a ordem física real é NQA primeiro,
-- Almoxarifado depois — o NQA inspeciona por amostragem a caixa que a Embalagem lacrou, e só o que
-- passa vai pro estoque. Uma caixa que já está no estoque não é mais objeto de inspeção; querer
-- inspecioná-la é sinal de que a entrada foi dada cedo, e o gesto certo é desfazer a entrada.
-- (Consertar a aposentadoria exigiria editar a 0100, que está em produção, e ainda deixaria de pé os
-- becos sem saída do LIFO descritos acima.)
--
-- COMO SE IDENTIFICA "POSTO DE ALMOXARIFADO": pelo PERFIL do posto, nunca pelo nome. É o mesmo
-- caminho da 0129 (`posto_invalido`) e da 0131 (`POSTO_NAO_CANCELAVEL`) —
-- sf_registros.posto → sf_postos.perfil → sf_posto_perfis.recurso = 'almoxarifado', o recurso que a
-- 0128 semeia. A chave do posto é livre (quem cadastra escolhe), e olhar o nome é justamente o que
-- este projeto decidiu não fazer (0062/0063). A caixa é identificada por `numero_caixa` dentro da
-- OP, a mesma chave que todo o resto desta função usa pra dizer "as peças desta caixa".
--
-- RECUSA TAMBÉM O `Aprovado`, e não só a reprova: o problema da reprova é o mais grave (a caixa
-- desaparece do estoque), mas QUALQUER registro de NQA gravado depois da entrada passa a ser o
-- último bipe das N peças, e é isso que tranca o "Cancelar a caixa inteira" e o "Cancelar
-- lançamento" com `NAO_E_ULTIMO`. Aprovar uma caixa que já está no estoque não conserta nada e
-- fecha o caminho de volta do gestor.
--
-- ONDE NA ORDEM DAS GUARDAS: logo depois de `CAIXA_VAZIA`, ANTES das validações da amostra
-- ((a) amostra fora da caixa, (b) amostras insuficientes, (c)/(d) coerência do resultado). As
-- validações da amostra falam do FORMULÁRIO — o inspetor corrige o que preencheu e reenvia. Esta
-- fala do ESTADO da caixa: nenhuma amostra a mais faz a inspeção ser aceita, e a solução está em
-- OUTRA tela. Vindo antes, o inspetor não perde bipe nenhum inspecionando peça pra ouvir o "não"
-- depois; e é a única recusa desta função que manda o inspetor chamar o gestor.
--
-- FORMA DO RETORNO: `raise exception` com um código seco, o molde de todas as outras recusas desta
-- função (`CAIXA_VAZIA`, `CAIXA_JA_INSPECIONADA`, ...), e não o `ok:false + motivo/detalhe` da 0129.
-- Dois motivos: o contrato da sf_nqa_caixa é por exceção e quem a chama
-- (`nqa-caixa-actions.ts:111-129`) só olha `error.message` — um retorno com `ok:false` seria lido
-- como SUCESSO pela tela; e trocar a forma do retorno seria uma TERCEIRA diferença declarada em
-- relação à 0100. A frase que o inspetor lê (o que aconteceu + o que fazer) mora no `case` da
-- action, junto com as das outras recusas.
-- =============================================================
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
