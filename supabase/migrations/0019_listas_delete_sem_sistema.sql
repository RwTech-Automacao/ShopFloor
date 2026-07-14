-- Permite excluir qualquer lista suspensa (remove a trava de "sistema" no RLS).
-- A proteção contra apagar lista EM USO continua garantida pela FK
-- configuracao_campos.lista_chave -> listas(chave) (sem cascade) + a checagem
-- amigável na Server Action excluirListaAction.
drop policy listas_delete on public.listas;
create policy listas_delete on public.listas
  for delete to authenticated
  using (public.tem_permissao('administrar'));
