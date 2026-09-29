-- =============================================================
-- Cancelar a CAIXA INTEIRA no Almoxarifado: um gesto desfaz um gesto.
--
-- POR QUE ESTA FUNÇÃO EXISTE — a entrada no Almoxarifado é UM bipe: o operador lê o código da caixa
-- fechada (CX[seq][qtd]OP-PMO) e a sf_almoxarifado_entrada (0129) grava UMA LINHA POR PEÇA de dentro
-- dela. As N linhas são o jeito de registrar — é o que faz o posto não ser especial pra nenhum leitor
-- do sistema (Fluxo, Dashboard, Pesquisa contam peça pela série) —, mas o gestor não deveria precisar
-- saber disso pra desfazer. Com só a sf_cancelar_lancamento (0087/0106), desfazer uma caixa de 14
-- eram 14 cancelamentos, cada um com o seu motivo digitado à mão. E pior: parando no meio, a caixa
-- ficava MEIO DENTRO, MEIO FORA — o rebipe continuava recusado com `ja_lancado` (a duplicidade da
-- 0129 pergunta se existe QUALQUER linha com aquele código de caixa naquele posto), e não havia
-- caminho de volta pela tela. Beco sem saída.
--
-- O QUE NÃO FOI FEITO, de propósito: enfraquecer a checagem de duplicidade da 0129 pra aceitar
-- rebipe quando a caixa está parcial. Isso faria um rebipe DESFAZER, em silêncio, um cancelamento
-- que alguém fez de propósito — e a unidade do bipe é a caixa: ou a caixa inteira entrou ou não
-- entrou. O caminho de volta é explícito, com motivo, e fica na auditoria.
--
-- COMO A CAIXA É IDENTIFICADA — p_id, o id de UMA das linhas, e não o trio (pmo/op/posto, código).
-- A razão é a tela: o gestor está olhando uma linha da tabela de Registros e clicou nela; o id é o
-- que ele tem na mão. Dele saem pmo, op, posto e numero_caixa LIDOS DO BANCO, então não existe o
-- caso de a tela compor um trio que não corresponde a linha nenhuma (código digitado errado, posto
-- de outra OP), nem de o cancelamento apagar um conjunto diferente do que estava na tela. É também
-- a mesma assinatura da irmã sf_cancelar_lancamento(p_id, p_motivo), o que mantém a camada acima
-- simétrica: mesma chamada, mesma tradução de erro, só o alcance muda.
--
-- Desenho copiado da irmã (0087, depois 0106): gate de permissão por MÓDULO, motivo obrigatório,
-- trava, e o padrão MOVER PRA AUDITORIA ANTES DE APAGAR (sf_registros_cancelados guarda a linha
-- inteira em to_jsonb, uma entrada por peça — a auditoria continua sendo linha a linha, com o MESMO
-- motivo nas N: é o registro fiel do que existia, e é ele que permite reconstruir a caixa depois).
--
-- Recusa: `raise exception` com código, como a irmã — a action traduz. Esta função é da camada do
-- CANCELAMENTO, não da do bipe (a 0129 devolve recusa como dado no jsonb porque quem lê é o painel
-- do operador). Não se misturam os dois padrões.
--
-- Devolve a CONTAGEM de linhas canceladas, pra tela poder dizer "14 peças canceladas". É o número
-- de linhas realmente apagadas, não o que a etiqueta prometia.
--
-- Corpo com $func$: o SQL Editor do Supabase não aceita o delimitador de dois cifrões.
-- Aditiva e idempotente: create or replace + revoke/grant, reaplicar não falha nem muda resultado.
-- =============================================================

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
  delete from public.sf_registros
  where pmo = v_pmo and op = v_op and posto = v_posto and numero_caixa = v_caixa;
  get diagnostics v_n = row_count;

  -- Quantas peças o gestor acabou de tirar do estoque — a tela diz "14 peças canceladas". Vem do
  -- delete, o que REALMENTE saiu, e não da etiqueta nem de uma contagem feita antes da trava.
  return v_n;
end $func$;

-- O Postgres dá EXECUTE a PUBLIC em toda função nova; sem revoke, a anon key (que está no
-- JavaScript do navegador) chamaria a função direto no PostgREST, sem login. O gate de permissão
-- lá dentro já recusaria, mas fechar o EXECUTE é a camada que não depende disso.
revoke all on function public.sf_cancelar_caixa_almoxarifado(uuid, text) from public, anon;
grant execute on function public.sf_cancelar_caixa_almoxarifado(uuid, text) to authenticated;

notify pgrst, 'reload schema';
