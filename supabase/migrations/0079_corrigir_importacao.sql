-- =============================================================
-- Correção de importação por EMB ("reimportar corrigindo").
--
-- Cenário: logo após importar uma planilha, os dados vieram errados (ex.: o
-- `codigo_material` da EMB390 veio em branco). Em vez de corrigir SQL na mão no
-- Prod (fora do log da app), o usuário reimporta a planilha corrigida e o
-- sistema SUBSTITUI todos os processos daquela importação.
--
-- Regra de segurança: só é permitido se NENHUM processo da importação já saiu
-- de 'aberto' (ninguém começou a conferir/finalizar) — assim nunca se perde
-- trabalho de conferência. O bloqueio é checado aqui (backstop à prova de
-- corrida); a UI também pré-checa pra avisar antes.
--
-- Por que SECURITY DEFINER: a operação é DELETE + INSERT + UPDATE atômicos. As
-- policies de RLS exigiriam `excluir` pro delete e "ser o dono" pro update de
-- `importacoes` — mas correção é uma operação de nível `importar`, e pode ser
-- feita por alguém diferente de quem importou. Então a função roda como owner e
-- faz a checagem de permissão explicitamente com `tem_permissao`, que continua
-- avaliando o USUÁRIO chamador (auth.uid() lê o JWT, não o dono da função).
-- =============================================================

alter table public.importacoes
  add column if not exists corrigida_em timestamptz,
  add column if not exists corrigida_por uuid references public.usuarios(id);

create or replace function public.corrigir_importacao(
  p_importacao_id uuid,
  p_arquivo_nome text,
  p_formato text,
  p_mapeamento jsonb,
  p_linhas jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_nome text;
  v_emb text;
  v_bloqueados int;
  v_antes int;
  v_total int;
begin
  -- 1. Permissão (checagem explícita — a função roda como owner).
  if not tem_permissao('recebimento', 'importar') then
    raise exception 'Sem permissão para corrigir importação' using errcode = '42501';
  end if;

  -- 2. A importação existe?
  if not exists (select 1 from public.importacoes where id = p_importacao_id) then
    raise exception 'Importação não encontrada' using errcode = 'P0002';
  end if;

  -- 3. Bloqueio: nenhum processo pode estar fora de 'aberto'.
  select count(*) into v_bloqueados
  from public.processos_recebimento
  where importacao_id = p_importacao_id and status <> 'aberto';
  if v_bloqueados > 0 then
    raise exception 'Correção bloqueada: % item(ns) desta EMB já em conferência ou finalizados', v_bloqueados
      using errcode = 'P0001';
  end if;

  -- 4. Não substituir por planilha vazia.
  if coalesce(jsonb_array_length(p_linhas), 0) = 0 then
    raise exception 'A planilha de correção está vazia' using errcode = 'P0001';
  end if;

  select count(*) into v_antes
  from public.processos_recebimento where importacao_id = p_importacao_id;

  -- EMB alvo: mantém a EMB atual da importação (a correção é PARA aquela EMB).
  select numero_emb into v_emb
  from public.processos_recebimento where importacao_id = p_importacao_id limit 1;

  select nome into v_nome from public.usuarios where id = auth.uid();

  -- 5. Apaga os antigos (todos 'aberto', garantido pelo passo 3).
  delete from public.processos_recebimento where importacao_id = p_importacao_id;

  -- 6. Insere os novos (força a EMB alvo; só entram Comercial + Material, igual
  -- à importação normal — Recebimento/Qualidade ficam em branco pra conferência).
  insert into public.processos_recebimento (
    importacao_id, status, criado_por,
    numero_nf, numero_emb, di_inpi, acp_cliente, numero_pedido,
    data_chegada, data_compra, data_prevista,
    atraso, tipo, comprador, fornecedor, critico,
    codigo_material, descricao_material, quantidade_pedido
  )
  select
    p_importacao_id, 'aberto', auth.uid(),
    r.numero_nf, coalesce(v_emb, r.numero_emb), r.di_inpi, r.acp_cliente, r.numero_pedido,
    r.data_chegada, r.data_compra, r.data_prevista,
    r.atraso, r.tipo, r.comprador, r.fornecedor, r.critico,
    r.codigo_material, r.descricao_material, r.quantidade_pedido
  from jsonb_populate_recordset(null::public.processos_recebimento, p_linhas) r;

  get diagnostics v_total = row_count;

  -- 7. Atualiza a importação (novos totais/arquivo/mapeamento + carimbo).
  update public.importacoes
  set total_processos_criados = v_total,
      total_linhas = coalesce(jsonb_array_length(p_linhas), 0),
      mapeamento = p_mapeamento,
      arquivo_nome = p_arquivo_nome,
      corrigida_em = now(),
      corrigida_por = auth.uid()
  where id = p_importacao_id;

  -- 8. Log da correção.
  insert into public.logs (entidade, entidade_id, acao, descricao, dados, usuario_id, usuario_nome)
  values (
    'importacao', p_importacao_id, 'corrigir',
    format('Correção da importação (EMB %s): %s → %s processo(s)', coalesce(v_emb, '—'), v_antes, v_total),
    jsonb_build_object('arquivo', p_arquivo_nome, 'emb', v_emb, 'antes', v_antes, 'depois', v_total, 'mapeamento', p_mapeamento),
    auth.uid(), coalesce(v_nome, '')
  );

  return jsonb_build_object('importacao_id', p_importacao_id, 'antes', v_antes, 'total', v_total);
end;
$function$;

grant execute on function public.corrigir_importacao(uuid, text, text, jsonb, jsonb) to authenticated;

-- Expõe a nova RPC no PostgREST imediatamente (senão o primeiro uso dá 404).
notify pgrst, 'reload schema';
