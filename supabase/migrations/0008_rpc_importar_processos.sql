create or replace function public.importar_processos(
  p_arquivo_nome text,
  p_formato text,
  p_mapeamento jsonb,
  p_linhas jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_total int;
  v_nome text;
begin
  insert into public.importacoes (arquivo_nome, formato, total_linhas, mapeamento, usuario_id)
  values (p_arquivo_nome, p_formato, coalesce(jsonb_array_length(p_linhas), 0), p_mapeamento, auth.uid())
  returning id into v_id;

  insert into public.processos_recebimento (
    importacao_id, status, criado_por,
    numero_nf, numero_emb, di_inpi, acp_cliente, numero_pedido,
    data_chegada, data_compra, data_prevista,
    atraso, tipo, comprador, fornecedor, critico,
    codigo_material, descricao_material, quantidade_pedido
  )
  select
    v_id, 'aberto', auth.uid(),
    r.numero_nf, r.numero_emb, r.di_inpi, r.acp_cliente, r.numero_pedido,
    r.data_chegada, r.data_compra, r.data_prevista,
    r.atraso, r.tipo, r.comprador, r.fornecedor, r.critico,
    r.codigo_material, r.descricao_material, r.quantidade_pedido
  from jsonb_populate_recordset(null::public.processos_recebimento, p_linhas) r;

  get diagnostics v_total = row_count;

  update public.importacoes set total_processos_criados = v_total where id = v_id;

  select nome into v_nome from public.usuarios where id = auth.uid();

  insert into public.logs (entidade, entidade_id, acao, descricao, dados, usuario_id, usuario_nome)
  values (
    'importacao', v_id, 'importar',
    format('Importação de %s: %s processo(s) criado(s)', p_arquivo_nome, v_total),
    jsonb_build_object('arquivo', p_arquivo_nome, 'formato', p_formato, 'total', v_total, 'mapeamento', p_mapeamento),
    auth.uid(), coalesce(v_nome, '')
  );

  return jsonb_build_object('importacao_id', v_id, 'total', v_total);
end;
$$;
