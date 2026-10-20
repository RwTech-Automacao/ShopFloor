-- =============================================================
-- Almoxarifado por necessidade, FASE 2 — o LOTE APROVADO NO NQA INDIVIDUAL vira necessidade, a
-- confirmação é por AMOSTRA, o Compels recebe UMA linha por lote e o cancelamento é do lote inteiro.
-- Plano: docs/superpowers/plans/2026-10-20-almoxarifado-necessidade-fase2.md
-- Spec:  docs/superpowers/specs/2026-10-20-almoxarifado-por-necessidade-design.md
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0156_sf_almox_lote.sql
--
-- ⚠️ DUAS FUNÇÕES DE PRODUÇÃO SÃO RECRIADAS AQUI, as duas com o corpo da versão vigente COPIADO SEM
-- MUDANÇA e um bloco só acrescentado (marcado "0156"); assinatura, retorno e todas as recusas de antes,
-- na mesma ordem, continuam iguais. Quem for comparar: o diff contra a vigente tem que mostrar só isso.
--   • sf_almoxarifado_entrada — vigente: 0155. Bloco novo: a recusa `serie_exige_lote` (regra 8).
--   • sf_cancelar_lancamento  — vigente: 0133. Bloco novo: a recusa `CANCELE_O_LOTE` (regra 7). Sem
--     ela, "Cancelar lançamento" numa linha de lote apagaria UMA peça sem reverter nada na fila (o alvo
--     que a 0133 calcula é o SN, e o envio do lote tem o rótulo do lote como alvo: 'sem_fila'), e o
--     Compels ficaria com uma peça a mais, calado.
--
-- POR QUÊ: na OP de embalagem INDIVIDUAL cujo posto anterior ao Almoxarifado é de perfil NQA, o NQA já
-- aprova um LOTE inteiro (sf_nqa_individual, 0097, grava o mesmo nqa_lote_id em todas as peças). Bipar
-- peça por peça no Almoxarifado era o bipe a mais no chão de fábrica, e cada bipe virava uma linha no
-- Compels (a entrada "pingada" no ERP).
--
-- AS REGRAS (decididas pelo usuário em 20/10/2026):
--   1. QUANDO VALE: OP com embalagem_individual E posto anterior ao Almoxarifado (sf_almox_posto_anterior,
--      0155) com recurso 'nqa'. Fora disso nada muda: individual sem NQA no anterior continua bipe a bipe,
--      coletiva continua por caixa.
--   2. LOTE = as linhas de sf_registros no posto NQA anterior com o mesmo nqa_lote_id. APROVADO = TODAS
--      com status Aprovado. TAMANHO = SNs distintos. Lote reprovado não vira necessidade.
--   3. NECESSIDADE = lote aprovado com SN sem entrada no Almoxarifado (sf_almox_lotes). A lista mostra
--      TODOS os SNs do lote, e `ja_lancadas` (quantos já entraram por fora; o normal é 0 — ver a regra 5).
--   4. CONFIRMAR (sf_almoxarifado_lote): uma amostra de K SNs DISTINTOS que pertencem ao lote, com K =
--      tamanho_amostra da tabela_nqa pelo tamanho TOTAL do lote (a mesma consulta da 0097; nulo ou <= 0
--      → amostra_nqa_invalida). Repetido conta UMA vez; SN de fora do lote recusa. É conferência física:
--      sem sorteio e sem "quantidade contada" (as duas foram sugestões e NÃO foram aprovadas).
--   5. SEM DESCONTO: se algum SN do lote já tem entrada no Almoxarifado, recusa com mensagem clara
--      (lote_com_sn_lancado). Nunca desconta em silêncio.
--   6. EFEITO, numa transação, sob a trava do lote: UMA linha em sf_registros por SN do lote (o molde da
--      caixa da 0129: colaborador, cliente, numero_caixa vazio) com `envio_id` apontando pro envio, e UMA
--      linha em sf_estoque_envios: tipo 'lote', bipe = alvo = 'LOTE[<8 primeiros hex do lote>][<N>]',
--      serie_norm '', quantidade N, lote_id, sns (todos os SNs). Chave pela sf_estoque_chave (0132).
--   7. CANCELAR: sempre o LOTE INTEIRO (sf_cancelar_lote_almoxarifado), com shopfloor.administrar, no
--      molde da caixa inteira (0131): auditoria antes do delete e sf_estoque_reverter (cancela o envio
--      pendente ou gera estorno; o estorno no Compels continua manual).
--   8. BIPE AVULSO BLOQUEADO: no caso da regra 1, sf_almoxarifado_entrada com p_tipo 'serie' recusa com
--      `serie_exige_lote` ("Esta peça faz parte de um lote do NQA: confirme o lote inteiro."). Depois de
--      TODAS as recusas de antes, inclusive a da 0155 — então a peça não aprovada no NQA continua ouvindo
--      posto_anterior_nao_concluido, que é a resposta verdadeira pra ela.
--
-- DECISÃO: SEM TABELA NOVA (nada de sf_nqa_lotes, nada mudado na sf_nqa_individual). O lote é uma
-- CONSULTA sobre sf_registros.nqa_lote_id, servida por um índice parcial. Medido antes de decidir
-- (postgres:15-alpine, jit=off, `set role authenticated` com o stub do tem_permissao de 2 argumentos,
-- vacuum analyze, 4 rodadas descartando a 1ª, mediana das 3), numa sf_registros de 305 mil linhas com
-- os índices de produção e 15.200 lotes:
--   sf_almox_lotes numa OP ATIVA de 2.000 peças / 200 lotes, metade já confirmada: 12,1 ms
--     (12,1 / 13,1 / 12,1). Numa OP de 1.000 peças / 100 lotes: 7,9 ms. A primeira versão, com uma
--     subconsulta por lote pra contar `ja_lancadas`, media 133 ms na OP ativa — daí o join único.
--   criar o índice parcial sf_registros_nqa_lote nessa massa: 0,34–0,37 s. É sem `concurrently` (a
--     migração roda com -1), então é o tempo em que um bipe esperaria, uma vez, na aplicação.
-- Reavaliar a tabela só se isso medir lento em produção.
--
-- DECISÃO: SEM DESCONTO (regra 5) — ver a spec: com NQA individual no anterior o bipe peça a peça deixa
-- de existir, então nenhum SN do lote pode ter entrado antes; a recusa é a defesa do caso impossível.
--
-- O RETORNO DA sf_estoque_reservar NÃO MUDA (ela devolve `table`; mudar coluna exigiria drop function
-- com o worker rodando). O envio de lote cabe nos campos que já existem: tipo 'lote', bipe = o rótulo,
-- quantidade = N. Quem quiser a lista dos SNs lê sf_estoque_envios.sns pelo id.
--
-- Corpo com $func$: o SQL Editor do Supabase não aceita o delimitador de dois cifrões.
-- Aditiva e idempotente: add column if not exists, create index if not exists, constraints em do-block
-- guardado, create or replace + revoke/grant. Reaplicar não falha nem muda resultado.
-- Depende da 0097 (nqa_lote_id), 0132 (a fila), 0133 (sf_cancelar_lancamento), 0155 (posto anterior).
-- =============================================================

