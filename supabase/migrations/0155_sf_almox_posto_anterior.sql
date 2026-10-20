-- =============================================================
-- Almoxarifado por necessidade, FASE 1 — a entrada olha o POSTO ANTERIOR da rota, e a lista de
-- necessidades (caixas que o Almoxarifado tem que confirmar).
--
-- ⚠️ sf_almoxarifado_entrada RODA EM PRODUÇÃO TODO DIA. Esta migração a recria com o corpo da versão
-- vigente (0129) COPIADO SEM MUDANÇA e só duas recusas acrescentadas (uma em cada caminho); a
-- assinatura, o retorno, os grants e todas as recusas de antes, na mesma ordem, continuam iguais.
-- Quem for comparar: o diff contra a 0129 tem que mostrar só os blocos marcados "0155".
--
-- POR QUÊ: até aqui a entrada não olhava o posto anterior. A peça só precisava ter passado por algum
-- posto de perfil Embalagem (serie_sem_embalagem) e a caixa só precisava estar fechada — uma caixa que
-- ainda não passou no NQA, ou uma peça que a Inspeção reprovou, entrava em estoque (e ia pro Compels).
--
-- A RECUSA NOVA, nos dois caminhos:
--   posto_anterior_nao_concluido
--        o posto IMEDIATAMENTE ANTES do Almoxarifado na rota da OP (sf_ordem_postos, por `ordem`) não
--        concluiu esta unidade, pela regra do GATE do perfil dele (sf_posto_perfis.gate), a mesma do
--        Lançamento (sf_lancar, 0031/0103):
--          gate 'aprovado'   → existe registro da peça nesse posto com status Aprovado;
--          gate 'registrado' → existe registro da peça nesse posto.
--        "EXISTE Aprovado", e não "o ÚLTIMO status é Aprovado": é a regra do Lançamento hoje, mantida
--        por paridade (decisão de 20/10/2026). Divergir criaria peça que o Lançamento deixa andar e o
--        Almoxarifado barra (ou o contrário).
--        Perfil de recurso 'nqa' conta como 'aprovado' qualquer que seja o gate gravado (o perfil de
--        produção já tem gate 'aprovado'; isto só fecha o caso de alguém editar o gate do NQA).
--        PEÇA (OP individual): a série bipada tem que estar concluída no posto anterior.
--        CAIXA (OP coletiva): anterior de recurso 'caixa' (Embalagem) → a caixa FECHADA basta (a
--        Embalagem não tem status, e a caixa fechada já é conferida antes). Qualquer outro anterior
--        (NQA, Inspeção…) → TODAS as peças da caixa concluídas nele. As peças da caixa saem das linhas
--        da EMBALAGEM com o código dela — a sf_nqa_caixa grava os registros do NQA SEM numero_caixa
--        (0130), então ligar SN → caixa pelo registro do NQA não funciona.
--        Sem posto anterior (o Almoxarifado é o primeiro da rota): a regra não se aplica.
--        O jsonb da recusa leva `detalhe` (a frase pronta, no padrão das outras) e também
--        `posto_anterior` e `precisa_aprovado`, pra a tela montar a frase dela.
--
--   ONDE: depois de TODAS as recusas que já existiam (posto, OP, caixa aberta/reprovada, ja_lancado,
--   caixa_sem_pecas, faixa, Embalagem) e imediatamente antes da gravação, dentro da trava do bipe.
--   Assim nenhuma recusa antiga muda de motivo: a nova só aparece onde antes a entrada era ACEITA. E
--   "já lançada" vem antes de "posto anterior não concluído", pelo mesmo motivo do sf_lancar
--   (DUPLICADO antes de SEQUENCIA): dizer a quem rebipa que falta o posto anterior seria pista falsa.
--
-- A LISTA DE NECESSIDADES — sf_almox_necessidades(p_pmo, p_op): consulta, sem tabela. Uma caixa é
-- necessidade quando: é da OP, está FECHADA, é a montagem vigente (revisao = 0, sem R no código), tem
-- peça carimbada na Embalagem, cumpre a regra do posto anterior acima e ainda NÃO tem registro no posto
-- Almoxarifado da OP com o código dela. Confirmar = o bipe de hoje (sf_almoxarifado_entrada), que tira
-- a caixa da lista. OP individual, OP sem Almoxarifado na rota ou OP inexistente devolvem vazio. Sem
-- permissão é ERRO (SEM_PERMISSAO), nunca lista vazia: a tela não pode dizer "nada esperando" quando
-- na verdade não conseguiu ler.
--
-- Corpo com $func$: o SQL Editor do Supabase não aceita o delimitador de dois cifrões.
-- Aditiva e idempotente: create or replace + revoke/grant; reaplicar não faz mal.
-- Depende da 0129 (sf_sn_na_faixa) e da 0132 (sf_estoque_chave e a fila), que já estão em produção.
-- =============================================================

