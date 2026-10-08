-- Grava a justificativa de divergencia de quantidade no Recebimento. Idempotente (pode reaplicar).
-- Por que funcao e nao update direto: a policy processos_update (0051) exige recebimento.editar e,
-- fora de aberto/em_conferencia, tambem editar_finalizado. Quem justifica e o administrador do modulo
-- (recebimento.administrar), que e outro flag; um update direto atualizaria 0 linhas em silencio.
-- Policy nao restringe colunas, entao afrouxa-la abriria a edicao de todas as colunas de um processo
-- finalizado. Esta funcao security definer escreve SO os tres campos da justificativa.
-- O autor vem de auth.uid(), nunca de parametro. O limite de tamanho do texto e aparado na aplicacao.

create or replace function public.rec_justificar_divergencia(p_id uuid, p_texto text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if not tem_permissao('recebimento', 'administrar') then
    raise exception 'SEM_PERMISSAO';
  end if;

  update public.processos_recebimento
     set divergencia_justificativa = coalesce(p_texto, ''),
         divergencia_justificada_por = auth.uid(),
         divergencia_justificada_em = now()
   where id = p_id;

  if not found then
    raise exception 'PROCESSO_NAO_ENCONTRADO';
  end if;
end;
$func$;

grant execute on function public.rec_justificar_divergencia(uuid, text) to authenticated;

notify pgrst, 'reload schema';
