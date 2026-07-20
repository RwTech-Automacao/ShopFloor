-- "Usuário —" na tela de Importações para quem não é admin: a lista lia o nome
-- via join `usuarios(nome)`, mas a RLS de `usuarios` só deixa cada um ver o
-- PRÓPRIO cadastro — então importações feitas por outra pessoa apareciam sem
-- nome. Solução: desnormalizar o nome na própria importação (igual a tabela
-- `logs` já faz com `usuario_nome`), gravado na hora do import. A lista passa a
-- ler direto, sem depender da RLS de `usuarios`.

alter table public.importacoes
  add column usuario_nome text not null default '';

-- Backfill das importações existentes (roda como dono da migração, sem RLS).
update public.importacoes i
set usuario_nome = coalesce((select nome from public.usuarios u where u.id = i.usuario_id), '');

-- A RPC passa a gravar `usuario_nome`. O nome é buscado ANTES do insert em
-- `importacoes` (é o próprio usuário — permitido pela RLS de `usuarios`) e entra
-- na linha. Segue SECURITY INVOKER (a policy de UPDATE da 0025 já cobre o
-- total_processos_criados).
create or replace function public.importar_processos(
  p_arquivo_nome text,
  p_formato text,
  p_mapeamento jsonb,
  p_linhas jsonb
) returns jsonb
  language plpgsql
  set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_total int;
  v_nome text;
begin
  select nome into v_nome from public.usuarios where id = auth.uid();

  insert into public.importacoes (arquivo_nome, formato, total_linhas, mapeamento, usuario_id, usuario_nome)
  values (p_arquivo_nome, p_formato, coalesce(jsonb_array_length(p_linhas), 0), p_mapeamento, auth.uid(), coalesce(v_nome, ''))
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

  insert into public.logs (entidade, entidade_id, acao, descricao, dados, usuario_id, usuario_nome)
  values (
    'importacao', v_id, 'importar',
    format('Importação de %s: %s processo(s) criado(s)', p_arquivo_nome, v_total),
    jsonb_build_object('arquivo', p_arquivo_nome, 'formato', p_formato, 'total', v_total, 'mapeamento', p_mapeamento),
    auth.uid(), coalesce(v_nome, '')
  );

  return jsonb_build_object('importacao_id', v_id, 'total', v_total);
end;
$function$;