-- ---------- o posto anterior ----------
-- O posto imediatamente antes de p_posto na rota da OP. A ordem é a de sf_ordem_postos.ordem — a mesma
-- que o Lançamento usa (lancamento-repository ordena por `ordem` e postoAnteriorNaSequencia pega o
-- índice anterior) —, com o nome do posto como desempate só pra resposta ser estável.
-- Nenhuma linha = sem posto anterior (o posto é o primeiro da rota, ou não está na rota).
create or replace function public.sf_almox_posto_anterior(p_ordem_id uuid, p_posto text)
returns table (posto text, recurso text, precisa_aprovado boolean)
language sql stable
set search_path = public
as $func$
  with rota as (
    select opp.posto, row_number() over (order by opp.ordem, opp.posto) as n
      from sf_ordem_postos opp
     where opp.ordem_id = p_ordem_id
  )
  select ant.posto, coalesce(pe.recurso, ''),
         -- o gate do perfil decide; recurso 'nqa' é sempre "precisa Aprovado" (ver o cabeçalho).
         coalesce(pe.gate = 'aprovado' or pe.recurso = 'nqa', false)
    from rota atual
    join rota ant on ant.n = atual.n - 1
    left join sf_postos po       on po.chave = ant.posto
    left join sf_posto_perfis pe on pe.chave = po.perfil
   where atual.posto = p_posto
$func$;

-- ---------- a peça concluída no posto anterior ----------
-- Espelho exato da trava de sequência do sf_lancar (0031/0103): "existe Aprovado" ou "existe registro".
create or replace function public.sf_almox_peca_concluida(
  p_pmo text, p_op text, p_sn_norm text, p_prev_posto text, p_precisa_aprovado boolean
) returns boolean
language sql stable
set search_path = public
as $func$
  select exists (
    select 1 from sf_registros
     where pmo = p_pmo and op = p_op and numero_serie_norm = p_sn_norm
       and posto = p_prev_posto
       and (not p_precisa_aprovado or lower(status) = 'aprovado')
  )
$func$;

-- ---------- quantas peças da caixa faltam no posto anterior ----------
-- 0 = a caixa está concluída. Anterior de recurso 'caixa' (Embalagem) → 0: a caixa fechada basta, e
-- quem chama já conferiu que ela está fechada. As peças são as linhas da EMBALAGEM com o código da
-- caixa, no posto da caixa (a mesma fonte que a entrada usa pra gravar).
create or replace function public.sf_almox_caixa_pendentes(
  p_pmo text, p_op text, p_posto_caixa text, p_codigo text,
  p_prev_posto text, p_prev_recurso text, p_precisa_aprovado boolean
) returns int
language sql stable
set search_path = public
as $func$
  select case when p_prev_recurso = 'caixa' then 0 else (
    select count(*)::int
      from (select distinct numero_serie_norm
              from sf_registros
             where pmo = p_pmo and op = p_op and posto = p_posto_caixa
               and numero_caixa = p_codigo and numero_serie_norm <> '') pc
     where not sf_almox_peca_concluida(p_pmo, p_op, pc.numero_serie_norm, p_prev_posto, p_precisa_aprovado)
  ) end
$func$;

