-- =============================================================
-- RBAC Fase 2d — RLS por módulo no STORAGE (bucket anexos-processos)
--
-- As políticas do bucket de anexos (storage.objects) usavam a permissão
-- GLOBAL (tem_permissao('visualizar'/'editar')) — igual às tabelas antes do
-- RBAC por módulo. Um usuário só-ShopFloor (que tenha shopfloor.visualizar/
-- editar, e portanto pode_visualizar/pode_editar = true por OR) conseguiria
-- ler/gravar/apagar os ARQUIVOS de anexo do Recebimento. Fecha o mesmo padrão
-- por módulo: tem_permissao('recebimento','X').
--
-- Estas políticas só existem no Prod (o bucket não existe no Dev). Capturadas
-- ao vivo de pg_policies antes de reescrever. cmd/roles/bucket_id preservados.
-- =============================================================

-- SELECT (baixar/listar anexos) — visualizar do Recebimento
drop policy if exists anexos_obj_select on storage.objects;
create policy anexos_obj_select on storage.objects
  for select to authenticated
  using (bucket_id = 'anexos-processos' and tem_permissao('recebimento', 'visualizar'));

-- INSERT (enviar anexo) — editar do Recebimento
drop policy if exists anexos_obj_insert on storage.objects;
create policy anexos_obj_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'anexos-processos' and tem_permissao('recebimento', 'editar'));

-- DELETE (remover anexo) — editar do Recebimento
drop policy if exists anexos_obj_delete on storage.objects;
create policy anexos_obj_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'anexos-processos' and tem_permissao('recebimento', 'editar'));
