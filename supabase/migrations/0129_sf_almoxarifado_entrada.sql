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
--   caixa_nao_encontrada o código bipado não é de nenhuma caixa desta OP (etiqueta de outra OP,
--                        código digitado errado, ou caixa que foi reaberta — o cancelamento de
--                        embalagem limpa o código ao reabrir, e sem código não há entrada).
--   caixa_aberta         a caixa existe e NÃO está fechada: não se dá entrada no que não está lacrado.
--   caixa_reprovada      a caixa levou reprova no NQA; a montagem virou histórico (CX[7]R[14]…,
--                        R2/R3 da segunda reprova em diante) e vai ser refeita com o mesmo número.
--                        Dar entrada nela contaria duas vezes a mesma etiqueta.
--   ja_lancado           já existe entrada desta caixa/série NESTE posto — é a recusa que impede a
--                        contagem em dobro quando dois operadores bipam a mesma etiqueta. O detalhe
--                        devolve quando e por quem, que é o que o painel mostra.
--   serie_fora_da_faixa  a série não pertence à faixa (sn_ini/sn_fim) da OP.
--   serie_sem_embalagem  a série existe na OP mas não passou pela Embalagem: o Almoxarifado é o
--                        último posto, só entra o que já foi embalado.
--
-- Toda recusa volta como DADO (ok:false + motivo), nunca como `raise`: o painel de resultado precisa
-- mostrar a frase, e exceção vira erro genérico na tela.
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
  p_quantidade  int,    -- o que o domínio contou; conferido aqui contra o próprio código
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
begin
  if not tem_permissao('shopfloor','lancar') then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select cliente, sn_ini, sn_fim into v_ordem
    from sf_ordens where pmo = p_pmo and op = p_op;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'ordem_nao_encontrada',
      'detalhe', 'Ordem ' || p_pmo || ' / ' || p_op || ' não cadastrada.');
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
  -- A chave é o bipe inteiro (e não a OP): dois operadores bipando caixas DIFERENTES não se esperam.
  perform pg_advisory_xact_lock(
    hashtext('sf_almox/' || p_pmo || '/' || p_op || '/' || p_posto || '/' || p_bipe)::bigint);

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

    select data_hora, colaborador into v_ja
      from sf_registros
     where pmo = p_pmo and op = p_op and posto = p_posto and numero_caixa = p_bipe
     order by data_hora
     limit 1;
    if found then
      return jsonb_build_object('ok', false, 'motivo', 'ja_lancado',
        'detalhe', 'Caixa já lançada em '
          || to_char(v_ja.data_hora at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
          || case when v_ja.colaborador = '' then '' else ' por ' || v_ja.colaborador end || '.');
    end if;

    -- A quantidade sai do PRÓPRIO código bipado: é o número impresso na etiqueta colada na caixa
    -- física (o mesmo que sf_fechar_caixa gravou em sf_caixas.qtd). p_quantidade é o que o domínio
    -- contou e só entra como reserva, se algum dia o formato do código mudar antes desta regex.
    v_quantidade := coalesce(
      nullif(substring(p_bipe from '^CX\[[0-9]+\](?:R[0-9]*)?\[([0-9]+)\]'), '')::int,
      p_quantidade, 1);

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
         -- Série normalizada vazia (chamada fora do fluxo da tela) não pode casar com as linhas de
         -- bipe de caixa, que gravam numero_serie_norm = '': sem série não há entrada de peça.
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

    v_quantidade := 1;
  end if;

  -- Um registro por BIPE: uma linha pra peça, uma linha pra caixa. sf_registros não tem coluna de
  -- quantidade e não deve ganhar uma — a quantidade da caixa já vive no código (CX[seq][qtd]…) e em
  -- sf_caixas.qtd. `status` fica vazio: o perfil não tem status, o bipe não julga a peça.
  insert into public.sf_registros
    (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
  values
    (p_colaborador, p_posto, p_pmo, p_op, v_ordem.cliente,
     case when p_tipo = 'caixa' then p_bipe else '' end,
     case when p_tipo = 'serie' then p_bipe else '' end,
     case when p_tipo = 'serie' then p_serie_norm else '' end);

  return jsonb_build_object('ok', true, 'quantidade', v_quantidade);
end $func$;

-- O Postgres dá EXECUTE a PUBLIC em toda função nova; sem revoke, a anon key (que está no
-- JavaScript do navegador) chamaria a função direto no PostgREST, sem login.
revoke all on function public.sf_sn_na_faixa(text, text, text) from public, anon, authenticated;
revoke all on function public.sf_almoxarifado_entrada(text, text, text, text, text, text, int, text)
  from public, anon;
grant execute on function public.sf_almoxarifado_entrada(text, text, text, text, text, text, int, text)
  to authenticated;

notify pgrst, 'reload schema';
