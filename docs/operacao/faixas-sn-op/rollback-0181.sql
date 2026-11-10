-- =============================================================
-- ROLLBACK da 0181 (faixas de Nº de Série por OP).
--
-- RODAR SÓ DEPOIS de voltar o aplicativo para a versão anterior: o app novo lê sf_ordem_faixas e chama
-- sf_ordem_sns_fora_das_faixas. O app antigo funciona com ou sem a 0181.
--
-- O que faz: devolve as três funções que a 0181 recriou aos corpos vigentes antes dela (entrada do
-- Almoxarifado = 0175; st_liberar_setup e st_trocar_rolo = 0112, copiados sem mudança), tira os
-- triggers e as funções novas. A TABELA sf_ordem_faixas FICA (com os dados): nada mais a lê depois do
-- rollback, e reaplicar a 0181 volta tudo ao lugar sem perder as faixas cadastradas.
--
-- ⚠️ Depois do rollback, OP com mais de uma faixa só aceita a PRIMEIRA (sf_ordens.sn_ini/sn_fim).
--
-- Aplicar com: psql -1 -v ON_ERROR_STOP=1 -f rollback-0181.sql   (uma transação)
-- =============================================================

drop trigger if exists sf_ordens_faixa_principal_ins on public.sf_ordens;
drop trigger if exists sf_ordens_faixa_principal_upd on public.sf_ordens;

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
  p_serie_norm  text,
  -- 0175: o estoque de destino no ERP ('PA' | 'EINTER'). Opcional: sem ele, 'PA' (o de sempre).
  p_estoque     text default 'PA'
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
  -- 0175: o destino da entrada; nulo vale 'PA'.
  v_estoque    text := coalesce(p_estoque, 'PA');
begin
  if not tem_permissao('recebimento','lancar') then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  -- 0175: o destino só pode ser um dos dois estoques que o Compels conhece. Quem sabe se o EINTER
  -- está configurado neste ambiente é o aplicativo (variáveis de ambiente); aqui só se barra o lixo.
  if v_estoque not in ('PA', 'EINTER') then
    return jsonb_build_object('ok', false, 'motivo', 'estoque_invalido',
      'detalhe', 'Estoque de destino inválido: use PA ou EINTER.');
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
    (chave, operacao, pmo, op, posto, tipo, bipe, serie_norm, quantidade, estoque)
  values
    (sf_estoque_chave(p_pmo, p_op, p_posto, v_alvo, 'entrada'), 'entrada',
     p_pmo, p_op, p_posto, v_tipo, p_bipe, v_serie_fila, v_quantidade, v_estoque);

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

create or replace function public.st_liberar_setup(p_setup_id uuid, p_sn_abertura text) returns jsonb
language plpgsql security definer set search_path = public as $func$
declare
  v_setup record;
  v_ordem record;
  v_sn text := public.st_limpar_sn(p_sn_abertura);
  v_faixa boolean;
begin
  if not tem_permissao('setup', 'lancar') then raise exception 'SEM_PERMISSAO'; end if;
  perform pg_advisory_xact_lock(hashtext('st-setup/' || p_setup_id::text)::bigint);
  select * into v_setup from public.st_setups where id = p_setup_id;
  if not found then raise exception 'SETUP_INEXISTENTE'; end if;
  select sn_ini, sn_fim into v_ordem from public.sf_ordens where pmo = v_setup.pmo and op = v_setup.op;
  if v_setup.estado = 'liberado' then
    return jsonb_build_object('sem_faixa',
      coalesce(public.st_limpar_sn(v_ordem.sn_ini), '') = '' or coalesce(public.st_limpar_sn(v_ordem.sn_fim), '') = '');
  end if;
  if not exists (select 1 from public.st_setup_itens where setup_id = p_setup_id) then raise exception 'SETUP_VAZIO'; end if;
  if exists (select 1 from public.st_setup_itens where setup_id = p_setup_id and rolo is null) then raise exception 'FALTA_ROLO'; end if;
  if v_sn = '' then raise exception 'SN_OBRIGATORIO'; end if;
  v_faixa := public.st_sn_na_faixa(v_ordem.sn_ini, v_ordem.sn_fim, v_sn);
  if v_faixa = false then raise exception 'SN_FORA_DA_FAIXA'; end if;
  update public.st_setups
     set estado = 'liberado', sn_abertura = v_sn, liberado_por = auth.uid(), liberado_em = now()
   where id = p_setup_id;
  return jsonb_build_object('sem_faixa', v_faixa is null);
end $func$;