-- ---------- sf_registros: o lote do NQA e o envio de cada entrada ----------
-- nqa_lote_id nasceu na 0097 (já existe em produção); o `if not exists` só deixa esta migração valer
-- sozinha numa base de teste.
alter table public.sf_registros add column if not exists nqa_lote_id uuid;
-- envio_id: a entrada de LOTE aponta pra linha da fila que a levou ao Compels. É o que amarra as N
-- linhas ao mesmo gesto (o numero_caixa faz isso na caixa; aqui não há caixa). Nulo em todo o resto.
-- Sem chave estrangeira de propósito: nada é apagado em sf_estoque_envios, e uma FK em sf_registros
-- (a tabela mais escrita do sistema) só acrescentaria uma conferência a cada insert.
alter table public.sf_registros add column if not exists envio_id uuid;

-- O lote é uma consulta: as linhas do posto NQA com nqa_lote_id, por OP. Parcial: só as linhas do NQA
-- individual entram (todo o resto tem nqa_lote_id nulo).
create index if not exists sf_registros_nqa_lote
  on public.sf_registros (pmo, op, posto, nqa_lote_id)
  where nqa_lote_id is not null;
-- O cancelamento do lote apaga "as linhas deste envio".
create index if not exists sf_registros_envio
  on public.sf_registros (envio_id)
  where envio_id is not null;

