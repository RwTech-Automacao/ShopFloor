-- =============================================================
-- Posto Almoxarifado — a RPC da entrada.
--
-- O operador bipa o que acabou de ser embalado: o Nº de Série da peça (OP de embalagem individual,
-- 1 unidade) ou o código da caixa fechada, CX[seq][qtd]OP-PMO (OP coletiva, o bipe vale a caixa
-- inteira). O que o FORMATO resolve já foi resolvido em TS (classificarBipeAlmoxarifado); aqui fica
-- só o que depende de DADO — e é por isso que tudo mora numa transação só:
--
--   sem_permissao        o gate é shopfloor.lancar, na função de DOIS argumentos: a de um argumento
--                        anula o RBAC (revisão de segurança de 21/09/2026).
--   ordem_nao_encontrada (pmo, op) tem que existir em sf_ordens — é de lá que sai o cliente.
--   posto_invalido       o posto tem que existir com perfil de recurso 'almoxarifado' (0128). Sem
--                        isso, chamar a RPC apontando pra qualquer posto daria entrada em qualquer
--                        lugar da linha.
--   caixa_em_op_individual / serie_em_op_coletiva
--                        o par (p_tipo, sf_ordens.embalagem_individual) tem que casar. A regra
--                        "individual bipa série, coletiva bipa caixa" também existe em TS
--                        (classificarBipeAlmoxarifado), mas a flag é editável numa OP já em
--                        andamento (Cadastrar OP) — sem checar de novo aqui, alguém muda a flag no
--                        meio da OP e as duas classificações divergem: a mesma peça entraria como
--                        caixa (na embalagem coletiva de ontem) E como série (na individual de hoje).
--   caixa_nao_encontrada o código bipado não é de nenhuma caixa desta OP (etiqueta de outra OP,
--                        código digitado errado, ou caixa que foi reaberta — o cancelamento de
--                        embalagem limpa o código ao reabrir, e sem código não há entrada).
--   caixa_aberta         a caixa existe e NÃO está fechada: não se dá entrada no que não está lacrado.
--   caixa_reprovada      a caixa levou reprova no NQA; a montagem virou histórico (CX[7]R[14]…,
--                        R2/R3 da segunda reprova em diante) e vai ser refeita com o mesmo número.
--                        Dar entrada nela contaria duas vezes a mesma etiqueta.
--   ja_lancado           já existe entrada desta caixa/série NESTE posto — é a recusa que impede a
--                        contagem em dobro quando dois operadores bipam a mesma etiqueta. O detalhe
--                        devolve quando, por quem e QUANTAS DAS N PEÇAS estão lançadas ("3 de 14"):
--                        num estado parcial, deixado por um cancelamento linha a linha que parou no
--                        meio, é isso que diz ao gestor o que ele está olhando em vez de repetir "já
--                        lançada" e virar beco sem saída. O caminho de volta é a 0131 (cancelar a
--                        caixa inteira, um gesto e um motivo só).
--   caixa_sem_pecas      a caixa está fechada mas não tem nenhuma peça carimbada com o código dela.
--                        sf_fechar_caixa recusa fechar caixa vazia, então isso só aparece depois de
--                        um cancelamento de lançamento (0087) levar as linhas da Embalagem pra
--                        auditoria. Sem esta recusa o bipe gravaria ZERO linha e ainda devolveria
--                        ok: o operador leria "0 peças" e a caixa ficaria fora do estoque em silêncio.
--                        Conferida DUAS vezes: na contagem antes do insert e nas linhas gravadas
--                        depois dele — são statements separados, e uma reabertura de caixa (0106)
--                        que comite entre os dois deixa o insert sem nenhuma peça pra copiar.
--   serie_fora_da_faixa  a série não pertence à faixa (sn_ini/sn_fim) da OP.
--   serie_sem_embalagem  a série existe na OP mas não passou pela Embalagem: o Almoxarifado é o
--                        último posto, só entra o que já foi embalado.
--
-- Toda recusa volta como DADO (ok:false + motivo), nunca como `raise`: o painel de resultado precisa
-- mostrar a frase, e exceção vira erro genérico na tela.
--
-- COMO GRAVA — o ponto mais importante desta função: UMA LINHA POR PEÇA, sempre.
-- O bipe de peça grava a linha dela; o bipe de CAIXA grava uma linha para CADA peça que está dentro
-- da caixa (a série de cada uma, mais o código da caixa em numero_caixa). Não é detalhe de gosto: é
-- o que faz o posto Almoxarifado deixar de ser especial. Todo leitor do sistema conta peça pela
-- série — a RPC sf_fluxo_op (0094) e contarPendentesPorPosto filtram numero_serie_norm <> '', o
-- Dashboard (0101) conta distinct numero_serie_norm, a Pesquisa procura por SN, o cancelamento
-- (0087) desfaz por linha. Uma única linha de caixa (com série vazia) é invisível pra todos eles: o
-- card do Almoxarifado no Fluxo mostraria 0 bipes, o trabalho em processo ficaria parado na
-- Embalagem, a OP nunca concluiria e o Dashboard contaria zero peça — tudo isso SEM erro na tela.
-- A alternativa (ensinar cada leitor a somar a quantidade da linha de caixa) foi recusada porque
-- espalharia um caso especial que, esquecido em qualquer leitor novo, conta errado calado.
-- Gravando como a Embalagem e o Teste gravam, ninguém precisa nunca ter ouvido falar deste posto.
--
-- DIVERGÊNCIA ETIQUETA × CONTAGEM: quando o número impresso no código (CX[3][**14**]…) não bate com
-- as peças que entraram, a resposta leva `qtd_etiqueta` junto de `quantidade` e o painel diz as duas
-- ("14 peças na etiqueta, 13 entraram"). O aviso em log continua, mas ele sozinho não servia: um
-- `raise warning` numa chamada via PostgREST é engolido pelo supabase-js e fica só no log do
-- Postgres, que ninguém lê — a caixa física de 14 entrava como 13 calada e a 14ª peça ficava como
-- trabalho em processo na Embalagem pra sempre, sem a OP nunca concluir.
--
-- Irmã mais próxima: sf_lancar (0031) — mesmo gate, mesma gravação em sf_registros, mesma ideia de
-- duplicidade. Corpo com $func$: o SQL Editor do Supabase não aceita o delimitador de dois cifrões.
-- Aditiva e idempotente: reaplicar não faz mal.
-- =============================================================

