-- =============================================================
-- 0165: Almoxarifado e fila do Compels contam PLACAS (placas por painel).
--
-- Um bipe de painel vale N placas (sf_ordens.placas_por_painel, gravado em sf_registros.pecas pelo
-- trigger da 0161). As linhas que o Almoxarifado copia (caixa, peça avulsa, lote) nascem passando pelo
-- trigger, que resolve `pecas` pela OP da linha nova.
--
-- Regra única de contagem (a mesma da 0162/0163/0164): uma linha de sf_registros NÃO é um bipe (defeito,
-- reparo, rebipe e reteste repetem o SN). Onde se contava PEÇAS DISTINTAS (count(distinct sn)) passa a
-- somar `pecas` UMA vez por SN (distinct on (numero_serie_norm), a linha mais recente, sobre o MESMO
-- from/where de antes). Onde a quantidade vinha de `get diagnostics row_count` (inserts/deletes de linhas
-- do Almoxarifado, uma por SN por construção) passa a ser a soma dos `pecas` das linhas inseridas/
-- removidas (`returning pecas`). Com N = 1 o resultado é IDÊNTICO ao de antes.
--
-- PAINÉIS × PLACAS no LOTE do NQA individual: o lote continua sendo confirmado bipando TODOS os SNs
-- (painéis). O que é cardinalidade de bipe continua em painéis: o tamanho do lote pra conferência
-- (`amostra`, `bipados`, `faltam`, o `pecas` da recusa lote_incompleto e o N do rótulo
-- LOTE[<hex>][<N>], que é a identidade/alvo do envio). O que é QUANTIDADE passa a placas: `pecas` e
-- `ja_lancadas` da lista, a `quantidade` do envio ao Compels e do retorno, o retorno do cancelamento.
--
-- O NQA (sf_nqa_caixa, sf_nqa_individual) NÃO é tocado aqui: a amostra por placas ou por painéis é
-- decisão pendente (Task 4B). sf_almox_caixa_pendentes e sf_estoque_reverter não mudam (os chamadores
-- passam a quantidade certa).
--
-- Copia das definições vigentes, trocando só a contagem (assinaturas, retornos, recusas, travas,
-- tem_permissao e grants iguais):
--   sf_almox_necessidades (0155) · sf_almoxarifado_entrada (0156) · sf_cancelar_lancamento (0156) ·
--   sf_almox_lotes (0156) · sf_almoxarifado_lote (0156) · sf_cancelar_lote_almoxarifado (0156) ·
--   sf_cancelar_caixa_almoxarifado (0131) · sf_almox_pendencias (0158) · sf_almox_detalhe (0159).
-- Trechos trocados marcados com "0165".
--
-- Corpo com $func$ (o SQL Editor do Supabase não aceita dois cifrões). Aditiva e idempotente:
-- create or replace + revoke/grant. Depende da 0161 (sf_registros.pecas).
-- =============================================================


-- ---------- a lista de necessidades (vigente: 0155) ----------
-- Ver o cabeçalho. `pecas` = PLACAS da caixa na Embalagem (0165: `pecas` uma vez por SN; o número que
-- a entrada vai gravar). `c.pecas > 0` continua sendo "a caixa tem algum SN".
-- O código de caixa não é único por construção (dois postos de embalagem podem chegar ao mesmo
-- seq/qtd): como na entrada, vale a primeira em (posto, seq) — e a caixa aparece UMA vez.
create or replace function public.sf_almox_necessidades(p_pmo text, p_op text)
returns table (codigo text, seq int, pecas int, fechada_em timestamptz)
language plpgsql stable
security definer
set search_path = public
as $func$
declare
  v_ordem record;
  v_almox text;
  v_prev  record;
begin
  -- Os dois gates, de DOIS argumentos: quem dá entrada (recebimento.lancar) e quem lê o ShopFloor.
  if not (tem_permissao('recebimento','lancar') and tem_permissao('shopfloor','visualizar')) then
    raise exception 'SEM_PERMISSAO';
  end if;

  select o.id, o.embalagem_individual into v_ordem
    from sf_ordens o where o.pmo = p_pmo and o.op = p_op;
  -- OP inexistente ou de embalagem individual (a unidade é a peça, não há caixa pra confirmar).
  if not found or v_ordem.embalagem_individual then
    return;
  end if;

  -- O posto Almoxarifado DA ROTA desta OP, pelo perfil (nunca pelo nome). Só pode haver um (o
  -- Cadastrar Posto recusa o segundo); se houver mais de um, vale o primeiro da rota.
  select opp.posto into v_almox
    from sf_ordem_postos opp
    join sf_postos po       on po.chave = opp.posto
    join sf_posto_perfis pe on pe.chave = po.perfil
   where opp.ordem_id = v_ordem.id and pe.recurso = 'almoxarifado'
   order by opp.ordem, opp.posto
   limit 1;
  if v_almox is null then
    return;
  end if;

  select * into v_prev from sf_almox_posto_anterior(v_ordem.id, v_almox);

  return query
  select c.codigo, c.seq, c.pecas, c.fechada_em
    from (
      select distinct on (cx.codigo) cx.codigo, cx.seq, cx.posto, cx.fechada_em,
             -- 0165: placas = `pecas` UMA vez por SN (a linha mais recente), não count(distinct).
             (select coalesce(sum(u.pecas), 0)::int
                from (select distinct on (r.numero_serie_norm) r.numero_serie_norm, r.pecas
                        from sf_registros r
                       where r.pmo = p_pmo and r.op = p_op and r.posto = cx.posto
                         and r.numero_caixa = cx.codigo and r.numero_serie_norm <> ''
                       order by r.numero_serie_norm, r.data_hora desc, r.created_at desc) u) as pecas
        from sf_caixas cx
       where cx.pmo = p_pmo and cx.op = p_op
         and cx.fechada and cx.revisao = 0
         and cx.codigo <> '' and cx.codigo !~ '^CX\[[0-9]+\]R[0-9]*\['
       order by cx.codigo, cx.posto, cx.seq
    ) c
   where c.pecas > 0
     and not exists (
       select 1 from sf_registros a
        where a.pmo = p_pmo and a.op = p_op and a.posto = v_almox and a.numero_caixa = c.codigo
     )
     and (v_prev.posto is null
          or sf_almox_caixa_pendentes(p_pmo, p_op, c.posto, c.codigo,
                                      v_prev.posto, v_prev.recurso, v_prev.precisa_aprovado) = 0)
   order by c.seq, c.codigo;
end $func$;