-- ---------- sf_estoque_envios: o envio de LOTE ----------
-- Fora do `create table` da 0132 pelo mesmo motivo das colunas de lá: a tabela já existe.
alter table public.sf_estoque_envios add column if not exists lote_id uuid;
alter table public.sf_estoque_envios add column if not exists sns text[];

-- O CHECK de `tipo` ganha 'lote'. O da 0132 é inline (`tipo in ('caixa', 'serie')`), então o nome é o
-- que o Postgres deu a ele (sf_estoque_envios_tipo_check). Pra não depender do nome, derruba todo CHECK
-- desta tabela cuja definição seja "tipo = ANY (ARRAY[...])" SEM 'lote', e recria com o nome conhecido.
-- Alargar o CHECK não pode falhar contra as linhas existentes (todas são 'caixa' ou 'serie'); o `add`
-- valida mesmo assim. O outro CHECK que fala de tipo (tipo_serie_exige_serie_norm) não casa com o
-- padrão e fica. Delimitador $chk5$, nunca dois cifrões.
do $chk5$
declare v_nome text;
begin
  for v_nome in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.sf_estoque_envios'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like 'CHECK ((tipo = ANY (ARRAY[%'
       and pg_get_constraintdef(c.oid) not like '%''lote''%'
  loop
    execute format('alter table public.sf_estoque_envios drop constraint %I', v_nome);
  end loop;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.sf_estoque_envios'::regclass and conname = 'sf_estoque_envios_tipo_check'
  ) then
    alter table public.sf_estoque_envios
      add constraint sf_estoque_envios_tipo_check check (tipo in ('caixa', 'serie', 'lote'));
  end if;
end $chk5$;

-- Coerência do lote: lote_id/sns só em envio de lote; o envio de lote tem serie_norm vazio (assim o
-- `alvo`, coluna gerada, é o rótulo); a ENTRADA de lote tem lote_id e a lista dos SNs. O ESTORNO de
-- lote não precisa deles: a sf_estoque_reverter (0132, não mexida) copia só tipo/bipe/serie_norm.
do $chk6$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.sf_estoque_envios'::regclass and conname = 'sf_estoque_envios_lote_coerente'
  ) then
    alter table public.sf_estoque_envios
      add constraint sf_estoque_envios_lote_coerente check (
        (lote_id is null or tipo = 'lote')
        and (sns is null or tipo = 'lote')
        and (tipo <> 'lote' or (serie_norm = ''
             and (operacao <> 'entrada' or (lote_id is not null and coalesce(cardinality(sns), 0) > 0))))
      );
  end if;
end $chk6$;

-- ---------- o rótulo do lote ----------
-- 'LOTE[<8 primeiros hex do nqa_lote_id>][<N>]'. É o bipe e o alvo do envio, e o que a tela mostra.
create or replace function public.sf_almox_lote_rotulo(p_lote_id uuid, p_n int)
returns text
language sql immutable
set search_path = public
as $func$
  select 'LOTE[' || left(replace(p_lote_id::text, '-', ''), 8) || '][' || p_n || ']'
$func$;

-- ---------- a amostra da Tabela NQA pelo tamanho do lote ----------
-- A mesma consulta da sf_nqa_individual (0097). ceil: a 0097 compara `count < tamanho` (numeric), que
-- é o mesmo que exigir o teto. Nulo = sem faixa ou faixa sem amostra.
-- plpgsql (e não sql) de propósito: o corpo só é resolvido na execução, então a migração não depende de
-- a tabela_nqa existir na hora de ser aplicada (nas bases de teste ela é criada depois).
create or replace function public.sf_almox_lote_amostra(p_n int)
returns int
language plpgsql stable
set search_path = public
as $func$
begin
  return (
    select ceil(t.tamanho_amostra)::int
      from tabela_nqa t
     where t.quantidade_min <= p_n and (t.quantidade_max is null or p_n <= t.quantidade_max)
     order by t.ordem
     limit 1);
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
          'faltam', v_prev_falta, 'pecas', v_pecas,
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

-- ---------- cancelar lançamento: a linha de lote é recusada ----------
-- Corpo da 0133 (a vigente) COPIADO SEM MUDANÇA, mais o bloco "0156". Os porquês do LIFO, da auditoria
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
begin
  -- Gate por MÓDULO (2-arg), igual ao podeNoModulo('shopfloor','administrar') da UI/action —
  -- assim quem vê o botão passa na RPC (o 1-arg global divergia do gate da tela).
  if not tem_permissao('shopfloor', 'administrar') then
    raise exception 'SEM_PERMISSAO';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'MOTIVO_OBRIGATORIO';
  end if;

  select pmo, op, numero_serie_norm, posto, coalesce(numero_caixa, '')
    into v_pmo, v_op, v_snnorm, v_posto, v_numero_caixa
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
  -- A linha cancelada era uma entrada de estoque: UMA peça deixou de estar no estoque, e o Compels
  -- tem que ficar sabendo — a não ser que a entrada nem tenha saído daqui ainda NEM SIDO TOCADA por
  -- uma rodada de envio (linha limpa), caso em que o certo é corrigir/cancelar o envio pendente e não
  -- mandar uma entrada e uma saída que nunca precisaram existir. Na linha TOCADA (reservada, tentada,
  -- ou com estorno) não dá pra corrigir: a carga dela já pode ter saído com o número antigo, então ela
  -- é estornada mesmo sem estar `ok`. Quem decide isso é a sf_estoque_reverter (0132); aqui só se diz
  -- o que foi desfeito.
  --
  -- Na mesma transação do delete, pelo mesmo motivo do bipe: se o delete vingasse e a reversão não, a
  -- peça sairia do ShopFloor e continuaria no ERP para sempre, calada.
  if v_recurso = 'almoxarifado' then
    perform sf_estoque_reverter(v_pmo, v_op, v_posto,
                                coalesce(nullif(v_numero_caixa, ''), v_snnorm), 1);
  end if;
end
$func$;

-- ---------- a lista de necessidades de LOTE ----------
-- Ver as regras 1 a 3 no cabeçalho. Lote = as linhas do posto NQA ANTERIOR ao Almoxarifado com o mesmo
-- nqa_lote_id; só os aprovados (todas as linhas Aprovado); some quando TODOS os SNs entraram. Um lote
-- com ALGUNS SNs já lançados (o caso que a regra 5 recusa) continua na lista, com `ja_lancadas` > 0, pra
-- tela mostrar o problema em vez de esconder um lote que nunca vai entrar.
-- `amostra` = K da Tabela NQA pelo tamanho do lote (nulo ou <= 0: a confirmação vai recusar com
-- amostra_nqa_invalida, e a tela já pode dizer isso). Sem permissão é ERRO, nunca lista vazia.
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
  -- Os SNs que já entraram no Almoxarifado desta OP, lidos UMA vez e casados com os SNs dos lotes num
  -- join só. Uma subconsulta por lote (`= any(l.sns)`) relia as entradas da OP a cada lote: medido, 133 ms
  -- numa OP de 200 lotes contra ~11 ms assim (ver o cabeçalho).
  almox as (
    select distinct a.numero_serie_norm as sn
      from sf_registros a
     where a.pmo = p_pmo and a.op = p_op and a.posto = v_almox and a.numero_serie_norm <> ''
  ),
  lanc as (
    select x.id, count(*)::int as n
      from (select l.id, unnest(l.sns) as sn from l where l.aprovado) x
      join almox on almox.sn = x.sn
     group by x.id
  )
  select l.id, sf_almox_lote_rotulo(l.id, l.n), l.n, sf_almox_lote_amostra(l.n), l.sns,
         coalesce(lanc.n, 0), l.em
    from l
    left join lanc on lanc.id = l.id
   where l.aprovado and coalesce(lanc.n, 0) < l.n
   order by l.em, l.id;
end $func$;

-- ---------- confirmar o LOTE ----------
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
  v_k        int;
  v_bipados  text[];
  v_fora     text[];
  v_rotulo   text;
  v_envio    uuid := gen_random_uuid();
  v_qtd      int;
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
  -- desconto). Antes da amostra, pelo mesmo motivo da entrada: a quem reconfirma, "amostra errada" seria
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
    return jsonb_build_object('ok', false, 'motivo', 'lote_com_sn_lancado',
      'lancados', to_jsonb(v_lancadas),
      'detalhe', cardinality(v_lancadas) || ' de ' || v_lote.n
        || case when v_lote.n = 1 then ' peça' else ' peças' end
        || ' deste lote já ' || case when cardinality(v_lancadas) = 1 then 'tem' else 'têm' end
        || ' entrada no Almoxarifado ('
        || array_to_string(v_lancadas[1:10], ', ')
        || case when cardinality(v_lancadas) > 10 then ', …' else '' end
        || '). Cancele essas entradas em Registros e confirme o lote outra vez.');
  end if;

  -- A amostra (regra 4).
  v_k := sf_almox_lote_amostra(v_lote.n);
  if v_k is null or v_k <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'amostra_nqa_invalida',
      'detalhe', 'A Tabela NQA não tem amostra para um lote de ' || v_lote.n
        || case when v_lote.n = 1 then ' peça' else ' peças' end || '.');
  end if;
  -- Distintos e sem vazio: o mesmo SN bipado duas vezes conta uma.
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
  if cardinality(v_bipados) <> v_k then
    return jsonb_build_object('ok', false, 'motivo', 'amostra_tamanho_errado',
      'amostra', v_k, 'bipados', cardinality(v_bipados),
      'detalhe', 'A amostra deste lote é de ' || v_k
        || case when v_k = 1 then ' peça' else ' peças' end
        || '; vieram ' || cardinality(v_bipados) || '.');
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
  insert into public.sf_registros
    (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm, envio_id)
  select p_colaborador, p_posto, p_pmo, p_op, v_ordem.cliente, '', l.numero_serie, l.numero_serie_norm, v_envio
    from (
      select distinct on (numero_serie_norm) numero_serie_norm, numero_serie
        from sf_registros
       where pmo = p_pmo and op = p_op and posto = v_prev.posto
         and nqa_lote_id = p_lote_id and numero_serie_norm <> ''
       order by numero_serie_norm, data_hora, numero_serie
    ) l;
  get diagnostics v_qtd = row_count;

  -- E UM envio ao Compels, na MESMA transação (o mesmo porquê da entrada: registro sem fila é peça que
  -- nunca chega ao ERP; fila sem registro é entrada de peça que não existe). quantidade = as linhas
  -- REALMENTE gravadas.
  insert into public.sf_estoque_envios
    (id, chave, operacao, pmo, op, posto, tipo, bipe, serie_norm, quantidade, lote_id, sns)
  values
    (v_envio, sf_estoque_chave(p_pmo, p_op, p_posto, v_rotulo, 'entrada'), 'entrada',
     p_pmo, p_op, p_posto, 'lote', v_rotulo, '', v_qtd, p_lote_id, v_lote.sns);

  return jsonb_build_object('ok', true, 'quantidade', v_qtd, 'lote', v_rotulo);
