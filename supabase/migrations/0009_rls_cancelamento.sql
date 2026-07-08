-- Cancelar (status -> 'cancelado') passa a exigir a permissão 'excluir'
-- (Supervisor/Admin). Editar e finalizar seguem como antes.
drop policy processos_update on public.processos_recebimento;
create policy processos_update on public.processos_recebimento
  for update to authenticated
  using (
    public.tem_permissao('editar')
    and (status <> 'finalizado' or public.tem_permissao('editar_finalizado'))
  )
  with check (
    public.tem_permissao('editar')
    and (status <> 'finalizado' or public.tem_permissao('finalizar') or public.tem_permissao('editar_finalizado'))
    and (status <> 'cancelado' or public.tem_permissao('excluir'))
  );