-- ---------- a entrada (vigente: 0156) ----------
-- p_serie_norm vem PRONTO do aplicativo (vazio quando p_tipo = 'caixa'). Não existe função de
-- normalização de série no banco — o sf_lancar também recebe p_numero_serie_norm de fora. Se esta
-- RPC normalizasse por conta própria, a comparação de duplicidade não casaria com as linhas que a
-- Embalagem gravou e o "já lançado" nunca pegaria nada.
create or replace function public.sf_almoxarifado_entrada(
  p_pmo         text,
  p_op          text,
  p_posto       text,
  p_colaborador text,
  p_bipe        text,   -- como veio do coletor: série da peça ou código da caixa
  p_tipo        text,   -- 'caixa' | 'serie' (decidido por classificarBipeAlmoxarifado)
  -- p_quantidade não é mais LIDO por esta função: a quantidade passou a ser a soma das PLACAS das
  -- linhas gravadas (uma linha por SN/painel; 0165). Continua na assinatura de propósito — tirá-lo obrigaria a `drop
  -- function` + regrant (deixa de ser uma migração aditiva) e a mexer no chamador em TS, sem ganho
  -- nenhum. Se um dia a assinatura mudar por outro motivo, ele sai junto.
  p_quantidade  int,    -- o que o domínio contou; mantido só pela assinatura
  p_serie_norm  text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_ordem      record;
  v_caixa      record;
  v_id         uuid;
  v_ja         record;
  v_na_faixa   boolean;
  v_quantidade int;
  v_pecas      int;
  v_lancadas   int;
  v_qtd_codigo int;
  -- O que vai pra fila de envio ao ERP (ver "A FILA", no fim da função). São definidos dentro de cada
  -- caminho porque a identidade do bipe é diferente nos dois: a caixa é identificada pelo código, a
  -- peça pela série NORMALIZADA.
  v_tipo       text;
  v_serie_fila text;
  v_alvo       text;
  -- 0155: o posto anterior ao Almoxarifado na rota, e quantas peças da caixa faltam nele.
  v_prev       record;
  v_prev_falta int;
  -- 0165: as placas que faltam no posto anterior (v_prev_falta continua sendo SNs: é o `= 0` da
  -- sf_almox_caixa_pendentes, que não muda).
  v_falta_placas int;
begin
  if not tem_permissao('recebimento','lancar') then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  -- `id` entra no select por causa da checagem de posto-na-OP mais abaixo: sf_ordem_postos é ligada
  -- por ordem_id (é assim que TODO o resto do ShopFloor pergunta quais são os postos de uma OP —
  -- fluxo-repository, lancamento-repository, pesquisa-repository), e não pelo par (pmo, op).
  select id, cliente, sn_ini, sn_fim, embalagem_individual into v_ordem
    from sf_ordens where pmo = p_pmo and op = p_op;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'ordem_nao_encontrada',
      'detalhe', 'Ordem ' || p_pmo || ' / ' || p_op || ' não cadastrada.');
  end if;

  -- Mesmo cruzamento de classificarBipeAlmoxarifado, mas contra o DADO atual da OP (a flag pode ter
  -- mudado depois que a Embalagem já rodou sob a classificação antiga — ver o comentário do topo).
  if p_tipo = 'caixa' and v_ordem.embalagem_individual then
    return jsonb_build_object('ok', false, 'motivo', 'caixa_em_op_individual',
      'detalhe', 'Nesta OP a entrada é por peça. Bipe o Nº de Série.');
  end if;
  if p_tipo = 'serie' and not v_ordem.embalagem_individual then
    return jsonb_build_object('ok', false, 'motivo', 'serie_em_op_coletiva',
      'detalhe', 'Nesta OP a entrada é por caixa. Bipe o código da caixa.');
  end if;

  -- O posto é conferido pelo PERFIL, nunca pelo nome: quem cadastra posto escolhe o perfil, e é o
  -- recurso 'almoxarifado' que diz que aquele posto dá entrada em estoque.
  if not exists (
    select 1 from sf_postos po
      join sf_posto_perfis pe on pe.chave = po.perfil
     where po.chave = p_posto and pe.recurso = 'almoxarifado'
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'posto_invalido',
      'detalhe', 'O posto "' || p_posto || '" não é um posto de Almoxarifado.');
  end if;

  -- O POSTO TEM QUE SER UM DOS POSTOS DESTA OP. A recusa mais importante que faltava: sem ela o bipe
  -- num posto fora do fluxo da OP voltava `ok`, o operador lia "3 peças" — e para o Fluxo e o
  -- Dashboard aquelas linhas NÃO EXISTIAM. postoPendenteDePeca (fluxo-op.ts) descarta todo registro
  -- de posto fora do fluxo da OP (`doFluxo.has(p) || p === manut`) e sf_fluxo_op (0094) só monta nó
  -- pros postos da OP, então as peças ficavam como trabalho em processo na Embalagem e "Concluído"
  -- ficava 0 pra sempre, sem erro nenhum na tela.
  --
  -- Pelo ordem_id, que é o caminho que o resto do ShopFloor usa (sf_ordem_postos só se liga à OP por
  -- ele) e a MESMA grafia: sf_ordem_postos.posto referencia sf_postos(chave), e p_posto é uma chave.
  --
  -- POR QUE AQUI, e não antes nem depois: as duas checagens de posto ficam juntas, da mais geral pra
  -- mais específica. Primeiro "este posto existe e dá entrada em estoque?" (problema de Cadastrar
  -- Posto), depois "este posto está nesta OP?" (problema de Cadastrar OP) — a ordem importa porque a
  -- frase daqui manda acrescentar o posto na OP, e mandar isso para um posto que não existe seria
  -- mandar o gestor cadastrar coisa errada. E as duas vêm ANTES da trava e de qualquer leitura de
  -- caixa, faixa ou duplicidade, porque nenhuma delas depende do que foi bipado: quando a OP não tem
  -- o posto, NENHUM bipe dela vai entrar, e fazer o operador esperar numa trava para descobrir
  -- "caixa não encontrada" seria mandá-lo procurar a caixa errada. É também a recusa mais provável na
  -- estreia do posto: toda OP cadastrada antes de ele existir está exatamente neste estado.
  if not exists (
    select 1 from sf_ordem_postos opp
     where opp.ordem_id = v_ordem.id and opp.posto = p_posto
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'posto_fora_da_op',
      'detalhe', 'O posto "' || p_posto || '" não está nos postos da OP ' || p_op
        || '. Acrescente o posto na OP em Cadastrar OP e bipe outra vez.');
  end if;

  -- CORRIDA, parte 1: serializa o MESMO bipe no mesmo posto da mesma OP. É esta trava que faz a
  -- checagem de duplicidade abaixo valer, porque não existe unique em sf_registros que sirva:
  -- a Embalagem grava N linhas com o mesmo numero_caixa (uma por peça) e a reprova grava N linhas
  -- com a mesma série (uma por defeito), então qualquer unicidade ampla quebraria os outros postos.
  -- A chave é a mesma coisa que a checagem de duplicidade compara (e não a OP): dois operadores
  -- bipando caixas/peças DIFERENTES não se esperam.
  --
  -- Por isso a chave é coalesce(p_serie_norm, p_bipe), e não p_bipe cru: no caminho da peça, quem
  -- decide duplicidade é numero_serie_norm (abaixo), que já tirou zero à esquerda e caixa. Um
  -- coletor com "tecla presa" (um zero a mais) ou um bipe em minúsculas dão p_bipe DIFERENTE para
  -- a MESMA peça — travar pelo bipe cru deixaria as duas sessões passarem direto, sem se esperar,
  -- e a peça entraria duas vezes (achado de revisão; o teste de corrida da série normalizada, no
  -- script, prova isso). No caminho da caixa p_serie_norm vem vazio, então a chave cai no próprio
  -- p_bipe (o código da caixa), que é exatamente o que a checagem de duplicidade da caixa compara.
  perform pg_advisory_xact_lock(
    hashtext('sf_almox/' || p_pmo || '/' || p_op || '/' || p_posto || '/'
             || coalesce(nullif(p_serie_norm, ''), p_bipe))::bigint);

  if p_tipo = 'caixa' then
    -- A marca de remontagem é lida ANTES de procurar a caixa: o R no código já diz que aquela
    -- etiqueta é de uma montagem aposentada, e essa resposta é verdadeira mesmo que a linha não
    -- seja encontrada — mandar o operador procurar uma "caixa não encontrada" seria pista falsa.
    if p_bipe ~ '^CX\[[0-9]+\]R[0-9]*\[' then
      return jsonb_build_object('ok', false, 'motivo', 'caixa_reprovada',
        'detalhe', 'Esta etiqueta é de uma caixa reprovada no NQA; a caixa vai ser remontada.');
    end if;

    -- A caixa é achada pelo código, que não é único por construção (dois postos de embalagem da
    -- mesma OP podem chegar ao mesmo seq/qtd): pega a primeira em ordem estável. Qualquer uma serve,
    -- porque a duplicidade é conferida pelo próprio código no posto do almoxarifado.
    select id into v_id from sf_caixas
     where pmo = p_pmo and op = p_op and codigo = p_bipe
     order by posto, seq
     limit 1;
    if v_id is null then
      return jsonb_build_object('ok', false, 'motivo', 'caixa_nao_encontrada',
        'detalhe', 'Nenhuma caixa da OP ' || p_op || ' com o código ' || p_bipe || '.');
    end if;

    -- CORRIDA, parte 2: trava a LINHA da caixa e relê o estado DEPOIS da trava. Entre o select de
    -- cima e a gravação, o NQA pode reprovar a caixa (0100) ou um cancelamento pode reabri-la
    -- (0106); sem esta releitura a entrada seria dada com base num estado que já mudou.
    -- A trava vem pelo id (e não pelo código) justamente porque o código é o que essas duas
    -- operações reescrevem — filtrar pelo código depois do bloqueio devolveria "não encontrada".
    select * into v_caixa from sf_caixas where id = v_id for update;
    -- Hoje é inalcançável (nada apaga caixa; a reabertura só limpa o código), mas sem este `if not
    -- found` a linha sumindo entre os dois selects faria `not v_caixa.fechada` e `v_caixa.revisao >
    -- 0` avaliarem NULL (falso nos dois), e a função continuaria e daria a entrada sem caixa nenhuma
    -- por trás. Fechando aqui em vez de confiar no NULL.
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'caixa_nao_encontrada',
        'detalhe', 'Nenhuma caixa da OP ' || p_op || ' com o código ' || p_bipe || '.');
    end if;

    if not v_caixa.fechada then
      return jsonb_build_object('ok', false, 'motivo', 'caixa_aberta',
        'detalhe', 'A caixa ' || v_caixa.seq || ' ainda está aberta na Embalagem.');
    end if;
    -- Revisão na linha travada, com o código bipado ainda SEM o R: é o estado da corrida em que o
    -- NQA reprovou a caixa depois que este bipe já a tinha achado (a 0100 troca revisao e código
    -- juntos, então quem bipou pegou o código de antes).
    if v_caixa.revisao > 0 then
      return jsonb_build_object('ok', false, 'motivo', 'caixa_reprovada',
        'detalhe', 'A caixa ' || v_caixa.seq || ' foi reprovada no NQA e vai ser remontada.');
    end if;

    -- Duplicidade da caixa: continua sendo pelo CÓDIGO (numero_caixa), e não peça por peça, mesmo
    -- agora que cada linha gravada leva a série. A unidade do bipe é a caixa: ou a caixa inteira
    -- entrou ou não entrou. É isso que torna a recusa previsível no caso torto de a caixa ganhar
    -- uma peça DEPOIS da entrada (não deveria acontecer: só uma reabertura na Embalagem carimbaria
    -- outra peça com este código, e reabrir apaga o código) — o rebipe é recusado por INTEIRO, com
    -- quando e por quem, em vez de entrar "só a peça que faltava" e devolver 1 peça pra uma caixa
    -- de 14, que é o número que o operador levaria pra contagem. Sobrou peça de verdade? O gestor
    -- cancela a caixa inteira (Cancelar a caixa inteira, 0131 — um gesto, um motivo) e bipa outra vez.
    select data_hora, colaborador into v_ja
      from sf_registros
     where pmo = p_pmo and op = p_op and posto = p_posto and numero_caixa = p_bipe
     order by data_hora
     limit 1;
    if found then
      -- A recusa DIZ QUANTAS DAS N PEÇAS ESTÃO LANÇADAS. Antes ela dizia só "já lançada", e ponto:
      -- num estado PARCIAL — a caixa entrou inteira e depois alguém cancelou linha por linha (0087) e
      -- parou no meio — o gestor lia a mesma frase de sempre e não tinha como saber que a caixa estava
      -- meio dentro, meio fora. Com "3 de 14", ele vê o que está olhando e sabe o que fazer: cancelar
      -- a caixa inteira (0131) e bipar de novo. A recusa em si não muda (a unidade do bipe é a caixa),
      -- muda o que ela conta.
      --
      -- Lançadas = séries distintas DESTA caixa já gravadas NESTE posto. Total = as peças da caixa,
      -- contadas no POSTO DA EMBALAGEM (v_caixa.posto), que é a fonte da verdade da qual a etiqueta
      -- foi impressa — a mesma contagem que o insert usa mais abaixo.
      -- 0165: as duas em PLACAS (`pecas` uma vez por SN, a linha mais recente), como a etiqueta.
      select coalesce(sum(u.pecas), 0) into v_lancadas
        from (select distinct on (numero_serie_norm) numero_serie_norm, pecas
                from sf_registros
               where pmo = p_pmo and op = p_op and posto = p_posto
                 and numero_caixa = p_bipe and numero_serie_norm <> ''
               order by numero_serie_norm, data_hora desc, created_at desc) u;
      select coalesce(sum(u.pecas), 0) into v_pecas
        from (select distinct on (numero_serie_norm) numero_serie_norm, pecas
                from sf_registros
               where pmo = p_pmo and op = p_op and posto = v_caixa.posto
                 and numero_caixa = p_bipe and numero_serie_norm <> ''
               order by numero_serie_norm, data_hora desc, created_at desc) u;
      return jsonb_build_object('ok', false, 'motivo', 'ja_lancado',
        'detalhe', 'Caixa já lançada em '
          || to_char(v_ja.data_hora at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
          || case when v_ja.colaborador = '' then '' else ' por ' || v_ja.colaborador end || '. '
          -- v_pecas = 0: as linhas da Embalagem já foram canceladas, então não há N com que comparar.
          -- Dizer "3 de 0" seria pior que não dizer o total — sobra a contagem do que está lançado.
          -- O plural de "peça" segue o TOTAL ("1 de 14 peças"); o do verbo segue o que está lançado.
          || case when v_pecas = 0 then v_lancadas::text
                  else v_lancadas || ' de ' || v_pecas end
          || case when greatest(v_pecas, v_lancadas) = 1 then ' peça' else ' peças' end
          || ' desta caixa '
          || case when v_lancadas = 1 then 'está lançada.' else 'estão lançadas.' end
          -- O estado parcial é o que precisava de saída: diz onde é o caminho de volta.
          || case when v_pecas > 0 and v_lancadas < v_pecas
                  then ' Um cancelamento anterior parou no meio: cancele a caixa inteira em Registros e bipe outra vez.'
                  else '' end);
    end if;

    -- AS PEÇAS DA CAIXA — de onde sai a lista: quando a caixa fecha, sf_fechar_caixa (0100)
    -- REESCREVE o numero_caixa das linhas das peças, trocando o marcador CX[seq] pelo código final.
    -- Então as peças de CX[3][14]8498-PMOC14 estão em sf_registros no POSTO DA EMBALAGEM, com esse
    -- código em numero_caixa e a série de cada uma. É a fonte da verdade: a etiqueta física foi
    -- impressa a partir daí.
    --
    -- O filtro é pelo posto da caixa (v_caixa.posto), e não por qualquer posto: o código não é único
    -- por construção (dois postos de embalagem da mesma OP podem chegar ao mesmo seq/qtd), e é esta
    -- linha de caixa, achada logo acima, que diz de quem são as peças.
    -- 0165: em PLACAS (`pecas` uma vez por SN). `= 0` continua sendo "nenhum SN na caixa".
    select coalesce(sum(u.pecas), 0) into v_pecas
      from (select distinct on (numero_serie_norm) numero_serie_norm, pecas
              from sf_registros
             where pmo = p_pmo and op = p_op and posto = v_caixa.posto
               and numero_caixa = p_bipe and numero_serie_norm <> ''
             order by numero_serie_norm, data_hora desc, created_at desc) u;
    if v_pecas = 0 then
      return jsonb_build_object('ok', false, 'motivo', 'caixa_sem_pecas',
        'detalhe', 'A caixa ' || v_caixa.seq || ' não tem nenhuma peça registrada na Embalagem.');
    end if;

    -- 0155: O POSTO ANTERIOR TEM QUE TER CONCLUÍDO A CAIXA (ver o cabeçalho da 0155). Depois de todas
    -- as recusas de antes, pra nenhuma delas mudar de motivo, e antes da gravação. Anterior Embalagem →
    -- a caixa fechada basta; qualquer outro → todas as peças da caixa concluídas nele.
    select * into v_prev from sf_almox_posto_anterior(v_ordem.id, p_posto);
    if v_prev.posto is not null then
      v_prev_falta := sf_almox_caixa_pendentes(p_pmo, p_op, v_caixa.posto, p_bipe,
                                               v_prev.posto, v_prev.recurso, v_prev.precisa_aprovado);
      if v_prev_falta > 0 then
        -- 0165: `faltam` em PLACAS, pra casar com `pecas` (placas) na frase "X de Y peças". Os SNs que
        -- faltam são os mesmos que a sf_almox_caixa_pendentes contou (mesmo from/where, mesmo
        -- sf_almox_peca_concluida); só a soma passa a ser de `pecas`, uma vez por SN.
        select coalesce(sum(u.pecas), 0) into v_falta_placas
          from (select distinct on (numero_serie_norm) numero_serie_norm, pecas
                  from sf_registros
                 where pmo = p_pmo and op = p_op and posto = v_caixa.posto
                   and numero_caixa = p_bipe and numero_serie_norm <> ''
                 order by numero_serie_norm, data_hora desc, created_at desc) u
         where not sf_almox_peca_concluida(p_pmo, p_op, u.numero_serie_norm, v_prev.posto,
                                           v_prev.precisa_aprovado);
        return jsonb_build_object('ok', false, 'motivo', 'posto_anterior_nao_concluido',
          'posto_anterior', v_prev.posto, 'precisa_aprovado', v_prev.precisa_aprovado,
          'faltam', v_falta_placas, 'pecas', v_pecas,
          'detalhe', 'A caixa ' || v_caixa.seq || ' ainda não foi concluída no posto anterior ('
            || v_prev.posto || '): ' || v_falta_placas || ' de ' || v_pecas
            || case when v_pecas = 1 then ' peça' else ' peças' end
            || case when v_prev.precisa_aprovado
                    then ' sem aprovação.' else ' sem registro.' end);
      end if;
    end if;

    -- A quantidade impressa na ETIQUETA, lida do próprio código bipado. Ela deveria ser igual à
    -- contagem real, porque sf_fechar_caixa calculou o código a partir de
    -- count(distinct numero_serie_norm) dessas mesmas linhas (0163: em PLACAS, `pecas` uma vez por SN —
    -- e v_quantidade, abaixo, também é em placas). Quando divergirem, quem manda é a
    -- PEÇA, não o número do código: cada linha gravada aqui precisa de uma série de verdade — não há
    -- como inventar a 15ª série porque a etiqueta diz 15, nem faz sentido deixar a 15ª peça embalada
    -- fora do estoque porque a etiqueta diz 14 (ela sumiria do Fluxo e a OP nunca concluiria, que é
    -- exatamente o defeito que esta correção resolve). A conferência em si fica DEPOIS do insert,
    -- contra o que realmente entrou.
    v_qtd_codigo := nullif(substring(p_bipe from '^CX\[[0-9]+\](?:R[0-9]*)?\[([0-9]+)\]'), '')::int;

    -- UMA LINHA POR PEÇA. A série vai nos DOIS formatos que a Embalagem já gravou (numero_serie cru
    -- e numero_serie_norm), copiados da linha dela: se esta função normalizasse por conta própria,
    -- ou gravasse o código da caixa no lugar da série, a mesma peça apareceria de duas formas
    -- diferentes na Pesquisa e no Fluxo. numero_caixa leva o código da caixa, que é o que amarra as
    -- 14 linhas ao mesmo bipe (e o que a checagem de duplicidade acima compara).
    -- distinct on: uma peça bipada duas vezes na mesma caixa é uma peça só — a mesma regra que
    -- sf_fechar_caixa usou pra contar. A ordem (data_hora, numero_serie) é só pra escolher sempre a
    -- MESMA forma crua quando a peça tem mais de uma linha na Embalagem.
    -- 0165: a quantidade é a soma das PLACAS das linhas inseridas (`returning pecas`: o trigger da
    -- 0161 já resolveu `pecas` pela OP), e não mais o row_count. Uma linha por SN, então com N = 1 é
    -- o mesmo número de antes; zero placas continua sendo zero linhas (pecas >= 1).
    with ins as (
      insert into public.sf_registros
        (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
      select p_colaborador, p_posto, p_pmo, p_op, v_ordem.cliente, p_bipe, pc.numero_serie, pc.numero_serie_norm
        from (
          select distinct on (numero_serie_norm) numero_serie_norm, numero_serie
            from sf_registros
           where pmo = p_pmo and op = p_op and posto = v_caixa.posto
             and numero_caixa = p_bipe and numero_serie_norm <> ''
           order by numero_serie_norm, data_hora, numero_serie
        ) pc
      returning pecas
    )
    select coalesce(sum(pecas), 0) into v_quantidade from ins;

    -- GRAVOU ZERO? Então a recusa `caixa_sem_pecas` acima foi contada num snapshot que já morreu.
    -- A contagem e o insert são statements SEPARADOS e, em READ COMMITTED, cada um vê o banco no
    -- instante em que começa: se entre os dois um cancelamento de embalagem (0106) comitar e REABRIR
    -- a caixa — o que reescreve o numero_caixa das peças de volta pro marcador CX[seq] —, o
    -- insert ... select não acha mais nada. Sem esta linha a função devolveria ok com quantidade 0, o
    -- operador leria "0 peças" e a caixa ficaria fora do estoque em silêncio: exatamente o defeito
    -- que a recusa existe pra matar. As duas travas não se serializam (a 0106 trava por
    -- (OP, posto de embalagem), esta por (OP, posto de almoxarifado, bipe)), então a janela é real.
    if v_quantidade = 0 then
      return jsonb_build_object('ok', false, 'motivo', 'caixa_sem_pecas',
        'detalhe', 'A caixa ' || v_caixa.seq || ' não tem nenhuma peça registrada na Embalagem.');
    end if;

    -- A conferência da etiqueta, agora contra o que REALMENTE entrou. Divergir só é possível se
    -- alguém mexeu nos dados depois do fechamento (cancelamento de lançamento, correção manual por
    -- SQL) — e aí é a etiqueta que está velha. A entrada NÃO é barrada: barrar deixaria a caixa
    -- física sem entrada nenhuma, que é pior que entrar com o número certo. O aviso em log continua
    -- (serve pra investigar depois), mas ele não é mais o único canal: quem precisa saber é o
    -- operador, e a divergência volta no JSON, em `qtd_etiqueta`, pro painel dizer as duas
    -- quantidades. Warning em chamada via PostgREST é engolido pelo supabase-js e só sobra no log do
    -- Postgres, que ninguém lê — a caixa física de 14 entrando como 13 ficaria muda, e a 14ª peça
    -- ficaria como trabalho em processo na Embalagem pra sempre, sem a OP nunca concluir.
    if v_qtd_codigo is not null and v_qtd_codigo <> v_quantidade then
      raise warning 'sf_almoxarifado_entrada: caixa % com % peças registradas, etiqueta diz %',
        p_bipe, v_quantidade, v_qtd_codigo;
    end if;

    -- A identidade deste bipe pra fila: a CAIXA. serie_norm vai vazio de propósito (mesmo que o
    -- chamador tenha mandado algo em p_serie_norm), porque é o código da caixa que a duplicidade
    -- acima e o cancelamento (0131) comparam — e é dele que o `alvo` da fila é derivado.
    v_tipo := 'caixa'; v_serie_fila := ''; v_alvo := p_bipe;

  else
    -- Qualquer coisa que não seja 'caixa' é tratada como série: o domínio só emite os dois valores,
    -- e inventar um motivo de recusa fora da spec só pra um p_tipo impossível não ajudaria a tela.
    v_na_faixa := sf_sn_na_faixa(v_ordem.sn_ini, v_ordem.sn_fim, p_bipe);
    -- null = OP sem faixa cadastrada: não há como julgar a série, quem manda é a Embalagem (abaixo).
    if v_na_faixa is false then
      return jsonb_build_object('ok', false, 'motivo', 'serie_fora_da_faixa',
        'detalhe', 'A série ' || p_bipe || ' está fora da faixa da OP ('
          || v_ordem.sn_ini || ' a ' || v_ordem.sn_fim || ').');
    end if;

    -- Passou pela Embalagem = tem registro num posto de perfil com recurso 'caixa'. Serve pros dois
    -- jeitos de embalar: na coletiva o registro sai com o marcador/código da caixa, na individual
    -- com o próprio SN no numero_caixa — o que importa é o posto, não a caixa.
    if not exists (
      select 1 from sf_registros r
        join sf_postos po        on po.chave = r.posto
        join sf_posto_perfis pe  on pe.chave = po.perfil
       where r.pmo = p_pmo and r.op = p_op and r.numero_serie_norm = p_serie_norm
         and pe.recurso = 'caixa'
         -- Série normalizada vazia (chamada fora do fluxo da tela) não pode casar com linha nenhuma:
         -- sem série não há peça, e `= ''` casaria com qualquer registro que a Embalagem tenha
         -- gravado sem série. Este posto já não grava mais linha sem série (o bipe de caixa virou
         -- uma linha por peça), mas o histórico gravado antes desta correção continua no banco.
         and r.numero_serie_norm <> ''
    ) then
      return jsonb_build_object('ok', false, 'motivo', 'serie_sem_embalagem',
        'detalhe', 'A peça ' || p_bipe || ' não tem registro na Embalagem.');
    end if;

    select data_hora, colaborador into v_ja
      from sf_registros
     where pmo = p_pmo and op = p_op and posto = p_posto and numero_serie_norm = p_serie_norm
     order by data_hora
     limit 1;
    if found then
      return jsonb_build_object('ok', false, 'motivo', 'ja_lancado',
        'detalhe', 'Peça já lançada em '
          || to_char(v_ja.data_hora at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
          || case when v_ja.colaborador = '' then '' else ' por ' || v_ja.colaborador end || '.');
    end if;

    -- 0155: O POSTO ANTERIOR TEM QUE TER CONCLUÍDO A PEÇA (ver o cabeçalho da 0155), pela regra do
    -- gate do perfil dele — a mesma trava de sequência do sf_lancar. Depois de todas as recusas de
    -- antes (faixa, Embalagem, ja_lancado), pra nenhuma delas mudar de motivo.
    select * into v_prev from sf_almox_posto_anterior(v_ordem.id, p_posto);
    if v_prev.posto is not null
       and not sf_almox_peca_concluida(p_pmo, p_op, p_serie_norm, v_prev.posto, v_prev.precisa_aprovado) then
      return jsonb_build_object('ok', false, 'motivo', 'posto_anterior_nao_concluido',
        'posto_anterior', v_prev.posto, 'precisa_aprovado', v_prev.precisa_aprovado,
        'detalhe', 'A peça ' || p_bipe
          || case when v_prev.precisa_aprovado
                  then ' ainda não foi aprovada no posto anterior ('
                  else ' ainda não tem registro no posto anterior (' end
          || v_prev.posto || ').');
    end if;
    -- 0156: PEÇA DE LOTE DO NQA NÃO ENTRA AVULSA (ver o cabeçalho da 0156, regra 8). Na OP individual
    -- cujo posto anterior é de perfil NQA, a entrada é pelo LOTE aprovado (sf_almoxarifado_lote): uma
    -- linha no Compels por lote. Depois de TODAS as recusas de antes — inclusive a da 0155, então a peça
    -- não aprovada no NQA continua ouvindo posto_anterior_nao_concluido — e antes da gravação.
    if v_ordem.embalagem_individual and v_prev.posto is not null and v_prev.recurso = 'nqa' then
      return jsonb_build_object('ok', false, 'motivo', 'serie_exige_lote',
        'posto_anterior', v_prev.posto,
        'detalhe', 'Esta peça faz parte de um lote do NQA: confirme o lote inteiro.');
    end if;

    -- A peça: uma linha, como a Embalagem e o Teste gravam. `status` fica vazio — o perfil não tem
    -- status, o bipe não julga a peça. numero_caixa fica vazio: não existe caixa neste caminho.
    -- 0165: a quantidade é o PESO do bipe, sf_registros.pecas (0161: placas por painel da OP, posto
    -- pelo trigger). Um bipe = uma linha = um painel = `pecas` placas; com N = 1 continua 1. Aqui e no
    -- caminho da caixa a quantidade é a soma de `pecas` das linhas gravadas, nunca contagem de linha.
    insert into public.sf_registros
      (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
    values
      (p_colaborador, p_posto, p_pmo, p_op, v_ordem.cliente, '', p_bipe, p_serie_norm)
    returning pecas into v_quantidade;
    -- A identidade deste bipe pra fila: a SÉRIE NORMALIZADA, nunca o bipe cru. É a mesma escolha da
    -- trava e da checagem de duplicidade logo acima: um zero à esquerda a mais no coletor, ou
    -- minúsculas, dão bipes crus diferentes pra MESMA peça — pelo cru, ela geraria duas chaves de
    -- idempotência e entraria duas vezes no ERP. Aqui p_serie_norm é garantidamente não vazia: série
    -- vazia não casa com registro da Embalagem e já saiu por `serie_sem_embalagem`.
    v_tipo := 'serie'; v_serie_fila := p_serie_norm; v_alvo := p_serie_norm;
  end if;

  -- ---------- A FILA DE ENVIO AO ERP (Fase 2) ----------
  -- NA MESMA TRANSAÇÃO em que os registros foram gravados, e não depois, pelo motivo de sempre: se o
  -- insert dos registros vingasse e o da fila não, a peça estaria no ShopFloor e NUNCA iria pro
  -- Compels, sem ninguém saber — exatamente o erro silencioso que esta integração existe pra não ter.
  -- E vale o contrário também: se este insert falhar, o bipe inteiro é abortado e o operador vê erro,
  -- em vez de a fila receber entrada de peça que não ficou registrada. NÃO envolva isto num
  -- `exception when others` pra "não quebrar o bipe por causa do ERP": é a fila que vira mentira.
  --
  -- UMA LINHA POR BIPE, não uma por peça (o oposto de sf_registros, logo acima). A unidade da fila é
  -- a MOVIMENTAÇÃO de estoque, e a movimentação é o gesto do operador: o ERP recebe "entraram 14
  -- peças da caixa X". Por peça seriam 14 chamadas ao ERP pro mesmo gesto, 14 chances de erro parcial
  -- e uma fila 14 vezes maior — e a chave de idempotência da 0132 é a identidade do BIPE (`alvo`), a
  -- mesma que o cancelamento procura: por peça, nada casaria com ela. Quem precisa das peças uma a
  -- uma é o ShopFloor, e elas estão em sf_registros.
  --
  -- `quantidade` é v_quantidade, as PLACAS das linhas REALMENTE gravadas (0165) — nunca o que a etiqueta
  -- prometia (v_qtd_codigo) nem o que o domínio contou (p_quantidade). Mandar o número da etiqueta
  -- inflaria o estoque do ERP em silêncio quando os dois divergem.
  --
  -- A chave sai da sf_estoque_chave (0132), que conta quantas vezes este bipe já teve esta operação:
  -- o rebipe depois de um cancelamento vira E2, e não bate na chave de ontem. Se ainda assim a chave
  -- repetir, o índice único mata a transação — e é isso que se quer: o mesmo bipe não entra duas vezes.
  insert into public.sf_estoque_envios
    (chave, operacao, pmo, op, posto, tipo, bipe, serie_norm, quantidade)
  values
    (sf_estoque_chave(p_pmo, p_op, p_posto, v_alvo, 'entrada'), 'entrada',
     p_pmo, p_op, p_posto, v_tipo, p_bipe, v_serie_fila, v_quantidade);

  -- O painel mostra este número ao operador ("14 peças" pra uma caixa de 14, "1 peça" pra uma peça),
  -- então ele é a contagem das LINHAS que acabaram de ser gravadas — o que realmente entrou —, e não
  -- o que a etiqueta prometia nem o que o domínio contou em p_quantidade.
  --
  -- `qtd_etiqueta` só aparece quando a etiqueta promete um número DIFERENTE do que entrou: é a
  -- divergência saindo do log e chegando à tela ("14 peças na etiqueta, 13 entraram"). No caminho da
  -- peça v_qtd_codigo é sempre null (não há etiqueta de caixa), então a chave nunca aparece lá.
  if v_qtd_codigo is not null and v_qtd_codigo <> v_quantidade then
    return jsonb_build_object('ok', true, 'quantidade', v_quantidade, 'qtd_etiqueta', v_qtd_codigo);
  end if;
  return jsonb_build_object('ok', true, 'quantidade', v_quantidade);
end $func$;

-- ---------- cancelar lançamento: a linha de lote é recusada (vigente: 0156) ----------
-- Corpo da 0156 (a vigente) COPIADO; 0165 troca só o `1` fixo da reversão na fila pelas placas da
-- linha cancelada. (Na 0156: corpo da 0133 copiado sem mudança, mais o bloco "0156".) Os porquês do LIFO, da auditoria
-- antes do delete, da reabertura de caixa e da reversão na fila estão na 0106 e na 0133.
create or replace function public.sf_cancelar_lancamento(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_pmo text; v_op text; v_snnorm text; v_posto text; v_numero_caixa text;
  v_recurso text; v_ultimo uuid;
  v_cx record;
  v_pecas int;  -- 0165: as placas da linha cancelada (sf_registros.pecas, 0161)
begin
  -- Gate por MÓDULO (2-arg), igual ao podeNoModulo('shopfloor','administrar') da UI/action —
  -- assim quem vê o botão passa na RPC (o 1-arg global divergia do gate da tela).
  if not tem_permissao('shopfloor', 'administrar') then
    raise exception 'SEM_PERMISSAO';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'MOTIVO_OBRIGATORIO';
  end if;

  select pmo, op, numero_serie_norm, posto, coalesce(numero_caixa, ''), pecas
    into v_pmo, v_op, v_snnorm, v_posto, v_numero_caixa, v_pecas
  from public.sf_registros
  where id = p_id;
  if not found then
    raise exception 'NAO_ENCONTRADO';
  end if;
  -- 0156: LINHA DE LOTE NÃO SE CANCELA SOZINHA (ver o cabeçalho da 0156, regra 7). O lote é um gesto: as
  -- N linhas e UM envio. Cancelar uma linha aqui apagaria uma peça sem reverter nada na fila (o alvo
  -- calculado abaixo é o SN, e o envio do lote tem o rótulo como alvo), e o Compels ficaria com uma peça
  -- a mais, calado. Quem desfaz é a sf_cancelar_lote_almoxarifado ("Cancelar o lote inteiro").
  if exists (
    select 1 from public.sf_registros r
      join public.sf_estoque_envios e on e.id = r.envio_id
     where r.id = p_id and e.tipo = 'lote'
  ) then
    raise exception 'CANCELE_O_LOTE';
  end if;

  -- Serializa com o lançamento da mesma OP (o "último bipe" não muda no meio da checagem).
  -- É também o que serializa com a sf_cancelar_caixa_almoxarifado (0131), que pega a MESMA trava
  -- primeiro: dois cancelamentos da mesma OP não calculam a chave do estorno ao mesmo tempo.
  perform pg_advisory_xact_lock(hashtext(v_pmo || '/' || v_op)::bigint);

  -- Escopo: bloqueia postos com efeito colateral em outra tabela (recurso nulo = permitido).
  -- 'caixa' saiu da lista: o efeito colateral em sf_caixas é desfeito aqui embaixo.
  select p.recurso into v_recurso
  from public.sf_postos po
  join public.sf_posto_perfis p on p.chave = po.perfil
  where po.chave = v_posto;
  if v_recurso in ('nqa', 'integracao') then
    raise exception 'POSTO_NAO_CANCELAVEL';
  end if;

  -- Burn-in (sf_burnin, 0069) e embalagem (sf_fechar_caixa, 0070) usam lock POR POSTO; o lock
  -- por-OP acima não serializa com eles. Pega também o lock por-posto pra o cancelamento não correr
  -- junto com um bipe de entrada/saída do burn-in nem com um fechamento de caixa (que reescreveria
  -- os numero_caixa embaixo da gente). Ordem OP→posto sempre (nenhuma função pega posto→OP), então
  -- não há deadlock.
  if v_recurso in ('burnin', 'caixa') then
    perform pg_advisory_xact_lock(hashtext(v_pmo || '/' || v_op || '/' || v_posto)::bigint);
  end if;

  -- Almoxarifado: a MESMA trava por bipe que a 0129 e a 0131 usam ('sf_almox/<pmo>/<op>/<posto>/<a
  -- identidade do bipe>'). Sem ela, um rebipe da mesma caixa poderia estar inserindo as N linhas e a
  -- linha da fila enquanto este cancelamento ajusta a quantidade do envio pendente — e o número que
  -- fosse pro ERP não seria de nenhum dos dois gestos. Ordem OP → bipe, a mesma das outras duas.
  if v_recurso = 'almoxarifado' then
    perform pg_advisory_xact_lock(
      hashtext('sf_almox/' || v_pmo || '/' || v_op || '/' || v_posto || '/'
               || coalesce(nullif(v_numero_caixa, ''), v_snnorm))::bigint);
  end if;

  -- LIFO: só o bipe mais recente do SN nesta OP.
  select id into v_ultimo
  from public.sf_registros
  where pmo = v_pmo and op = v_op and numero_serie_norm = v_snnorm
  order by data_hora desc, id desc
  limit 1;
  if v_ultimo is distinct from p_id then
    raise exception 'NAO_E_ULTIMO';
  end if;

  -- Move: guarda a linha inteira na auditoria e apaga da tabela viva.
  -- A auditoria é gravada ANTES da reabertura de propósito: o `dados` guarda o numero_caixa que a
  -- peça REALMENTE tinha no momento do cancelamento (o código final, se a caixa estava fechada).
  insert into public.sf_registros_cancelados
    (id_original, pmo, op, numero_serie_norm, posto, dados, motivo, cancelado_por)
  select id, pmo, op, numero_serie_norm, posto, to_jsonb(r), p_motivo, auth.uid()
  from public.sf_registros r
  where id = p_id;

  delete from public.sf_registros where id = p_id;

  -- Embalagem: se a caixa da peça já estava FECHADA, reabre (inverso do sf_fechar_caixa).
  if v_recurso = 'caixa' and v_numero_caixa <> '' then
    -- Acha a caixa pelo código final (fechada) ou pelo marcador (aberta). O `<> ''` acima é o que
    -- impede casar com o codigo='' das caixas abertas.
    select c.id, c.seq, c.codigo, c.fechada into v_cx
    from public.sf_caixas c
    where c.pmo = v_pmo and c.op = v_op and c.posto = v_posto
      and c.revisao = 0
      and (c.codigo = v_numero_caixa or 'CX[' || c.seq || ']' = v_numero_caixa)
    limit 1;

    if found and v_cx.fechada then
      -- Volta as peças que sobraram pro marcador (o fechamento conta por ele).
      update public.sf_registros
         set numero_caixa = 'CX[' || v_cx.seq || ']'
       where pmo = v_pmo and op = v_op and posto = v_posto and numero_caixa = v_cx.codigo;
      -- ultima=false: se era a última da OP, o operador reconfere o "Última caixa" ao fechar de novo
      -- (senão a OP continuaria "concluída" com uma caixa aberta pendente).
      update public.sf_caixas
         set fechada = false, codigo = '', qtd = 0, ultima = false, fechada_em = null
       where id = v_cx.id;
    end if;
    -- Peça de uma montagem APOSENTADA (código com R) não chega aqui: depois da reprova o último bipe
    -- dela é o do NQA, e o LIFO já barrou com NAO_E_ULTIMO. Se chegasse, o filtro de revisao acima não
    -- acharia caixa e nada seria reaberto — o histórico fica como está.
  end if;

  -- ---------- A FILA DE ENVIO AO ERP (Fase 2) ----------
  -- A linha cancelada era uma entrada de estoque: UM painel (`pecas` placas; 0165) deixou de estar no
  -- estoque, e o Compels tem que ficar sabendo — a não ser que a entrada nem tenha saído daqui ainda NEM SIDO TOCADA por
  -- uma rodada de envio (linha limpa), caso em que o certo é corrigir/cancelar o envio pendente e não
  -- mandar uma entrada e uma saída que nunca precisaram existir. Na linha TOCADA (reservada, tentada,
  -- ou com estorno) não dá pra corrigir: a carga dela já pode ter saído com o número antigo, então ela
  -- é estornada mesmo sem estar `ok`. Quem decide isso é a sf_estoque_reverter (0132); aqui só se diz
  -- o que foi desfeito.
  --
  -- Na mesma transação do delete, pelo mesmo motivo do bipe: se o delete vingasse e a reversão não, a
  -- peça sairia do ShopFloor e continuaria no ERP para sempre, calada.
  if v_recurso = 'almoxarifado' then
    -- 0165: a quantidade revertida são as placas da linha cancelada (era o `1` fixo de uma peça).
    perform sf_estoque_reverter(v_pmo, v_op, v_posto,
                                coalesce(nullif(v_numero_caixa, ''), v_snnorm), v_pecas);
  end if;
end
$func$;

-- ---------- a lista de necessidades de LOTE (vigente: 0156) ----------
-- 0165: `pecas` e `ja_lancadas` em PLACAS (`pecas` uma vez por SN). `amostra` (a quantidade a BIPAR),
-- `sns` e o N do rótulo continuam em PAINÉIS (SNs): o lote se confirma bipando todos os SNs, e o
-- rótulo é a identidade do envio. O filtro "ainda falta SN" continua por SN.
-- Ver as regras 1 a 3 no cabeçalho. Lote = as linhas do posto NQA ANTERIOR ao Almoxarifado com o mesmo
-- nqa_lote_id; só os aprovados (todas as linhas Aprovado); some quando TODOS os SNs entraram. Um lote
-- com ALGUNS SNs já lançados (o caso que a regra 5 recusa) continua na lista, com `ja_lancadas` > 0, pra
-- tela mostrar o problema em vez de esconder um lote que nunca vai entrar.
-- `amostra` = quantidade a bipar = TODAS as peças do lote (igual a `pecas`; ver sf_almox_lote_amostra).
-- Sem permissão é ERRO, nunca lista vazia.
create or replace function public.sf_almox_lotes(p_pmo text, p_op text)
returns table (lote_id uuid, rotulo text, pecas int, amostra int, sns text[], ja_lancadas int,
               aprovado_em timestamptz)
language plpgsql stable
security definer
set search_path = public
as $func$
declare
  v_ordem record;
  v_almox text;
  v_prev  record;
begin
  if not (tem_permissao('recebimento','lancar') and tem_permissao('shopfloor','visualizar')) then
    raise exception 'SEM_PERMISSAO';
  end if;

  select o.id, o.embalagem_individual into v_ordem
    from sf_ordens o where o.pmo = p_pmo and o.op = p_op;
  -- OP inexistente ou COLETIVA (a unidade lá é a caixa: sf_almox_necessidades, 0155).
  if not found or not v_ordem.embalagem_individual then
    return;
  end if;

  -- O posto Almoxarifado DA ROTA desta OP, pelo perfil — a mesma escolha da sf_almox_necessidades.
  select opp.posto into v_almox
    from sf_ordem_postos opp
    join sf_postos po       on po.chave = opp.posto
    join sf_posto_perfis pe on pe.chave = po.perfil
   where opp.ordem_id = v_ordem.id and pe.recurso = 'almoxarifado'
   order by opp.ordem, opp.posto
   limit 1;
  if v_almox is null then
    return;
  end if;

  select * into v_prev from sf_almox_posto_anterior(v_ordem.id, v_almox);
  -- Sem NQA no anterior: bipe a bipe, sem lote (regra 1).
  if v_prev.posto is null or v_prev.recurso <> 'nqa' then
    return;
  end if;

  return query
  with l as (
    select r.nqa_lote_id as id,
           count(distinct r.numero_serie_norm)::int as n,
           bool_and(lower(r.status) = 'aprovado') as aprovado,
           array_agg(distinct r.numero_serie_norm order by r.numero_serie_norm) as sns,
           max(r.data_hora) as em
      from sf_registros r
     where r.pmo = p_pmo and r.op = p_op and r.posto = v_prev.posto
       and r.nqa_lote_id is not null and r.numero_serie_norm <> ''
     group by r.nqa_lote_id
  ),
  -- 0165: as placas de cada SN de cada lote — `pecas` UMA vez por (lote, SN), a linha mais recente, sobre
  -- o MESMO from/where de `l`.
  ls as (
    select distinct on (r.nqa_lote_id, r.numero_serie_norm)
           r.nqa_lote_id as id, r.numero_serie_norm as sn, r.pecas
      from sf_registros r
     where r.pmo = p_pmo and r.op = p_op and r.posto = v_prev.posto
       and r.nqa_lote_id is not null and r.numero_serie_norm <> ''
     order by r.nqa_lote_id, r.numero_serie_norm, r.data_hora desc, r.created_at desc
  ),
  lp as (
    select ls.id, sum(ls.pecas)::int as placas from ls group by ls.id
  ),
  -- Os SNs que já entraram no Almoxarifado desta OP, lidos UMA vez e casados com os SNs dos lotes num
  -- join só. Uma subconsulta por lote (`= any(l.sns)`) relia as entradas da OP a cada lote: medido, 133 ms
  -- numa OP de 200 lotes contra ~11 ms assim (ver o cabeçalho).
  almox as (
    select distinct a.numero_serie_norm as sn
      from sf_registros a
     where a.pmo = p_pmo and a.op = p_op and a.posto = v_almox and a.numero_serie_norm <> ''
  ),
  -- 0165: `n` (SNs) decide o filtro, `placas` é o que a lista mostra.
  lanc as (
    select x.id, count(*)::int as n, sum(ls.pecas)::int as placas
      from (select l.id, unnest(l.sns) as sn from l where l.aprovado) x
      join almox on almox.sn = x.sn
      join ls on ls.id = x.id and ls.sn = x.sn
     group by x.id
  )
  select l.id, sf_almox_lote_rotulo(l.id, l.n), lp.placas, sf_almox_lote_amostra(l.n), l.sns,
         coalesce(lanc.placas, 0), l.em
    from l
    join lp on lp.id = l.id
    left join lanc on lanc.id = l.id
   where l.aprovado and coalesce(lanc.n, 0) < l.n
   order by l.em, l.id;
end $func$;

-- ---------- confirmar o LOTE (vigente: 0156) ----------
-- 0165: a conferência (TODOS os SNs bipados) continua em PAINÉIS: v_lote.n, `bipados`, `faltam` e o
-- `pecas` da recusa lote_incompleto são SNs, e o rótulo LOTE[<hex>][<N>] segue com N = SNs (é a
-- identidade do envio). A QUANTIDADE vai em PLACAS: a `quantidade` do envio ao Compels e do retorno é a
-- soma de `pecas` das linhas gravadas, e a recusa lote_com_sn_lancado conta placas ("50 de 200 peças").
-- Recusa como DADO no jsonb ({ok:false, motivo, detalhe}), o padrão da sf_almoxarifado_entrada: quem lê
-- é o painel do operador. p_amostra = os SNs bipados, já NORMALIZADOS pelo aplicativo (a mesma
-- normalização que gravou o numero_serie_norm; não existe função de normalização no banco — ver a 0129).
create or replace function public.sf_almoxarifado_lote(
  p_pmo         text,
  p_op          text,
  p_posto       text,
  p_colaborador text,
  p_lote_id     uuid,
  p_amostra     text[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_ordem    record;
  v_prev     record;
  v_lote     record;
  v_ja       record;
  v_lancadas text[];
  v_bipados  text[];
  v_fora     text[];
  v_rotulo   text;
  v_envio    uuid := gen_random_uuid();
  v_qtd      int;
  -- 0165: o peso (placas) de cada painel do lote: um por SN, a linha mais recente.
  v_placas   int;
  v_placas_lancadas int;
begin
  -- O mesmo gate da entrada por bipe.
  if not tem_permissao('recebimento','lancar') then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select id, cliente, embalagem_individual into v_ordem
    from sf_ordens where pmo = p_pmo and op = p_op;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'ordem_nao_encontrada',
      'detalhe', 'Ordem ' || p_pmo || ' / ' || p_op || ' não cadastrada.');
  end if;

  -- As duas recusas de posto da entrada (0129), com as mesmas frases e na mesma ordem.
  if not exists (
    select 1 from sf_postos po
      join sf_posto_perfis pe on pe.chave = po.perfil
     where po.chave = p_posto and pe.recurso = 'almoxarifado'
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'posto_invalido',
      'detalhe', 'O posto "' || p_posto || '" não é um posto de Almoxarifado.');
  end if;
  if not exists (
    select 1 from sf_ordem_postos opp
     where opp.ordem_id = v_ordem.id and opp.posto = p_posto
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'posto_fora_da_op',
      'detalhe', 'O posto "' || p_posto || '" não está nos postos da OP ' || p_op
        || '. Acrescente o posto na OP em Cadastrar OP e bipe outra vez.');
  end if;

  -- Regra 1: só OP individual com NQA no posto anterior.
  select * into v_prev from sf_almox_posto_anterior(v_ordem.id, p_posto);
  if not v_ordem.embalagem_individual or v_prev.posto is null or v_prev.recurso <> 'nqa' then
    return jsonb_build_object('ok', false, 'motivo', 'lote_nao_se_aplica',
      'detalhe', 'Nesta OP a entrada não é por lote do NQA.');
  end if;
  if p_lote_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'lote_nao_encontrado',
      'detalhe', 'Lote não encontrado no ' || v_prev.posto || ' desta OP.');
  end if;

  -- CORRIDA: duas confirmações do MESMO lote se serializam aqui; a segunda, quando a primeira comitar,
  -- vê as linhas dela e recusa por ja_lancado (o runner prova). A mesma chave é pega pela
  -- sf_cancelar_lote_almoxarifado, então cancelar e reconfirmar também não se cruzam.
  perform pg_advisory_xact_lock(
    hashtext('sf_almox/' || p_pmo || '/' || p_op || '/' || p_posto || '/lote/' || p_lote_id::text)::bigint);

  -- O lote (regra 2), lido DEPOIS da trava.
  select count(distinct numero_serie_norm)::int as n,
         bool_and(lower(status) = 'aprovado') as aprovado,
         array_agg(distinct numero_serie_norm order by numero_serie_norm) as sns
    into v_lote
    from sf_registros
   where pmo = p_pmo and op = p_op and posto = v_prev.posto
     and nqa_lote_id = p_lote_id and numero_serie_norm <> '';
  if v_lote.n = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'lote_nao_encontrado',
      'detalhe', 'Lote não encontrado no ' || v_prev.posto || ' desta OP.');
  end if;
  if not v_lote.aprovado then
    return jsonb_build_object('ok', false, 'motivo', 'lote_nao_aprovado',
      'detalhe', 'Este lote não foi aprovado no ' || v_prev.posto || '.');
  end if;
  v_rotulo := sf_almox_lote_rotulo(p_lote_id, v_lote.n);

  -- Já lançado: o lote INTEIRO (ja_lancado, o mesmo motivo do rebipe) ou PARTE dele (regra 5, sem
  -- desconto). Antes da conferência do conjunto, pelo mesmo motivo da entrada: a quem reconfirma, "lote incompleto" seria
  -- pista falsa.
  v_lancadas := array(
    select distinct a.numero_serie_norm from sf_registros a
     where a.pmo = p_pmo and a.op = p_op and a.posto = p_posto
       and a.numero_serie_norm = any(v_lote.sns)
     order by 1);
  if cardinality(v_lancadas) = v_lote.n then
    select data_hora, colaborador into v_ja
      from sf_registros
     where pmo = p_pmo and op = p_op and posto = p_posto and numero_serie_norm = any(v_lote.sns)
     order by data_hora
     limit 1;
    return jsonb_build_object('ok', false, 'motivo', 'ja_lancado',
      'detalhe', 'Lote já confirmado em '
        || to_char(v_ja.data_hora at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
        || case when v_ja.colaborador = '' then '' else ' por ' || v_ja.colaborador end || '.');
  end if;
  if cardinality(v_lancadas) > 0 then
    -- 0165: "X de Y peças" em PLACAS (`pecas` uma vez por SN, sobre as linhas do lote no NQA).
    select coalesce(sum(u.pecas), 0),
           coalesce(sum(u.pecas) filter (where u.numero_serie_norm = any(v_lancadas)), 0)
      into v_placas, v_placas_lancadas
      from (select distinct on (numero_serie_norm) numero_serie_norm, pecas
              from sf_registros
             where pmo = p_pmo and op = p_op and posto = v_prev.posto
               and nqa_lote_id = p_lote_id and numero_serie_norm <> ''
             order by numero_serie_norm, data_hora desc, created_at desc) u;
    return jsonb_build_object('ok', false, 'motivo', 'lote_com_sn_lancado',
      'lancados', to_jsonb(v_lancadas),
      'detalhe', v_placas_lancadas || ' de ' || v_placas
        || case when v_placas = 1 then ' peça' else ' peças' end
        || ' deste lote já ' || case when v_placas_lancadas = 1 then 'tem' else 'têm' end
        || ' entrada no Almoxarifado ('
        || array_to_string(v_lancadas[1:10], ', ')
        || case when cardinality(v_lancadas) > 10 then ', …' else '' end
        || '). Cancele essas entradas em Registros e confirme o lote outra vez.');
  end if;

  -- O conjunto completo (regra 4). Distintos e sem vazio: o mesmo SN bipado duas vezes conta uma.
  v_bipados := array(
    select distinct btrim(s) from unnest(coalesce(p_amostra, '{}'::text[])) s
     where btrim(coalesce(s, '')) <> ''
     order by 1);
  v_fora := array(select s from unnest(v_bipados) s where not (s = any(v_lote.sns)) order by 1);
  if cardinality(v_fora) > 0 then
    return jsonb_build_object('ok', false, 'motivo', 'amostra_fora_do_lote',
      'fora', to_jsonb(v_fora),
      'detalhe', case when cardinality(v_fora) = 1 then 'A peça ' else 'As peças ' end
        || array_to_string(v_fora[1:10], ', ')
        || case when cardinality(v_fora) > 10 then ', …' else '' end
        || case when cardinality(v_fora) = 1 then ' não é' else ' não são' end || ' deste lote.');
  end if;
  -- Sem SN de fora, os bipados são um subconjunto do lote: completo = mesma contagem (o lote tem N SNs
  -- distintos, v_lote.n).
  -- 0165: tudo aqui é em PAINÉIS (SNs a bipar). Com placas por painel (algum SN do lote com pecas > 1)
  -- a frase diz "painéis", porque a tela mostra o lote em placas ("200 peças") e "Bipe todas as 4
  -- peças" confundiria; com N = 1 a frase é a de antes.
  if cardinality(v_bipados) <> v_lote.n then
    return jsonb_build_object('ok', false, 'motivo', 'lote_incompleto',
      'pecas', v_lote.n, 'bipados', cardinality(v_bipados),
      'faltam', v_lote.n - cardinality(v_bipados),
      'detalhe', case
        when exists (select 1 from sf_registros
                      where pmo = p_pmo and op = p_op and posto = v_prev.posto
                        and nqa_lote_id = p_lote_id and numero_serie_norm <> '' and pecas > 1)
        then 'Bipe todos os ' || v_lote.n
          || case when v_lote.n = 1 then ' painel' else ' painéis' end
        else 'Bipe todas as ' || v_lote.n
          || case when v_lote.n = 1 then ' peça' else ' peças' end
        end
        || ' do lote: faltam ' || (v_lote.n - cardinality(v_bipados)) || '.');
  end if;

  -- Defesa do rótulo: são só 8 hex do lote. Se outro lote desta OP/posto já usou o MESMO rótulo, a
  -- chave e a reversão (que procuram pelo alvo) misturariam os dois — então para, em vez de errar calado.
  if exists (
    select 1 from sf_estoque_envios e
     where e.pmo = p_pmo and e.op = p_op and e.posto = p_posto and e.alvo = v_rotulo
       and e.lote_id is distinct from p_lote_id
  ) then
    raise exception 'LOTE_ROTULO_EM_USO';
  end if;

  -- UMA LINHA POR SN DO LOTE (regra 6), no molde da caixa (0129): a série nos dois formatos, copiada da
  -- linha do NQA; numero_caixa vazio (não há caixa); envio_id amarra as N linhas ao mesmo gesto.
  -- 0165: v_qtd = as PLACAS das linhas inseridas (`returning pecas`, o trigger da 0161 resolveu pela
  -- OP), e não o row_count. Uma linha por SN: com N = 1 é o mesmo número de antes.
  with ins as (
    insert into public.sf_registros
      (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm, envio_id)
    select p_colaborador, p_posto, p_pmo, p_op, v_ordem.cliente, '', l.numero_serie, l.numero_serie_norm, v_envio
      from (
        select distinct on (numero_serie_norm) numero_serie_norm, numero_serie
          from sf_registros
         where pmo = p_pmo and op = p_op and posto = v_prev.posto
           and nqa_lote_id = p_lote_id and numero_serie_norm <> ''
         order by numero_serie_norm, data_hora, numero_serie
      ) l
    returning pecas
  )
  select coalesce(sum(pecas), 0) into v_qtd from ins;

  -- E UM envio ao Compels, na MESMA transação (o mesmo porquê da entrada: registro sem fila é peça que
  -- nunca chega ao ERP; fila sem registro é entrada de peça que não existe). quantidade = as PLACAS das
  -- linhas REALMENTE gravadas (0165). `sns` segue com os SNs (painéis).
  insert into public.sf_estoque_envios
    (id, chave, operacao, pmo, op, posto, tipo, bipe, serie_norm, quantidade, lote_id, sns)
  values
    (v_envio, sf_estoque_chave(p_pmo, p_op, p_posto, v_rotulo, 'entrada'), 'entrada',
     p_pmo, p_op, p_posto, 'lote', v_rotulo, '', v_qtd, p_lote_id, v_lote.sns);

  return jsonb_build_object('ok', true, 'quantidade', v_qtd, 'lote', v_rotulo);
end $func$;

-- ---------- cancelar o LOTE INTEIRO (vigente: 0156) ----------
-- 0165: devolve as PLACAS das linhas removidas (soma de `pecas`), não o número de linhas.
-- O molde da sf_cancelar_caixa_almoxarifado (0131): p_id = uma das linhas (a que o gestor clicou em
-- Registros); gate shopfloor.administrar; motivo obrigatório; trava da OP e depois a do lote; LIFO peça
-- por peça; auditoria antes do delete; sf_estoque_reverter com p_quantidade nulo ("o bipe inteiro").
-- Recusa por `raise exception` com código (a camada do cancelamento). Devolve as linhas apagadas.
create or replace function public.sf_cancelar_lote_almoxarifado(p_id uuid, p_motivo text)
returns integer
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_pmo text; v_op text; v_posto text; v_envio uuid;
  v_lote uuid; v_alvo text; v_recurso text; v_n int;
begin
  if not tem_permissao('shopfloor', 'administrar') then
    raise exception 'SEM_PERMISSAO';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'MOTIVO_OBRIGATORIO';
  end if;

  select pmo, op, posto, envio_id into v_pmo, v_op, v_posto, v_envio
    from public.sf_registros where id = p_id;
  if not found then
    -- Também é o que acontece ao cancelar DUAS VEZES o mesmo lote.
    raise exception 'NAO_ENCONTRADO';
  end if;
  select e.lote_id, e.alvo into v_lote, v_alvo
    from public.sf_estoque_envios e
   where e.id = v_envio and e.tipo = 'lote' and e.operacao = 'entrada';
  if not found then
    raise exception 'NAO_E_ENTRADA_DE_LOTE';
  end if;

  -- OP primeiro, sempre (a ordem das irmãs 0087/0106/0131/0133).
  perform pg_advisory_xact_lock(hashtext(v_pmo || '/' || v_op)::bigint);

  select p.recurso into v_recurso
    from public.sf_postos po
    join public.sf_posto_perfis p on p.chave = po.perfil
   where po.chave = v_posto;
  if coalesce(v_recurso, '') <> 'almoxarifado' then
    raise exception 'POSTO_NAO_CANCELAVEL';
  end if;

  -- A trava do LOTE, a mesma da sf_almoxarifado_lote.
  perform pg_advisory_xact_lock(
    hashtext('sf_almox/' || v_pmo || '/' || v_op || '/' || v_posto || '/lote/' || v_lote::text)::bigint);

  -- LIFO peça por peça, como a 0131: se UMA peça do lote tem bipe posterior, o lote inteiro é recusado.
  if exists (
    select 1
      from public.sf_registros a
     where a.envio_id = v_envio and a.pmo = v_pmo and a.op = v_op and a.posto = v_posto
       and a.numero_serie_norm <> ''
       and exists (
         select 1 from public.sf_registros b
          where b.pmo = a.pmo and b.op = a.op and b.numero_serie_norm = a.numero_serie_norm
            and (b.data_hora, b.id) > (a.data_hora, a.id)
       )
  ) then
    raise exception 'NAO_E_ULTIMO';
  end if;

  insert into public.sf_registros_cancelados
    (id_original, pmo, op, numero_serie_norm, posto, dados, motivo, cancelado_por)
  select r.id, r.pmo, r.op, r.numero_serie_norm, r.posto, to_jsonb(r), p_motivo, auth.uid()
    from public.sf_registros r
   where r.envio_id = v_envio and r.pmo = v_pmo and r.op = v_op and r.posto = v_posto;

  -- 0165: v_n = as PLACAS das linhas removidas (`returning pecas`), não o row_count.
  with del as (
    delete from public.sf_registros
     where envio_id = v_envio and pmo = v_pmo and op = v_op and posto = v_posto
    returning pecas
  )
  select coalesce(sum(pecas), 0) into v_n from del;

  -- Na mesma transação do delete. Envio limpo → cancelado; já enviado (ou tocado) → estorno do saldo.
  perform sf_estoque_reverter(v_pmo, v_op, v_posto, v_alvo, null);

  return v_n;
end $func$;

-- ---------- cancelar a CAIXA INTEIRA no Almoxarifado (vigente: 0131) ----------
-- 0165: devolve as PLACAS das linhas removidas (soma de `pecas`), não o número de linhas. A reversão na
-- fila continua com p_quantidade nulo ("o bipe inteiro": cancela a entrada limpa ou estorna o saldo,
-- que já está em placas desde a entrada).
create or replace function public.sf_cancelar_caixa_almoxarifado(p_id uuid, p_motivo text)
returns integer
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_pmo text; v_op text; v_posto text; v_caixa text;
  v_recurso text; v_n int;
begin
  -- Gate por MÓDULO (2-arg), igual ao da irmã e ao podeNoModulo('shopfloor','administrar') da tela:
  -- a de UM argumento anula o RBAC (revisão de segurança de 21/09/2026).
  if not tem_permissao('shopfloor', 'administrar') then
    raise exception 'SEM_PERMISSAO';
  end if;
  -- Um motivo só pra caixa inteira — é a diferença que faz o desfazer ser um gesto. Mas obrigatório
  -- do mesmo jeito: cancelamento sem motivo é dado apagado sem explicação na auditoria.
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'MOTIVO_OBRIGATORIO';
  end if;

  select pmo, op, posto, coalesce(numero_caixa, '')
    into v_pmo, v_op, v_posto, v_caixa
  from public.sf_registros
  where id = p_id;
  if not found then
    -- Também é o que acontece ao cancelar DUAS VEZES a mesma caixa: a primeira chamada apagou as N
    -- linhas (a do p_id inclusive), então a segunda não acha mais nada. A tela traduz como "talvez já
    -- cancelado", que é exatamente o caso.
    raise exception 'NAO_ENCONTRADO';
  end if;
  -- Sem código de caixa não há caixa pra cancelar. Acontece com a entrada de uma OP de embalagem
  -- INDIVIDUAL (a 0129 grava numero_caixa vazio no caminho da peça): ali a entrada já é uma peça, um
  -- bipe, uma linha — quem desfaz é a sf_cancelar_lancamento, e mandar pra cá seria pedir pra apagar
  -- todas as entradas individuais do posto de uma vez, porque numero_caixa = '' casa com todas elas.
  if v_caixa = '' then
    raise exception 'NAO_E_ENTRADA_DE_CAIXA';
  end if;

  -- Serializa com o lançamento da mesma OP (o "último bipe" não muda no meio da checagem). Mesma
  -- trava e MESMA ORDEM da irmã: OP primeiro, sempre.
  perform pg_advisory_xact_lock(hashtext(v_pmo || '/' || v_op)::bigint);

  -- Escopo pelo PERFIL do posto, nunca pelo nome. Aqui é o INVERSO do gate da irmã (que lista os
  -- recursos proibidos): esta função só sabe cancelar entrada de ALMOXARIFADO, então exige o recurso
  -- em vez de excluir alguns. A diferença importa porque 'caixa' (a Embalagem) também grava
  -- numero_caixa: apagar de uma vez as N linhas de uma caixa NA EMBALAGEM é outra operação — lá as
  -- peças estão dentro da caixa, o cancelamento reabre a caixa (0106) e o LIFO de cada peça manda —,
  -- e cair aqui por engano esvaziaria a caixa sem reabrir nada.
  select p.recurso into v_recurso
  from public.sf_postos po
  join public.sf_posto_perfis p on p.chave = po.perfil
  where po.chave = v_posto;
  if coalesce(v_recurso, '') <> 'almoxarifado' then
    raise exception 'POSTO_NAO_CANCELAVEL';
  end if;

  -- A trava do BIPE, com a MESMA chave que a sf_almoxarifado_entrada usa pro caminho da caixa
  -- ('sf_almox/' || pmo || '/' || op || '/' || posto || '/' || código, porque lá p_serie_norm vem
  -- vazio e a chave cai no próprio bipe). Sem ela, um rebipe da mesma caixa poderia estar inserindo
  -- as N linhas enquanto este cancelamento apaga, e sobrariam linhas órfãs de nenhum dos dois gestos.
  -- A ordem é sempre OP → bipe (a entrada só pega a do bipe; a 0106 pega OP → OP/posto), então não
  -- há ciclo de espera.
  perform pg_advisory_xact_lock(
    hashtext('sf_almox/' || v_pmo || '/' || v_op || '/' || v_posto || '/' || v_caixa)::bigint);

  -- LIFO, conferido PEÇA POR PEÇA — a mesma regra da irmã ("só o bipe mais recente do SN nesta OP"),
  -- aplicada a todas as N linhas e não só à que o gestor clicou. Na prática nenhuma peça da caixa tem
  -- bipe posterior, porque o Almoxarifado é o último posto da linha: cada linha daqui É o último bipe
  -- da sua própria peça, e é por isso que cancelar as N não esbarra em ordem entre caixas.
  --
  -- Mas se UMA peça tiver bipe posterior (um posto novo depois do Almoxarifado, uma correção manual),
  -- a caixa inteira é recusada, e não "cancela as 13 que dá". Previsível é o que importa: ou a caixa
  -- toda volta ou nada volta — o meio a meio é justamente o estado que esta função existe pra matar.
  -- O gestor desfaz o bipe posterior primeiro (Cancelar lançamento) e volta aqui.
  --
  -- Linha sem série não entra na conferência: sem peça não há "último bipe dela", e `= ''` casaria
  -- com qualquer outra linha sem série. O bipe de caixa não grava mais linha assim (desde a 0129 é
  -- uma linha por peça), mas o histórico gravado antes continua no banco — e essas linhas o
  -- cancelamento leva junto, porque são da mesma caixa no mesmo posto.
  if exists (
    select 1
    from public.sf_registros a
    where a.pmo = v_pmo and a.op = v_op and a.posto = v_posto and a.numero_caixa = v_caixa
      and a.numero_serie_norm <> ''
      and exists (
        select 1 from public.sf_registros b
        where b.pmo = a.pmo and b.op = a.op and b.numero_serie_norm = a.numero_serie_norm
          -- Mesmo critério de "mais recente" da irmã (order by data_hora desc, id desc): existe algum
          -- bipe depois deste par (data_hora, id)?
          and (b.data_hora, b.id) > (a.data_hora, a.id)
      )
  ) then
    raise exception 'NAO_E_ULTIMO';
  end if;

  -- MOVE: a auditoria primeiro, a tabela viva depois — o padrão da irmã. Uma entrada de auditoria por
  -- linha (com a linha inteira em to_jsonb) e o MESMO motivo em todas: quem ler a tela de
  -- Cancelamentos vê as N peças com a mesma frase e a mesma hora, que é o retrato do gesto único.
  insert into public.sf_registros_cancelados
    (id_original, pmo, op, numero_serie_norm, posto, dados, motivo, cancelado_por)
  select r.id, r.pmo, r.op, r.numero_serie_norm, r.posto, to_jsonb(r), p_motivo, auth.uid()
  from public.sf_registros r
  where r.pmo = v_pmo and r.op = v_op and r.posto = v_posto and r.numero_caixa = v_caixa;

  -- Uma transação, um delete: as N linhas somem juntas ou nenhuma some. É isto que garante que o
  -- rebipe volta a ser aceito depois — a duplicidade da 0129 procura QUALQUER linha com este código
  -- neste posto, e depois daqui não sobra nenhuma.
  -- 0165: v_n = as PLACAS das linhas removidas (`returning pecas`), não o row_count.
  with del as (
    delete from public.sf_registros
    where pmo = v_pmo and op = v_op and posto = v_posto and numero_caixa = v_caixa
    returning pecas
  )
  select coalesce(sum(pecas), 0) into v_n from del;

  -- ---------- A FILA DE ENVIO AO ERP (Fase 2) ----------
  -- A caixa inteira foi desfeita, então o Compels tem que ficar sabendo — a não ser que a entrada nem
  -- tenha saído daqui ainda NEM SIDO TOCADA por uma rodada de envio (linha limpa), caso em que o certo
  -- é cancelar o envio pendente e não mandar uma entrada e uma saída que nunca precisaram existir. Já
  -- a linha TOCADA (reservada, tentada, ou com estorno) é estornada mesmo sem estar `ok`: a carga dela
  -- pode ter chegado ao ERP, e cancelá-la deixaria os estornos dela sem par na fila.
  -- Quem decide isso é a sf_estoque_reverter (0132), a
  -- MESMA função que o cancelamento de linha avulsa chama (0133): é uma decisão só, e ter duas cópias
  -- dela seria ter duas chances de errá-la em silêncio.
  --
  -- p_quantidade NULO = "o bipe inteiro", que é exatamente o que este gesto é. Sem aritmética de
  -- propósito: a intenção é inequívoca, e a quantidade da linha da fila pode já não ser a de hoje (um
  -- cancelamento avulso anterior pode ter ajustado o envio pendente de 14 pra 13). Se a entrada já foi
  -- entregue, o estorno reverte o que o ERP RECEBEU, e não o que acabou de ser apagado aqui — é o que
  -- chegou lá que precisa ser descontado lá.
  --
  -- Na mesma transação do delete, pelo mesmo motivo do bipe: se o delete vingasse e a reversão não, as
  -- peças sairiam do ShopFloor e continuariam no ERP para sempre, caladas. Dependência de número
  -- MAIOR (esta migração chama uma função da 0132): as migrações desta branch nunca foram aplicadas em
  -- banco nenhum e vão juntas; o corpo plpgsql só resolve o nome na hora de executar.
  perform sf_estoque_reverter(v_pmo, v_op, v_posto, v_caixa, null);

  -- Quantas peças o gestor acabou de tirar do estoque — a tela diz "14 peças canceladas". Vem do
  -- delete, o que REALMENTE saiu, e não da etiqueta nem de uma contagem feita antes da trava.
  -- 0165: em PLACAS (soma de `pecas` das linhas removidas).
  return v_n;
end $func$;

-- ---------- a lista de PENDÊNCIAS de todas as OPs (vigente: 0158) ----------
-- 0165: `pecas` em PLACAS. Caixa e lote já vêm em placas da sf_almox_necessidades/sf_almox_lotes; nas
-- PEÇAS AVULSAS, `pecas` passa de count(*) dos SNs esperando para a soma de `pecas` desses SNs (o peso
-- da linha mais recente de cada SN no posto anterior, no mesmo group by — a leitura continua estável).
-- `having count(*) > 0` continua por SN. (Sem `drop function`: o tipo de retorno não muda.)
create or replace function public.sf_almox_pendencias()
returns table (pmo text, op text, tipo text, codigo text, seq int, pecas int,
               lote_id uuid, amostra int, ja_lancadas int, em timestamptz)
language plpgsql stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_o record; v_almox text; v_prev record;
begin
  if not (tem_permissao('recebimento','lancar') and tem_permissao('shopfloor','visualizar')) then
    raise exception 'SEM_PERMISSAO';
  end if;

  for v_o in
    select so.id as o_id, so.pmo as o_pmo, so.op as o_op, coalesce(so.embalagem_individual, false) as individual
      from sf_ordens so
     where upper(coalesce(so.status, '')) <> 'FINALIZADA'
       and exists (
         select 1 from sf_ordem_postos opp
           join sf_postos po       on po.chave = opp.posto
           join sf_posto_perfis pe on pe.chave = po.perfil
          where opp.ordem_id = so.id and pe.recurso = 'almoxarifado')
     order by so.pmo, so.op
  loop
    if v_o.individual then
      return query
      select v_o.o_pmo, v_o.o_op, 'lote'::text, l.rotulo, null::int, l.pecas,
             l.lote_id, l.amostra, l.ja_lancadas, l.aprovado_em
        from sf_almox_lotes(v_o.o_pmo, v_o.o_op) l;

      -- Peças avulsas: o posto Almoxarifado DA ROTA (pelo perfil, o mesmo select do detalhe) e o anterior a ele.
      select opp.posto into v_almox
        from sf_ordem_postos opp
        join sf_postos po       on po.chave = opp.posto
        join sf_posto_perfis pe on pe.chave = po.perfil
       where opp.ordem_id = v_o.o_id and pe.recurso = 'almoxarifado'
       order by opp.ordem, opp.posto
       limit 1;
      select * into v_prev from sf_almox_posto_anterior(v_o.o_id, v_almox);
      if v_prev.posto is not null and v_prev.recurso <> 'nqa' then
        return query
        with ja as (
          select distinct a.numero_serie_norm as sn
            from sf_registros a
           where a.pmo = v_o.o_pmo and a.op = v_o.o_op and a.posto = v_almox and a.numero_serie_norm <> ''
        ), esp as (
          select r.numero_serie_norm as sn, max(r.data_hora) as conc,
                 -- 0165: o peso do SN = `pecas` da linha mais recente dele (o distinct on, por grupo).
                 (array_agg(r.pecas order by r.data_hora desc, r.created_at desc))[1] as pecas
            from sf_registros r
           where r.pmo = v_o.o_pmo and r.op = v_o.o_op and r.posto = v_prev.posto
             and r.numero_serie_norm <> ''
             and (not v_prev.precisa_aprovado or lower(r.status) = 'aprovado')
           group by r.numero_serie_norm
        )
        select v_o.o_pmo, v_o.o_op, 'peca'::text, 'AVULSAS'::text, null::int, sum(e.pecas)::int,
               null::uuid, null::int, 0, max(e.conc)
          from esp e
         where not exists (select 1 from ja where ja.sn = e.sn)
        having count(*) > 0;
      end if;
    else
      return query
      select v_o.o_pmo, v_o.o_op, 'caixa'::text, n.codigo, n.seq, n.pecas,
             null::uuid, null::int, 0, n.fechada_em
        from sf_almox_necessidades(v_o.o_pmo, v_o.o_op) n;
    end if;
  end loop;
end;
$func$;

-- ---------- o DETALHE de um cartão de pendência (vigente: 0159) ----------
-- 0165: `pecas` e `recebidas_op` em PLACAS (`pecas` uma vez por SN), pra casar com `qtd_op` (que já é em
-- placas). `sns` continua a lista de SNs. NOVO só nas peças avulsas: `paineis` = quantos SNs esperam
-- (o total de SNs; `sns` traz só os 200 mais antigos), porque a tela precisa dele pra dizer "… +X outras"
-- e `pecas` deixou de ser esse número quando N > 1.
create or replace function public.sf_almox_detalhe(
  p_pmo text, p_op text, p_codigo text, p_lote_id uuid default null
) returns jsonb
language plpgsql stable
security definer
set search_path = public
as $func$
declare
  v_ordem record; v_almox text; v_prev record; v_recebidas int; v_base jsonb;
  v_cx record; v_sns text[]; v_por text; v_lote record; v_pec record;
  v_placas int;  -- 0165: as placas da caixa
begin
  if not (tem_permissao('recebimento','lancar') and tem_permissao('shopfloor','visualizar')) then
    raise exception 'SEM_PERMISSAO';
  end if;

  select o.id, o.qtd, coalesce(o.embalagem_individual, false) as individual into v_ordem
    from sf_ordens o where o.pmo = p_pmo and o.op = p_op;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'op_inexistente');
  end if;

  -- O posto Almoxarifado DA ROTA, pelo perfil: o mesmo select da sf_almox_necessidades.
  select opp.posto into v_almox
    from sf_ordem_postos opp
    join sf_postos po       on po.chave = opp.posto
    join sf_posto_perfis pe on pe.chave = po.perfil
   where opp.ordem_id = v_ordem.id and pe.recurso = 'almoxarifado'
   order by opp.ordem, opp.posto
   limit 1;
  if v_almox is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_almoxarifado');
  end if;

  select * into v_prev from sf_almox_posto_anterior(v_ordem.id, v_almox);

  -- 0165: em PLACAS (`pecas` uma vez por SN, a linha mais recente).
  select coalesce(sum(u.pecas), 0)::int into v_recebidas
    from (select distinct on (a.numero_serie_norm) a.numero_serie_norm, a.pecas
            from sf_registros a
           where a.pmo = p_pmo and a.op = p_op and a.posto = v_almox and a.numero_serie_norm <> ''
           order by a.numero_serie_norm, a.data_hora desc, a.created_at desc) u;

  v_base := jsonb_build_object('ok', true, 'qtd_op', v_ordem.qtd, 'recebidas_op', v_recebidas,
    'posto_anterior', case when v_prev.posto is null then null
       else jsonb_build_object('posto', v_prev.posto, 'recurso', v_prev.recurso,
                               'precisa_aprovado', v_prev.precisa_aprovado) end);

  -- Peças avulsas: OP individual com posto anterior que não é NQA. Mesma conta da sf_almox_pendencias.
  if v_ordem.individual and p_codigo = 'AVULSAS' and p_lote_id is null
     and v_prev.posto is not null and v_prev.recurso <> 'nqa' then
    with ja as (
      select distinct a.numero_serie_norm as sn
        from sf_registros a
       where a.pmo = p_pmo and a.op = p_op and a.posto = v_almox and a.numero_serie_norm <> ''
    ), esp as (
      select r.numero_serie_norm as sn, max(r.data_hora) as conc,
             -- 0165: o peso do SN = `pecas` da linha mais recente dele (o distinct on, por grupo).
             (array_agg(r.pecas order by r.data_hora desc, r.created_at desc))[1] as pecas
        from sf_registros r
       where r.pmo = p_pmo and r.op = p_op and r.posto = v_prev.posto and r.numero_serie_norm <> ''
         and (not v_prev.precisa_aprovado or lower(r.status) = 'aprovado')
       group by r.numero_serie_norm
    )
    select count(*)::int as n, coalesce(sum(e.pecas), 0)::int as placas, max(e.conc) as em,
           (array_agg(e.sn order by e.conc, e.sn))[1:200] as sns
      into v_pec
      from esp e where not exists (select 1 from ja where ja.sn = e.sn);
    if v_pec.n = 0 then
      return jsonb_build_object('ok', false, 'motivo', 'item_inexistente');
    end if;
    return v_base || jsonb_build_object('tipo', 'peca', 'pecas', v_pec.placas, 'paineis', v_pec.n,
                                        'em', v_pec.em,
                                        'sns', to_jsonb(coalesce(v_pec.sns, '{}'::text[])));
  end if;

  if v_ordem.individual then
    select l.* into v_lote from sf_almox_lotes(p_pmo, p_op) l where l.lote_id = p_lote_id;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'item_inexistente');
    end if;
    return v_base || jsonb_build_object('tipo', 'lote', 'rotulo', v_lote.rotulo, 'pecas', v_lote.pecas,
      'amostra', v_lote.amostra, 'sns', to_jsonb(v_lote.sns), 'aprovado_em', v_lote.aprovado_em,
      'ja_lancadas', v_lote.ja_lancadas);
  end if;

  -- Caixa FECHADA (não revisão), a primeira em (posto, seq) como na entrada.
  select cx.posto, cx.fechada_em into v_cx
    from sf_caixas cx
   where cx.pmo = p_pmo and cx.op = p_op and cx.codigo = p_codigo and cx.fechada and cx.revisao = 0
   order by cx.posto, cx.seq
   limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'item_inexistente');
  end if;

  -- 0165: os SNs (lista) e as PLACAS da caixa (`pecas` uma vez por SN), na mesma leitura.
  select array_agg(u.numero_serie_norm order by u.numero_serie_norm), coalesce(sum(u.pecas), 0)::int
    into v_sns, v_placas
    from (select distinct on (r.numero_serie_norm) r.numero_serie_norm, r.pecas
            from sf_registros r
           where r.pmo = p_pmo and r.op = p_op and r.posto = v_cx.posto
             and r.numero_caixa = p_codigo and r.numero_serie_norm <> ''
           order by r.numero_serie_norm, r.data_hora desc, r.created_at desc) u;

  select r.colaborador into v_por
    from sf_registros r
   where r.pmo = p_pmo and r.op = p_op and r.posto = v_cx.posto and r.numero_caixa = p_codigo
   order by r.data_hora desc, r.created_at desc
   limit 1;

  return v_base || jsonb_build_object('tipo', 'caixa', 'codigo', p_codigo,
    'pecas', v_placas, 'sns', to_jsonb(coalesce(v_sns, '{}'::text[])),
    'fechada_em', v_cx.fechada_em, 'fechada_por', nullif(btrim(v_por), ''));
end $func$;

-- ---------- privilégios (os mesmos das vigentes) ----------
-- A sf_cancelar_lancamento NÃO ganha revoke/grant aqui, como na 0133/0156: mexer na ACL dela mudaria
-- QUEM pode cancelar lançamento em produção.
revoke all on function public.sf_almox_necessidades(text, text) from public, anon;
grant execute on function public.sf_almox_necessidades(text, text) to authenticated;
revoke all on function public.sf_almoxarifado_entrada(text, text, text, text, text, text, int, text)
  from public, anon;
grant execute on function public.sf_almoxarifado_entrada(text, text, text, text, text, text, int, text)
  to authenticated;
revoke all on function public.sf_almox_lotes(text, text) from public, anon;
grant execute on function public.sf_almox_lotes(text, text) to authenticated;
revoke all on function public.sf_almoxarifado_lote(text, text, text, text, uuid, text[]) from public, anon;
grant execute on function public.sf_almoxarifado_lote(text, text, text, text, uuid, text[]) to authenticated;
revoke all on function public.sf_cancelar_lote_almoxarifado(uuid, text) from public, anon;
grant execute on function public.sf_cancelar_lote_almoxarifado(uuid, text) to authenticated;
revoke all on function public.sf_cancelar_caixa_almoxarifado(uuid, text) from public, anon;
grant execute on function public.sf_cancelar_caixa_almoxarifado(uuid, text) to authenticated;
revoke all on function public.sf_almox_pendencias() from public, anon;
grant execute on function public.sf_almox_pendencias() to authenticated;
revoke all on function public.sf_almox_detalhe(text, text, text, uuid) from public, anon;
grant execute on function public.sf_almox_detalhe(text, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
