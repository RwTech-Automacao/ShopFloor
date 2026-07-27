-- =============================================================
-- RBAC Fase 2b — RLS por módulo: RECEBIMENTO.
-- Reescreve as 21 políticas das 11 tabelas do Recebimento trocando
-- tem_permissao('X') → tem_permissao('recebimento','X'), preservando TODA a
-- lógica composta (status, auth.uid, OR/AND). usuarios/perfis/logs (Sistema)
-- ficam pra Fase 2c. A tem_permissao(perm) antiga PERMANECE (Sistema ainda usa).
-- Ground-truth extraído do estado atual do banco (pg_policies), não dos arquivos
-- (havia redefinições). Só no Dev; Prod só na promoção.
-- =============================================================

-- anexos_processo
drop policy if exists anexos_meta_select on public.anexos_processo;
create policy anexos_meta_select on public.anexos_processo
  for select to authenticated using (tem_permissao('recebimento','visualizar'));
drop policy if exists anexos_meta_insert on public.anexos_processo;
create policy anexos_meta_insert on public.anexos_processo
  for insert to authenticated with check (tem_permissao('recebimento','editar'));
drop policy if exists anexos_meta_delete on public.anexos_processo;
create policy anexos_meta_delete on public.anexos_processo
  for delete to authenticated using (tem_permissao('recebimento','editar'));

-- colunas_lista
drop policy if exists colunas_lista_write on public.colunas_lista;
create policy colunas_lista_write on public.colunas_lista
  for all to authenticated using (tem_permissao('recebimento','administrar')) with check (tem_permissao('recebimento','administrar'));

-- configuracao_campos
drop policy if exists config_campos_write on public.configuracao_campos;
create policy config_campos_write on public.configuracao_campos
  for all to authenticated using (tem_permissao('recebimento','administrar')) with check (tem_permissao('recebimento','administrar'));

-- criticidade_fornecedor
drop policy if exists criticidade_write on public.criticidade_fornecedor;
create policy criticidade_write on public.criticidade_fornecedor
  for all to authenticated using (tem_permissao('recebimento','administrar')) with check (tem_permissao('recebimento','administrar'));

-- geracoes_etiquetas
drop policy if exists geracoes_select on public.geracoes_etiquetas;
create policy geracoes_select on public.geracoes_etiquetas
  for select to authenticated using (tem_permissao('recebimento','visualizar'));
drop policy if exists geracoes_insert on public.geracoes_etiquetas;
create policy geracoes_insert on public.geracoes_etiquetas
  for insert to authenticated with check (tem_permissao('recebimento','gerar_etiqueta') and usuario_id = auth.uid());

-- importacoes
drop policy if exists importacoes_select on public.importacoes;
create policy importacoes_select on public.importacoes
  for select to authenticated using (tem_permissao('recebimento','visualizar'));
drop policy if exists importacoes_insert on public.importacoes;
create policy importacoes_insert on public.importacoes
  for insert to authenticated with check (tem_permissao('recebimento','importar'));

-- lista_itens
drop policy if exists lista_itens_write on public.lista_itens;
create policy lista_itens_write on public.lista_itens
  for all to authenticated using (tem_permissao('recebimento','administrar')) with check (tem_permissao('recebimento','administrar'));

-- listas
drop policy if exists listas_insert on public.listas;
create policy listas_insert on public.listas
  for insert to authenticated with check (tem_permissao('recebimento','administrar'));
drop policy if exists listas_update on public.listas;
create policy listas_update on public.listas
  for update to authenticated using (tem_permissao('recebimento','administrar')) with check (tem_permissao('recebimento','administrar'));
drop policy if exists listas_delete on public.listas;
create policy listas_delete on public.listas
  for delete to authenticated using (tem_permissao('recebimento','administrar'));

-- padroes_importacao
drop policy if exists padroes_importacao_select on public.padroes_importacao;
create policy padroes_importacao_select on public.padroes_importacao
  for select to authenticated using (tem_permissao('recebimento','importar') or tem_permissao('recebimento','administrar'));
drop policy if exists padroes_importacao_write on public.padroes_importacao;
create policy padroes_importacao_write on public.padroes_importacao
  for all to authenticated using (tem_permissao('recebimento','importar') or tem_permissao('recebimento','administrar'))
  with check (tem_permissao('recebimento','importar') or tem_permissao('recebimento','administrar'));

-- processos_recebimento
drop policy if exists processos_select on public.processos_recebimento;
create policy processos_select on public.processos_recebimento
  for select to authenticated using (tem_permissao('recebimento','visualizar'));
drop policy if exists processos_insert on public.processos_recebimento;
create policy processos_insert on public.processos_recebimento
  for insert to authenticated with check (
    (tem_permissao('recebimento','importar') or tem_permissao('recebimento','editar'))
    and (status <> 'finalizado' or tem_permissao('recebimento','finalizar'))
  );
drop policy if exists processos_update on public.processos_recebimento;
create policy processos_update on public.processos_recebimento
  for update to authenticated
  using (
    tem_permissao('recebimento','editar')
    and (status = any (array['aberto','em_conferencia']) or tem_permissao('recebimento','editar_finalizado'))
  )
  with check (
    tem_permissao('recebimento','editar')
    and (status = any (array['aberto','em_conferencia']) or tem_permissao('recebimento','finalizar') or tem_permissao('recebimento','editar_finalizado'))
  );
drop policy if exists processos_delete on public.processos_recebimento;
create policy processos_delete on public.processos_recebimento
  for delete to authenticated using (tem_permissao('recebimento','excluir'));

-- tabela_nqa
drop policy if exists nqa_write on public.tabela_nqa;
create policy nqa_write on public.tabela_nqa
  for all to authenticated using (tem_permissao('recebimento','administrar')) with check (tem_permissao('recebimento','administrar'));
