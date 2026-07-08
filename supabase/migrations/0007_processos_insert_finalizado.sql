-- Alinha o INSERT ao UPDATE: criar um processo já 'finalizado' exige 'finalizar'.
drop policy processos_insert on public.processos_recebimento;
create policy processos_insert on public.processos_recebimento
  for insert to authenticated
  with check (
    (public.tem_permissao('importar') or public.tem_permissao('editar'))
    and (status <> 'finalizado' or public.tem_permissao('finalizar'))
  );