create or replace function public.st_trocar_rolo(
  p_setup_id uuid, p_posicao text, p_feeder text, p_rolo_saida text, p_rolo_entrada text, p_sn_inicial text,
  p_colaborador text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $func$
declare
  v_setup record; v_ordem record; v_item record;
  v_pos text := public.st_norm(p_posicao); v_fee text := public.st_norm(p_feeder);
  v_saida text := public.st_norm(p_rolo_saida); v_entrada text := public.st_norm(p_rolo_entrada);
  v_chave_saida text := public.st_rolo_chave(p_rolo_saida); v_chave_entrada text := public.st_rolo_chave(p_rolo_entrada);
  v_pth boolean;
  v_sn text := public.st_limpar_sn(p_sn_inicial);
  v_colab text := btrim(coalesce(p_colaborador, ''));
  v_motivos text[] := '{}';
  v_faixa boolean;
  v_outra text;
  v_resultado text;
  v_troca uuid;
begin
  if not tem_permissao('setup', 'lancar') then raise exception 'SEM_PERMISSAO'; end if;
  if v_pos = '' or v_fee = '' or v_saida = '' or v_entrada = '' or v_sn = '' then raise exception 'CAMPOS_OBRIGATORIOS'; end if;
  -- Trava ANTES de ler o setup e os itens.
  perform pg_advisory_xact_lock(hashtext('st-setup/' || p_setup_id::text)::bigint);
  select * into v_setup from public.st_setups where id = p_setup_id;
  if not found then raise exception 'SETUP_INEXISTENTE'; end if;
  if v_setup.estado <> 'liberado' then raise exception 'SETUP_NAO_LIBERADO'; end if;
  v_pth := v_setup.processo = 'PTH';

  -- 1. posição e feeder (PTH: posto e locação — frases escritas por processo, com o gênero certo)
  select * into v_item from public.st_setup_itens where setup_id = p_setup_id and posicao = v_pos and feeder = v_fee;
  if not found then
    if not exists (select 1 from public.st_setup_itens where setup_id = p_setup_id and posicao = v_pos) then
      v_motivos := v_motivos || case when v_pth then format('O posto %s não existe nesse setup.', v_pos)
                                     else format('A posição %s não existe nesse setup.', v_pos) end;
    elsif not exists (select 1 from public.st_setup_itens where setup_id = p_setup_id and feeder = v_fee) then
      v_motivos := v_motivos || case when v_pth then format('A locação %s não existe nesse setup.', v_fee)
                                     else format('O feeder %s não existe nesse setup.', v_fee) end;
    else
      v_motivos := v_motivos || case when v_pth then format('A locação %s não está no posto %s.', v_fee, v_pos)
                                     else format('O feeder %s não está na posição %s.', v_fee, v_pos) end;
    end if;
  else
    -- 2. rolo que sai = rolo montado (pela chave: CAPJ41-1 = CAPJ41-0001)
    if v_item.rolo_chave is null or v_item.rolo_chave is distinct from v_chave_saida then
      v_motivos := v_motivos || case when v_pth
        then format('O rolo montado no posto %s é %s, não %s.', v_pos, coalesce(v_item.rolo, '(nenhum)'), v_saida)
        else format('O rolo montado na posição %s é %s, não %s.', v_pos, coalesce(v_item.rolo, '(nenhum)'), v_saida) end;
    end if;
  end if;

  -- 3. mesmo componente / 4. outro rolo
  if v_chave_entrada is null then
    v_motivos := v_motivos || format('Código do rolo que entra inválido: %s.', v_entrada);
  elsif v_chave_saida is null then
    v_motivos := v_motivos || format('Código do rolo que sai inválido: %s.', v_saida);
  else
    if public.st_rolo_prefixo(v_entrada) <> public.st_rolo_prefixo(v_saida) then
      v_motivos := v_motivos || format('Componente diferente: sai %s, entra %s.', public.st_rolo_prefixo(v_saida), public.st_rolo_prefixo(v_entrada));
    elsif v_chave_entrada = v_chave_saida then
      v_motivos := v_motivos || 'O rolo que entra é o mesmo que sai.'::text;
    end if;
    select posicao into v_outra from public.st_setup_itens
     where setup_id = p_setup_id and rolo_chave = v_chave_entrada and (v_item.id is null or id <> v_item.id) limit 1;
    if found then
      v_motivos := v_motivos || case when v_pth
        then format('O rolo %s já está montado no posto %s.', v_entrada, v_outra)
        else format('O rolo %s já está montado na posição %s.', v_entrada, v_outra) end;
    end if;
  end if;

  -- 5. SN Inicial na faixa da OP
  select sn_ini, sn_fim into v_ordem from public.sf_ordens where pmo = v_setup.pmo and op = v_setup.op;
  v_faixa := public.st_sn_na_faixa(v_ordem.sn_ini, v_ordem.sn_fim, v_sn);
  if v_faixa = false then
    v_motivos := v_motivos || format('O SN %s não pertence à faixa da OP.', v_sn);
  end if;

  v_resultado := case when cardinality(v_motivos) = 0 then 'APROVADO' else 'REPROVADO' end;

  insert into public.st_trocas (setup_id, item_id, posicao, feeder, rolo_saida, rolo_entrada, sn_inicial,
                                resultado, motivos, operador, operador_nome, colaborador)
  values (p_setup_id, v_item.id, v_pos, v_fee, v_saida, v_entrada, v_sn, v_resultado, v_motivos,
          auth.uid(), public.st_nome_usuario(), v_colab)
  returning id into v_troca;

  if v_resultado = 'APROVADO' then
    -- Só o rolo muda: o colaborador do item continua sendo quem o bipou na montagem (o colaborador
    -- da troca fica em st_trocas). Sobrescrever aqui apagaria o da montagem quando o campo vem vazio.
    update public.st_setup_itens set rolo = v_entrada, rolo_chave = v_chave_entrada, atualizado_por = auth.uid(), atualizado_em = now()
     where id = v_item.id;
  end if;

  return jsonb_build_object('troca_id', v_troca, 'resultado', v_resultado, 'motivos', to_jsonb(v_motivos), 'sem_faixa', v_faixa is null);
end $func$;

drop function if exists public.sf_ordem_sns_fora_das_faixas(text, text, jsonb);
drop function if exists public.sf_sn_nas_faixas(text, text, text);
drop function if exists public.sf_faixas_texto(text, text);
drop function if exists public.sf_ordens_faixa_principal();

revoke all on function public.sf_almoxarifado_entrada(text, text, text, text, text, text, int, text, text)
  from public, anon;
grant execute on function public.sf_almoxarifado_entrada(text, text, text, text, text, text, int, text, text)
  to authenticated;
grant execute on function public.st_liberar_setup(uuid, text) to authenticated;
grant execute on function public.st_trocar_rolo(uuid, text, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