-- ---------- a entrada ----------
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
  -- p_quantidade não é mais LIDO por esta função: a quantidade passou a ser a contagem das linhas
  -- gravadas (uma por peça). Continua na assinatura de propósito — tirá-lo obrigaria a `drop
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
      select count(distinct numero_serie_norm) into v_lancadas
        from sf_registros
       where pmo = p_pmo and op = p_op and posto = p_posto
         and numero_caixa = p_bipe and numero_serie_norm <> '';
      select count(distinct numero_serie_norm) into v_pecas
        from sf_registros
       where pmo = p_pmo and op = p_op and posto = v_caixa.posto
         and numero_caixa = p_bipe and numero_serie_norm <> '';
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
    select count(distinct numero_serie_norm) into v_pecas
      from sf_registros
     where pmo = p_pmo and op = p_op and posto = v_caixa.posto
       and numero_caixa = p_bipe and numero_serie_norm <> '';
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
        return jsonb_build_object('ok', false, 'motivo', 'posto_anterior_nao_concluido',
          'posto_anterior', v_prev.posto, 'precisa_aprovado', v_prev.precisa_aprovado,
          'detalhe', 'A caixa ' || v_caixa.seq || ' ainda não foi concluída no posto anterior ('
            || v_prev.posto || '): ' || v_prev_falta || ' de ' || v_pecas
            || case when v_pecas = 1 then ' peça' else ' peças' end
            || case when v_prev.precisa_aprovado
                    then ' sem aprovação.' else ' sem registro.' end);
      end if;
    end if;

    -- A quantidade impressa na ETIQUETA, lida do próprio código bipado. Ela deveria ser igual à
    -- contagem real, porque sf_fechar_caixa calculou o código a partir de
    -- count(distinct numero_serie_norm) dessas mesmas linhas. Quando divergirem, quem manda é a
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
    insert into public.sf_registros
      (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
    select p_colaborador, p_posto, p_pmo, p_op, v_ordem.cliente, p_bipe, pc.numero_serie, pc.numero_serie_norm
      from (
        select distinct on (numero_serie_norm) numero_serie_norm, numero_serie
          from sf_registros
         where pmo = p_pmo and op = p_op and posto = v_caixa.posto
           and numero_caixa = p_bipe and numero_serie_norm <> ''
         order by numero_serie_norm, data_hora, numero_serie
      ) pc;
    get diagnostics v_quantidade = row_count;

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

    -- A peça: uma linha, como a Embalagem e o Teste gravam. `status` fica vazio — o perfil não tem
    -- status, o bipe não julga a peça. numero_caixa fica vazio: não existe caixa neste caminho.
    -- sf_registros não tem coluna de quantidade e não deve ganhar uma: quantidade agora é contagem
    -- de linha, aqui e no caminho da caixa.
    insert into public.sf_registros
      (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
    values
      (p_colaborador, p_posto, p_pmo, p_op, v_ordem.cliente, '', p_bipe, p_serie_norm);

    v_quantidade := 1;
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
  -- `quantidade` é v_quantidade, a contagem das linhas REALMENTE gravadas — nunca o que a etiqueta
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


-- ---------- a lista de necessidades ----------
-- Ver o cabeçalho. `pecas` = séries distintas da caixa na Embalagem (o número que a entrada vai gravar).
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
             (select count(distinct r.numero_serie_norm)::int
                from sf_registros r
               where r.pmo = p_pmo and r.op = p_op and r.posto = cx.posto
                 and r.numero_caixa = cx.codigo and r.numero_serie_norm <> '') as pecas
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

-- As auxiliares só são chamadas de dentro das funções security definer (que rodam com o dono): revoke
-- de todo mundo, sem grant — como a sf_sn_na_faixa (0129).
revoke all on function public.sf_almox_posto_anterior(uuid, text) from public, anon, authenticated;
revoke all on function public.sf_almox_peca_concluida(text, text, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.sf_almox_caixa_pendentes(text, text, text, text, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.sf_almox_necessidades(text, text) from public, anon;
grant execute on function public.sf_almox_necessidades(text, text) to authenticated;
-- A entrada: os mesmos revoke/grant da 0129 (create or replace não mexe neles, mas a migração tem que
-- valer sozinha).
revoke all on function public.sf_almoxarifado_entrada(text, text, text, text, text, text, int, text)
  from public, anon;
grant execute on function public.sf_almoxarifado_entrada(text, text, text, text, text, text, int, text)
  to authenticated;

notify pgrst, 'reload schema';