-- ---------- faixa de SN ----------
-- Espelha serieDentroDaFaixa (src/modules/shopfloor/domain/serie.ts): numérica quando início, fim e
-- alvo têm um único bloco de dígitos com prefixo/sufixo iguais; senão, comparação lexical.
-- `null` = OP sem faixa cadastrada (não há o que julgar).
--
-- Existe uma gêmea desta, st_sn_na_faixa (0112, módulo Setup), e a duplicação é deliberada: a 0112
-- ainda não chegou ao Prod, então o ShopFloor não pode depender dela pra dar entrada em estoque.
-- Se um dia as duas migrações estiverem nos dois bancos, vale unificar.
create or replace function public.sf_sn_na_faixa(p_ini text, p_fim text, p_sn text) returns boolean
language plpgsql immutable as $func$
declare
  -- "limpar" (não "normalizar"): tira separadores e MANTÉM zeros à esquerda, como limparSerie.
  a text := regexp_replace(coalesce(p_ini, ''), '[^A-Za-z0-9]', '', 'g');
  b text := regexp_replace(coalesce(p_fim, ''), '[^A-Za-z0-9]', '', 'g');
  x text := regexp_replace(coalesce(p_sn,  ''), '[^A-Za-z0-9]', '', 'g');
  ma text[]; mb text[]; mx text[];
  lo text; hi text;
begin
  if a = '' or b = '' then return null; end if;
  ma := regexp_match(a, '^([A-Za-z]*)(\d+)([A-Za-z]*)$');
  mb := regexp_match(b, '^([A-Za-z]*)(\d+)([A-Za-z]*)$');
  mx := regexp_match(x, '^([A-Za-z]*)(\d+)([A-Za-z]*)$');
  if ma is not null and mb is not null and mx is not null then
    if lower(ma[1]) <> lower(mb[1]) or lower(ma[3]) <> lower(mb[3]) then return false; end if;
    if lower(mx[1]) <> lower(ma[1]) or lower(mx[3]) <> lower(ma[3]) then return false; end if;
    return mx[2]::numeric between least(ma[2]::numeric, mb[2]::numeric)
                             and greatest(ma[2]::numeric, mb[2]::numeric);
  end if;
  -- collate "C": mesma ordem por unidade de código do TS, independente da collation do banco.
  lo := least(a collate "C", b collate "C"); hi := greatest(a collate "C", b collate "C");
  return x collate "C" >= lo collate "C" and x collate "C" <= hi collate "C";
end $func$;

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
begin
  if not tem_permissao('shopfloor','lancar') then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select cliente, sn_ini, sn_fim, embalagem_individual into v_ordem
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

    -- A peça: uma linha, como a Embalagem e o Teste gravam. `status` fica vazio — o perfil não tem
    -- status, o bipe não julga a peça. numero_caixa fica vazio: não existe caixa neste caminho.
    -- sf_registros não tem coluna de quantidade e não deve ganhar uma: quantidade agora é contagem
    -- de linha, aqui e no caminho da caixa.
    insert into public.sf_registros
      (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
    values
      (p_colaborador, p_posto, p_pmo, p_op, v_ordem.cliente, '', p_bipe, p_serie_norm);

    v_quantidade := 1;
  end if;

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

-- O Postgres dá EXECUTE a PUBLIC em toda função nova; sem revoke, a anon key (que está no
-- JavaScript do navegador) chamaria a função direto no PostgREST, sem login.
--
-- sf_sn_na_faixa NÃO ganha grant a authenticated (diferente da regra geral: revoke de
-- public/anon + grant a authenticated). É deliberado: ela é só uma auxiliar de sf_almoxarifado_entrada,
-- chamada de dentro da própria função (que é security definer); ninguém mais tem razão pra chamá-la
-- direto. Revoke de todo mundo, sem grant nenhum, é MAIS restritivo que a regra padrão e continua
-- funcionando porque a chamadora roda com o dono da função, não com o papel de quem invocou.
revoke all on function public.sf_sn_na_faixa(text, text, text) from public, anon, authenticated;
revoke all on function public.sf_almoxarifado_entrada(text, text, text, text, text, text, int, text)
  from public, anon;
grant execute on function public.sf_almoxarifado_entrada(text, text, text, text, text, text, int, text)
  to authenticated;

notify pgrst, 'reload schema';
