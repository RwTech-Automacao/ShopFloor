-- Escrita em sf_postos (cadastrar/editar/excluir posto) exige shopfloor.administrar.
-- Faltava: sf_postos tinha só a policy de SELECT (sf_postos_select), então INSERT/UPDATE/DELETE
-- eram bloqueados pelo RLS para todos (a tela de Cadastrar Posto não funcionaria).
-- Espelha sf_defeitos_admin/sf_ordens_admin.
create policy sf_postos_admin on public.sf_postos
  for all using (tem_permissao('shopfloor', 'administrar')) with check (tem_permissao('shopfloor', 'administrar'));
