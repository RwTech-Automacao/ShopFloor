-- 0098_cancelar_embalagem_reabre_caixa.sql
-- Cancelar lançamento passa a aceitar postos de EMBALAGEM (recurso 'caixa').
--
-- Caixa ABERTA: nada de especial — a contagem da caixa é DERIVADA (conta os registros com o
-- marcador 'CX[seq]'), então apagar o registro já tira a peça da caixa e libera a vaga.
--
-- Caixa FECHADA: reabre, fazendo o INVERSO EXATO do sf_fechar_caixa (0070):
--   fechar  = carimba o código final nos registros + grava qtd/codigo/fechada/ultima/fechada_em
--   reabrir = volta os registros pro marcador 'CX[seq]' + zera qtd/codigo/fechada/ultima/fechada_em
-- Voltar pro marcador é OBRIGATÓRIO: o sf_fechar_caixa conta pelo MARCADOR; se os registros
-- ficassem com o código antigo, o próximo fechamento não enxergaria mais nenhuma peça.
-- A caixa reaberta vira uma segunda caixa aberta (a outra é a que está sendo enchida) — a tela de
-- Lançamento mostra as reabertas num painel próprio, sem tomar o lugar da caixa atual.
--
-- POR QUE NÃO PRECISA DE TRAVA CONTRA "CAIXA JÁ INSPECIONADA NO NQA": o LIFO já garante isso.
-- O sf_nqa_caixa (0080) grava um registro de NQA para TODAS as peças da caixa de uma vez; se a
-- caixa passou pelo NQA, nenhuma peça tem a Embalagem como último bipe e o LIFO barra o cancelamento
-- com NAO_E_ULTIMO. Não "conserte" isso com uma checagem extra — ela seria redundante.
--
-- Embalagem INDIVIDUAL (0078): numero_caixa = o próprio SN e NÃO existe linha em sf_caixas —
-- cai no caminho "sem caixa pra reabrir" e o cancelamento é o mesmo dos postos comuns.
create or replace function public.sf_cancelar_lancamento(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
  end if;
end
$$;