end $func$;

-- ---------- cancelar o LOTE INTEIRO ----------
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

  delete from public.sf_registros
   where envio_id = v_envio and pmo = v_pmo and op = v_op and posto = v_posto;
  get diagnostics v_n = row_count;

  -- Na mesma transação do delete. Envio limpo → cancelado; já enviado (ou tocado) → estorno do saldo.
  perform sf_estoque_reverter(v_pmo, v_op, v_posto, v_alvo, null);

  return v_n;
end $func$;

-- ---------- privilégios ----------
-- As auxiliares só rodam de dentro das security definer: revoke de todos, sem grant (o molde da 0155).
revoke all on function public.sf_almox_lote_rotulo(uuid, int) from public, anon, authenticated;
revoke all on function public.sf_almox_lote_amostra(int) from public, anon, authenticated;
revoke all on function public.sf_almox_lotes(text, text) from public, anon;
grant execute on function public.sf_almox_lotes(text, text) to authenticated;
revoke all on function public.sf_almoxarifado_lote(text, text, text, text, uuid, text[]) from public, anon;
grant execute on function public.sf_almoxarifado_lote(text, text, text, text, uuid, text[]) to authenticated;
revoke all on function public.sf_cancelar_lote_almoxarifado(uuid, text) from public, anon;
grant execute on function public.sf_cancelar_lote_almoxarifado(uuid, text) to authenticated;
-- A entrada: os mesmos revoke/grant da 0129/0155 (create or replace não mexe neles, mas a migração tem
-- que valer sozinha). A sf_cancelar_lancamento NÃO ganha revoke/grant aqui, como na 0133: mexer na ACL
-- dela mudaria QUEM pode cancelar lançamento em produção.
revoke all on function public.sf_almoxarifado_entrada(text, text, text, text, text, text, int, text)
  from public, anon;
grant execute on function public.sf_almoxarifado_entrada(text, text, text, text, text, text, int, text)
  to authenticated;

notify pgrst, 'reload schema';
