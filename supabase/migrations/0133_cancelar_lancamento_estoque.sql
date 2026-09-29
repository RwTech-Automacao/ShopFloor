-- =============================================================
-- Cancelar lançamento passa a REVERTER NA FILA DE ESTOQUE quando a linha é de Almoxarifado.
--
-- POR QUE UMA MIGRAÇÃO NOVA: a sf_cancelar_lancamento nasceu na 0087 e foi trocada pela 0106, e as
-- DUAS estão em produção — migração aplicada não se edita. Então a mudança vem aqui, como
-- `create or replace`, com o corpo da 0106 inteiro mais o trecho novo no fim. Quem quiser ler o
-- porquê do LIFO, da auditoria-antes-do-delete e da reabertura de caixa: está na 0106, e nada disso
-- mudou.
--
-- O QUE MUDA, em uma frase: se a linha cancelada era uma entrada de estoque (posto com perfil de
-- recurso 'almoxarifado'), o ERP tem que ficar sabendo — ou nunca ficar sabendo de nada, se a entrada
-- ainda não saiu daqui. Sem isso, o estoque do Compels contaria uma peça que o ShopFloor já desfez, e
-- a divergência só apareceria num inventário, meses depois, sem ninguém saber de onde veio.
--
-- A DECISÃO de estornar × cancelar o pendente NÃO está aqui: está na sf_estoque_reverter (0132), que
-- é a mesma função que a sf_cancelar_caixa_almoxarifado (0131) chama. É uma decisão só, e ter duas
-- cópias dela seria ter duas chances de errá-la em silêncio. Aqui só se diz O QUE foi desfeito: UMA
-- peça (p_quantidade = 1). Numa entrada de caixa que ainda não saiu, isso AJUSTA o envio pendente (a
-- caixa de 3 passa a valer 2) em vez de estornar; quando a última peça cai, a 0132 cancela o envio.
--
-- QUAL BIPE ESTA LINHA É: `alvo` = numero_caixa quando existe, senão numero_serie_norm. É a mesma
-- identidade que a 0129 gravou na fila (o código da caixa no bipe de caixa, a série normalizada no
-- bipe de peça) — sem ela, a busca da entrada olharia pra um bipe que nunca existiu e o cancelamento
-- passaria batido. A leitura é feita ANTES do delete, junto do resto, porque depois a linha já foi.
--
-- Entrada SEM linha na fila (tudo o que foi bipado antes desta fase) é caso normal, não erro: a 0132
-- devolve 'sem_fila' e nada é enfileirado — mandar um estorno de algo que o ERP nunca recebeu seria
-- criar a divergência em vez de evitá-la.
--
-- PRIVILÉGIOS: nenhum revoke/grant aqui de propósito. `create or replace` preserva a ACL da função, e
-- mexer nela mudaria QUEM pode cancelar lançamento em produção — não é assunto desta migração.
--
-- Recusa continua como `raise exception` com código, o padrão desta camada (a action traduz). A RPC do
-- bipe (0129) devolve recusa como dado no jsonb porque lá quem lê é o painel do operador; os dois
-- padrões não se misturam.
--
-- Corpo com $func$: o SQL Editor do Supabase não aceita o delimitador de dois cifrões.
-- Aditiva e idempotente: create or replace, reaplicar não falha nem muda resultado.
-- =============================================================

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
  -- tem que ficar sabendo — a não ser que a entrada nem tenha saído daqui ainda, caso em que o certo
  -- é corrigir/cancelar o envio pendente e não mandar uma entrada e uma saída que nunca precisaram
  -- existir. Quem decide isso é a sf_estoque_reverter (0132); aqui só se diz o que foi desfeito.
  --
  -- Na mesma transação do delete, pelo mesmo motivo do bipe: se o delete vingasse e a reversão não, a
  -- peça sairia do ShopFloor e continuaria no ERP para sempre, calada.
  if v_recurso = 'almoxarifado' then
    perform sf_estoque_reverter(v_pmo, v_op, v_posto,
                                coalesce(nullif(v_numero_caixa, ''), v_snnorm), 1);
  end if;
end
$func$;

notify pgrst, 'reload schema';
